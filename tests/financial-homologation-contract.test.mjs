import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../supabase/functions/efi-billing/index.ts', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/homologation/20261021190000_billing_trials_webhooks.sql', import.meta.url), 'utf8');
const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
const onboarding = await readFile(new URL('../onboarding.js', import.meta.url), 'utf8');

test('card trial is server-side, token-only, and remains unconfirmed', () => {
  assert.match(source, /payment_token_required/);
  assert.match(source, /trial_days:eligible\?30/);
  assert.match(source, /payment_status:'pending',payment_followup_needed:true/);
  assert.doesNotMatch(source, /payment_status:'confirmed'/);
});

test('boleto trial has a persisted 20th-day issue date and 30th-day due date', () => {
  assert.match(source, /boleto_issue_on:method==='boleto'&&useTrial\?addDays\(start,19\)/);
  assert.match(source, /first_due_on:method==='boleto'\?\(useTrial\?ends:start\)/);
  assert.match(source, /creation_state:'scheduled'/);
  assert.match(migration, /due_boleto_trials/);
});

test('webhook ledger and browser data use ownership RLS, not public write access', () => {
  assert.match(migration, /revoke all on public\.billing_webhook_events from anon, authenticated/);
  assert.match(migration, /billing_customer_profiles_own/);
  assert.match(migration, /billing_charges_read_own/);
});

test('cancellation requires the provider response before persisting cancellation', () => {
  const cancellation = source.slice(source.indexOf("if(body.action==='cancel')"), source.indexOf("if(typeof body.plan_code"));
  assert.match(cancellation, /\/cancel/);
  assert.match(cancellation, /if\(!r\.ok\) throw new Error\('efi_cancel_failed'\)/);
  assert.match(cancellation, /provider_cancelled_at/);
});

test('browser billing allows CORS preflight but keeps every action authenticated in the handler', () => {
  assert.match(config, /\[functions\.efi-billing\][\s\S]*?verify_jwt = false/);
  assert.match(source, /if\(req\.method==='OPTIONS'\) return new Response\(null,\{status:204,headers:h\}\)/);
  assert.match(source, /const user=scheduledWorker \? null : await userFor\(req\)/);
  assert.match(source, /if\(!scheduledWorker && !user\) return json\(req,401,\{error:'authentication_required'\}\)/);
});

test('checkout normalizes and validates a Brazilian billing address before the request', () => {
  assert.match(onboarding, /replace\(\/\[\^a-z\]\/gi, ''\)\.toUpperCase\(\)/);
  assert.match(onboarding, /billing_address_invalid/);
  assert.match(onboarding, /\^\\d\{8\}\$/);
});
