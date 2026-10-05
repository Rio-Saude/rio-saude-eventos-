import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, safePaymentUrl, EFI_BASE } from './core.mjs';

const profile = { id: 'profile-1', first_name: 'Aluno', last_name: 'Teste', cpf: '52998224725', email: 'aluno@example.com', birth_date: '1990-01-01' };
const plan = { id: 'plan-1', code: 'single_monthly', name: '1 modalidade', price_cents: 39000, currency: 'BRL', interval_months: 1, active: true, efi_plan_id_homolog: '72116' };
const paymentUrl = 'https://pagamento-h.gerencianet.com.br/test-checkout';
function fixture(options = {}) {
  const rows = [], calls = [];
  const db = {
    profile: async () => options.profile === undefined ? profile : options.profile,
    plan: async code => ({ ...plan, ...(code === 'multi_monthly' ? { id: 'plan-2', efi_plan_id_homolog: '72117', price_cents: 49000 } : {}), ...options.plan }),
    reserve: async values => {
      const existing = rows.find(row => ['pending', 'active', 'past_due'].includes(row.status));
      if (existing) return { created: false, row: existing };
      const row = { ...values, id: `attempt-${rows.length + 1}` };
      rows.push(row);
      return { created: true, row };
    },
    update: async (id, values) => { if (options.failSave && values.creation_state === 'ready') throw Error('db_unavailable'); Object.assign(rows.find(row => row.id === id), values); }
  };
  const handler = createHandler({ env: key => ({ EFI_ENV: options.environment || 'homologation', EFI_CLIENT_ID_HOMOLOG: 'test-id', EFI_CLIENT_SECRET_HOMOLOG: 'test-secret' })[key],
    authenticate: async () => options.unauthenticated ? null : { id: 'user-1', email: profile.email }, db,
    now: () => new Date('2026-10-05T20:00:00Z'),
    fetchEfi: async (url, request) => {
      calls.push({ url, request });
      assert(url.startsWith(EFI_BASE + '/'));
      if (url.endsWith('/authorize')) return Response.json(options.oauthFailure ? {} : { access_token: 'test-token' }, { status: options.oauthFailure ? 401 : 200 });
      if (options.wait) await options.wait;
      if (options.timeout) throw Error('timeout');
      return Response.json({ data: { subscription_id: 123, status: 'new', charge: { id: 456 }, payment_url: options.url || paymentUrl, expire_at: '2026-10-12' } });
    }
  });
  const invoke = (body = { plan_code: 'single_monthly' }, headers = {}) => handler(new Request('https://functions.example/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }));
  return { invoke, rows, calls };
}
test('creates, saves and reuses a checkout without duplicate; values come from server', async () => {
  const f = fixture();
  assert.equal((await f.invoke()).status, 200);
  const second = await (await f.invoke()).json();
  assert.equal(second.reused, true);
  assert.equal(f.rows.length, 1);
  assert.equal(f.calls.length, 2);
  assert.equal(f.rows[0].efi_subscription_id, '123');
  assert.equal(f.rows[0].status, 'pending');
  assert.equal(f.rows[0].payment_url, paymentUrl);
  const body = JSON.parse(f.calls[1].request.body);
  assert.equal(body.items[0].value, 39000);
  assert.equal(body.metadata.custom_id, f.rows[0].id);
  assert.equal(body.customer, undefined);
  assert.equal(body.notification_url, undefined);
  assert.equal((await f.invoke({ plan_code: 'multi_monthly' })).status, 409);
});
test('multi plan uses its homologation ID and R$490 server price', async () => {
  const f = fixture(); await f.invoke({ plan_code: 'multi_monthly' });
  assert(f.calls[1].url.includes('/72117/'));
  assert.equal(JSON.parse(f.calls[1].request.body).items[0].value, 49000);
});
test('concurrent requests reserve one row and send one creation POST', async () => {
  let release; const wait = new Promise(resolve => { release = resolve; });
  const f = fixture({ wait });
  const first = f.invoke();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await f.invoke()).status, 409);
  release(); assert.equal((await first).status, 200);
  assert.equal(f.rows.length, 1); assert.equal(f.calls.length, 2);
});
test('production, unauthenticated and malicious requests never contact Efí', async () => {
  for (const options of [{ environment: 'production' }, { unauthenticated: true }, { profile: { ...profile, cpf: null } }, { profile: null }, { plan: { active: false } }]) {
    const f = fixture(options); assert((await f.invoke()).status >= 400); assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  assert.equal((await f.invoke({ plan_code: 'single_monthly', user_id: 'victim', price_cents: 1 })).status, 400);
  assert.equal((await f.invoke({}, { origin: 'https://evil.example' })).status, 403);
  assert.equal(f.calls.length, 0);
});
test('timeout or failed persistence blocks subsequent creation until reconciliation', async () => {
  for (const options of [{ timeout: true }, { failSave: true }, { url: 'https://evil.example/checkout' }]) {
    const f = fixture(options);
    assert.equal((await f.invoke()).status, 502);
    assert.equal(f.rows[0].creation_state, 'review');
    assert.equal((await f.invoke()).status, 409);
    assert.equal(f.calls.length, 2);
  }
});
test('failure before subscription POST can be retried safely', async () => {
  const f = fixture({ oauthFailure: true });
  await f.invoke(); assert.equal(f.rows[0].status, 'failed');
  await f.invoke(); assert.equal(f.rows.length, 2);
  assert(f.calls.every(call => call.url.endsWith('/authorize')));
});
test('expired links and active subscriptions do not create replacements', async () => {
  const f = fixture(); await f.invoke(); f.rows[0].payment_expires_at = '2026-10-04';
  assert.equal((await f.invoke()).status, 409); f.rows[0].status = 'active';
  assert.equal((await f.invoke()).status, 409); assert.equal(f.calls.length, 2);
});
test('redirect allowlist rejects credentials, insecure URLs and deceptive domains', () => {
  assert(safePaymentUrl(paymentUrl));
  for (const url of ['http://pagamento.efipay.com.br/a', 'https://pagamento.efipay.com.br.evil.example/a', 'https://user@pagamento.efipay.com.br/a', 'javascript:alert(1)']) assert.equal(safePaymentUrl(url), false);
});
