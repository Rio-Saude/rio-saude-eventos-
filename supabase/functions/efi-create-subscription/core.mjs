// No production URL or production credentials are used by this checkout.
export const EFI_BASE = 'https://cobrancas-h.api.efipay.com.br';
const PLAN_CODES = ['single_monthly', 'multi_monthly'];
const ORIGINS = ['https://rio-saude.github.io', 'http://127.0.0.1:8766', 'http://localhost:8766'];
const PAYMENT_HOSTS = ['pagamento.gerencianet.com.br', 'pagamento-h.gerencianet.com.br', 'pagamento.efipay.com.br', 'pagamento-h.efipay.com.br'];

export function safePaymentUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && PAYMENT_HOSTS.includes(url.hostname);
  } catch { return false; }
}

function validCpf(cpf) {
  if (!/^\d{11}$/.test(cpf || '') || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let size = 9; size <= 10; size++) {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += Number(cpf[i]) * (size + 1 - i);
    if ((sum * 10) % 11 % 10 !== Number(cpf[size])) return false;
  }
  return true;
}

export function createHandler({ env, authenticate, db, fetchEfi = fetch, now = () => new Date() }) {
  return async function handle(req) {
    const origin = req.headers.get('origin');
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin',
      'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (origin && ORIGINS.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
    if (origin && !ORIGINS.includes(origin)) return reply(403, { error: 'origin_not_allowed' });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' });
    // Fail closed even if somebody changes EFI_ENV in the dashboard.
    if (env('EFI_ENV') !== 'homologation') return reply(503, { error: 'homologation_only' });
    const clientId = env('EFI_CLIENT_ID_HOMOLOG');
    const clientSecret = env('EFI_CLIENT_SECRET_HOMOLOG');
    if (!clientId || !clientSecret) return reply(503, { error: 'homologation_credentials_missing' });
    let reservation = null;
    let externalRequested = false;
    try {
      const user = await authenticate(req);
      if (!user?.id || !user.email) return reply(401, { error: 'authentication_required' });
      let body;
      try { body = await req.json(); } catch { return reply(400, { error: 'invalid_request' }); }
      if (!body || typeof body !== 'object' || Object.keys(body).some(key => key !== 'plan_code') || !PLAN_CODES.includes(body.plan_code)) {
        return reply(400, { error: 'invalid_plan' });
      }
      const profile = await db.profile(user.id);
      if (!profile) return reply(422, { error: 'profile_missing' });
      if (!profile.first_name?.trim() || !profile.last_name?.trim() || !validCpf(profile.cpf) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(profile.birth_date || '') || !Number.isFinite(Date.parse(profile.birth_date)) ||
          profile.birth_date > now().toISOString().slice(0, 10) || profile.email?.toLowerCase() !== user.email.toLowerCase()) {
        return reply(422, { error: 'profile_incomplete' });
      }
      const plan = await db.plan(body.plan_code);
      if (!plan?.active || plan.currency !== 'BRL' || plan.interval_months !== 1 ||
          !Number.isInteger(plan.price_cents) || plan.price_cents <= 0 || !/^\d+$/.test(plan.efi_plan_id_homolog || '')) {
        return reply(422, { error: 'plan_unavailable' });
      }
      const result = await db.reserve({ athlete_profile_id: profile.id, billing_plan_id: plan.id,
        environment: 'homologation', status: 'pending', creation_state: 'reserved', price_cents: plan.price_cents });
      if (!result.created) {
        const existing = result.row;
        if (!existing) return reply(409, { error: 'checkout_in_progress' });
        if (existing.billing_plan_id !== plan.id) return reply(409, { error: 'existing_subscription_other_plan' });
        if (existing.status === 'active' || existing.status === 'past_due') return reply(409, { error: 'subscription_exists' });
        if (existing.creation_state === 'ready' && safePaymentUrl(existing.payment_url) &&
            existing.payment_expires_at >= now().toISOString().slice(0, 10)) {
          return reply(200, { environment: 'homologation', subscription_id: existing.id, payment_url: existing.payment_url, reused: true });
        }
        return reply(409, { error: existing.creation_state === 'reserved' || existing.creation_state === 'requested' ? 'checkout_in_progress' : 'checkout_requires_review' });
      }
      reservation = result.row;
      const authRes = await fetchEfi(`${EFI_BASE}/v1/authorize`, { method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'client_credentials' }) });
      const authData = await authRes.json();
      if (!authRes.ok || typeof authData.access_token !== 'string') throw new Error('oauth_failed');
      await db.update(reservation.id, { creation_state: 'requested' });
      const expires = new Date(now().getTime() + 7 * 86400000).toISOString().slice(0, 10);
      externalRequested = true;
      // Do not retry this POST: an interrupted response may still have created a subscription.
      const efiRes = await fetchEfi(`${EFI_BASE}/v1/plan/${plan.efi_plan_id_homolog}/subscription/one-step/link`, {
        method: 'POST', signal: AbortSignal.timeout(25000),
        headers: { Authorization: `Bearer ${authData.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ name: `Rio Saúde - ${plan.name} - Mensal`, value: plan.price_cents, amount: 1 }],
          metadata: { custom_id: reservation.id },
          settings: { payment_method: 'all', expire_at: expires, request_delivery_address: false } }) });
      const efi = await efiRes.json();
      const data = efi?.data;
      if (!efiRes.ok || !data?.subscription_id || !safePaymentUrl(data.payment_url)) throw new Error('efi_result_uncertain');
      await db.update(reservation.id, { efi_subscription_id: String(data.subscription_id),
        efi_charge_id: data.charge?.id ? String(data.charge.id) : null, efi_status: String(data.status || 'new'),
        payment_url: data.payment_url, payment_expires_at: data.expire_at || expires, creation_state: 'ready', status: 'pending' });
      return reply(200, { environment: 'homologation', subscription_id: reservation.id, payment_url: data.payment_url, reused: false });
    } catch {
      // Only a failure BEFORE the creation POST permits a new attempt.
      if (reservation) {
        try { await db.update(reservation.id, externalRequested ? { creation_state: 'review' } : { creation_state: 'failed', status: 'failed' }); } catch { /* Reservation still blocks duplicates. */ }
      }
      return reply(502, { error: externalRequested ? 'checkout_requires_review' : 'checkout_unavailable' });
    }
  };
}
