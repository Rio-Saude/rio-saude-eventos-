// HML-only financial worker. It is invoked by pg_cron using a Vault-derived
// secret; it accepts neither browser JWTs nor public input.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EFI = 'https://cobrancas-h.api.efipay.com.br';
const db = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const encoder = new TextEncoder();

function spDate(now = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now); }
function addDays(day: string, days: number) { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function digits(value: unknown) { return String(value || '').replace(/\D/g, ''); }
function validAddress(value: any) { return value && /^\d{8}$/.test(value.zipcode || '') && /^[A-Z]{2}$/.test(value.state || '') && [value.street, value.number, value.neighborhood, value.city].every((part: unknown) => typeof part === 'string' && part.trim()); }

async function equalsSecret(received: string | null, expected: string | undefined) {
  if (!received || !expected) return false;
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', encoder.encode(received)), crypto.subtle.digest('SHA-256', encoder.encode(expected))]);
  const av = new Uint8Array(a), bv = new Uint8Array(b); let difference = av.length ^ bv.length;
  for (let index = 0; index < Math.min(av.length, bv.length); index += 1) difference |= av[index] ^ bv[index];
  return difference === 0;
}
async function efiToken() {
  const id = Deno.env.get('EFI_CLIENT_ID_HOMOLOG'), secret = Deno.env.get('EFI_CLIENT_SECRET_HOMOLOG');
  if (Deno.env.get('EFI_ENV') !== 'homologation' || !id || !secret) throw new Error('efi_credentials_missing');
  const response = await fetch(`${EFI}/v1/authorize`, { method: 'POST', headers: { Authorization: `Basic ${btoa(`${id}:${secret}`)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'client_credentials' }), signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) throw new Error('efi_oauth_failed');
  return String(data.access_token);
}
function efiCustomer(profile: any, address: any) { return { name: `${profile.first_name} ${profile.last_name}`.trim(), cpf: digits(profile.cpf), email: profile.email, phone_number: digits(profile.whatsapp), address: { street: address.street, number: address.number, neighborhood: address.neighborhood, zipcode: address.zipcode, city: address.city, state: address.state, complement: address.complement || undefined } }; }

async function issueDueBoletos(today: string) {
  const { data: due, error } = await db.from('billing_subscriptions').select('id,athlete_profile_id,billing_plan_id,first_due_on,price_cents').eq('environment', 'homologation').eq('payment_method', 'boleto').eq('creation_state', 'scheduled').eq('status', 'pending').lte('boleto_issue_on', today);
  if (error) throw error;
  let issued = 0, review = 0;
  for (const subscription of due || []) {
    const [{ data: plan }, { data: profile }, { data: address }] = await Promise.all([
      db.from('billing_plans').select('name,efi_plan_id_homolog').eq('id', subscription.billing_plan_id).single(),
      db.from('athlete_profiles').select('first_name,last_name,email,cpf,whatsapp').eq('id', subscription.athlete_profile_id).single(),
      db.from('billing_customer_profiles').select('*').eq('athlete_profile_id', subscription.athlete_profile_id).maybeSingle()
    ]);
    if (!plan || !profile || !validAddress(address)) { await db.from('billing_subscriptions').update({ creation_state: 'review' }).eq('id', subscription.id); review += 1; continue; }
    const { data: locked } = await db.from('billing_subscriptions').update({ creation_state: 'requested' }).eq('id', subscription.id).eq('creation_state', 'scheduled').select('id').maybeSingle();
    if (!locked) continue;
    let contactedProvider = false;
    try {
      const token = await efiToken(); contactedProvider = true;
      const response = await fetch(`${EFI}/v1/plan/${plan.efi_plan_id_homolog}/subscription/one-step`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ name: `Rio Saúde - ${plan.name} - Mensal`, value: subscription.price_cents, amount: 1 }], metadata: { custom_id: subscription.id, notification_url: `${URL.replace('.supabase.co', '.functions.supabase.co')}/efi-webhook` }, payment: { banking_billet: { customer: efiCustomer(profile, address), expire_at: subscription.first_due_on } } }), signal: AbortSignal.timeout(25000) });
      const output = await response.json().catch(() => null), data = output?.data;
      if (!response.ok || !data?.subscription_id) throw new Error('efi_boleto_failed');
      await db.from('billing_subscriptions').update({ efi_subscription_id: String(data.subscription_id), efi_charge_id: data.charge?.id ? String(data.charge.id) : null, efi_status: String(data.status || 'new'), creation_state: 'ready' }).eq('id', subscription.id);
      if (data.charge?.id) await db.from('billing_charges').upsert({ subscription_id: subscription.id, efi_charge_id: String(data.charge.id), charge_kind: 'boleto', status: 'waiting', amount_cents: subscription.price_cents, due_on: subscription.first_due_on, billet_url: data.charge?.billet_link || null }, { onConflict: 'efi_charge_id' });
      issued += 1;
    } catch { await db.from('billing_subscriptions').update(contactedProvider ? { creation_state: 'review' } : { creation_state: 'scheduled' }).eq('id', subscription.id); review += 1; }
  }
  return { issued, review };
}

async function queueNotice(subscriptionId: string, kind: 'card_checkout_day_25' | 'card_checkout_day_31') {
  await db.from('billing_notification_attempts').upsert({ subscription_id: subscriptionId, message_kind: kind, channel: 'whatsapp', status: 'queued' }, { onConflict: 'subscription_id,message_kind', ignoreDuplicates: true });
}

async function createHostedCardLink(subscription: any, today: string) {
  const { data: locked } = await db.from('billing_subscriptions').update({ creation_state: 'requested' }).eq('id', subscription.id).eq('creation_state', 'scheduled').select('id').maybeSingle();
  if (!locked) return false;
  let contactedProvider = false;
  try {
    const { data: plan } = await db.from('billing_plans').select('name,efi_plan_id_homolog').eq('id', subscription.billing_plan_id).single();
    if (!plan?.efi_plan_id_homolog || !/^\d+$/.test(plan.efi_plan_id_homolog)) throw new Error('plan_unavailable');
    const token = await efiToken(); contactedProvider = true;
    const expires = addDays(today, 6); // day 25 through day 31, inclusive
    const response = await fetch(`${EFI}/v1/plan/${plan.efi_plan_id_homolog}/subscription/one-step/link`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ name: `Rio Saúde - ${plan.name} - Mensal`, value: subscription.price_cents, amount: 1 }], metadata: { custom_id: subscription.id, notification_url: `${URL.replace('.supabase.co', '.functions.supabase.co')}/efi-webhook` }, settings: { payment_method: 'credit_card', expire_at: expires, request_delivery_address: false } }), signal: AbortSignal.timeout(25000) });
    const output = await response.json().catch(() => null), data = output?.data;
    if (!response.ok || !data?.subscription_id || !data?.payment_url) throw new Error('efi_checkout_link_failed');
    const { error } = await db.from('billing_subscriptions').update({ efi_subscription_id: String(data.subscription_id), efi_charge_id: data.charge?.id ? String(data.charge.id) : null, efi_status: String(data.status || 'new'), payment_url: String(data.payment_url), payment_expires_at: expires, checkout_link_created_at: new Date().toISOString(), creation_state: 'ready', status: 'pending' }).eq('id', subscription.id);
    if (error) throw error;
    if (data.charge?.id) await db.from('billing_charges').upsert({ subscription_id: subscription.id, efi_charge_id: String(data.charge.id), charge_kind: 'subscription', status: 'new', amount_cents: subscription.price_cents, due_on: subscription.first_charge_on }, { onConflict: 'efi_charge_id' });
    await queueNotice(subscription.id, 'card_checkout_day_25');
    return true;
  } catch {
    await db.from('billing_subscriptions').update(contactedProvider ? { creation_state: 'review' } : { creation_state: 'scheduled' }).eq('id', subscription.id);
    return false;
  }
}

function message(kind: string, name: string, link: string) {
  const firstName = name.trim().split(/\s+/)[0] || 'Tudo bem';
  return kind === 'card_checkout_day_25'
    ? `Oi, ${firstName}! Tudo bem?\n\nPassando pra lembrar de cadastrar seu cartão e ativar sua mensalidade na Rio Saúde.\n\nÉ bem simples, basta acessar o link abaixo e concluir o cadastro:\n\n${link}\n\nQualquer dúvida, é só chamar!`
    : `Oi, ${firstName}! Tudo bem?\n\nPassando pra lembrar que o cadastro do seu cartão na Rio Saúde ainda está pendente.\n\nVocê pode finalizar por aqui:\n\n${link}\n\nSe precisar de alguma ajuda, é só chamar!`;
}

async function deliverNotices(today: string) {
  const apiUrl = Deno.env.get('EVOLUTION_API_URL_HOMOLOG')?.replace(/\/$/, '');
  const apiKey = Deno.env.get('EVOLUTION_API_KEY_HOMOLOG');
  const instance = Deno.env.get('EVOLUTION_INSTANCE_HOMOLOG');
  const enabled = Deno.env.get('EVOLUTION_SEND_ENABLED_HOMOLOG') === 'true';
  const { data: attempts, error } = await db.from('billing_notification_attempts').select('id,subscription_id,message_kind,status,attempts').in('status', ['queued', 'failed', 'blocked']).lt('attempts', 3).order('created_at').limit(20);
  if (error) throw error;
  let sent = 0, blocked = 0, failed = 0;
  for (const attempt of attempts || []) {
    if (!apiUrl || !apiKey || !instance || !enabled) { await db.from('billing_notification_attempts').update({ status: 'blocked', failure_code: enabled ? 'evolution_configuration_missing' : 'evolution_delivery_disabled' }).eq('id', attempt.id); blocked += 1; continue; }
    const { data: locked } = await db.from('billing_notification_attempts').update({ status: 'processing', last_attempt_at: new Date().toISOString() }).eq('id', attempt.id).in('status', ['queued', 'failed', 'blocked']).select('id').maybeSingle();
    if (!locked) continue;
    const { data: subscription } = await db.from('billing_subscriptions').select('id,status,creation_state,payment_url,payment_expires_at,athlete_profile_id').eq('id', attempt.subscription_id).maybeSingle();
    const { data: profile } = subscription ? await db.from('athlete_profiles').select('first_name,whatsapp,whatsapp_financial_contact_authorized').eq('id', subscription.athlete_profile_id).maybeSingle() : { data: null };
    const phone = digits(profile?.whatsapp);
    if (!subscription || subscription.status !== 'pending' || subscription.creation_state !== 'ready' || !subscription.payment_url || subscription.payment_expires_at < today || !profile?.whatsapp_financial_contact_authorized || phone.length < 10 || phone.length > 13) { await db.from('billing_notification_attempts').update({ status: 'cancelled', failure_code: 'notification_no_longer_eligible' }).eq('id', attempt.id); continue; }
    try {
      const response = await fetch(`${apiUrl}/message/sendText/${encodeURIComponent(instance)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: apiKey }, body: JSON.stringify({ number: phone, text: message(attempt.message_kind, String(profile.first_name || ''), subscription.payment_url) }), signal: AbortSignal.timeout(20000) });
      const output = await response.json().catch(() => null);
      if (!response.ok) throw new Error('evolution_send_failed');
      const providerMessageId = String(output?.key?.id || output?.message?.key?.id || 'accepted');
      await db.from('billing_notification_attempts').update({ status: 'sent', attempts: attempt.attempts + 1, sent_at: new Date().toISOString(), provider_message_id: providerMessageId, failure_code: null }).eq('id', attempt.id);
      sent += 1;
    } catch {
      const nextAttempts = attempt.attempts + 1;
      await db.from('billing_notification_attempts').update({ status: nextAttempts >= 3 ? 'failed' : 'queued', attempts: nextAttempts, failure_code: 'evolution_send_failed' }).eq('id', attempt.id);
      failed += 1;
    }
  }
  return { sent, blocked, failed };
}

async function processCardFollowup(today: string) {
  const { data: due, error } = await db.from('billing_subscriptions').select('id,billing_plan_id,price_cents,first_charge_on').eq('environment', 'homologation').eq('checkout_kind', 'card_hosted_trial').eq('creation_state', 'scheduled').eq('status', 'pending').lte('checkout_link_on', today);
  if (error) throw error;
  let links = 0;
  for (const subscription of due || []) if (await createHostedCardLink(subscription, today)) links += 1;
  const { data: reminders, error: reminderError } = await db.from('billing_subscriptions').select('id').eq('environment', 'homologation').eq('checkout_kind', 'card_hosted_trial').eq('creation_state', 'ready').eq('status', 'pending').lte('checkout_reminder_on', today).gte('payment_expires_at', today);
  if (reminderError) throw reminderError;
  for (const subscription of reminders || []) await queueNotice(subscription.id, 'card_checkout_day_31');
  return { links, reminders: reminders?.length || 0 };
}

Deno.serve(async (request) => {
  if (request.method !== 'POST' || !await equalsSecret(request.headers.get('x-rio-schedule-secret'), Deno.env.get('BILLING_CRON_SECRET_HOMOLOG'))) return new Response(null, { status: 401 });
  try {
    const body = await request.json().catch(() => null);
    if (!['run_due_boleto', 'run_financial_followup'].includes(body?.action)) return new Response(null, { status: 400 });
    const today = spDate();
    const boleto = await issueDueBoletos(today);
    const cards = await processCardFollowup(today);
    const notices = await deliverNotices(today);
    return Response.json({ boleto, cards, notices }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return new Response(null, { status: 500 }); }
});
