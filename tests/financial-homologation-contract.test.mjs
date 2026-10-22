import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../supabase/functions/efi-billing/index.ts', import.meta.url), 'utf8');
const cronWorker = await readFile(new URL('../supabase/functions/efi-billing-cron/index.ts', import.meta.url), 'utf8');
const followupMigration = await readFile(new URL('../supabase/migrations/20261021194256_homologation_hosted_card_whatsapp_followup.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/homologation/20261021190000_billing_trials_webhooks.sql', import.meta.url), 'utf8');
const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
const onboarding = await readFile(new URL('../onboarding.js', import.meta.url), 'utf8');
const publicOnboarding = await readFile(new URL('../homologacao-publica/dist/onboarding.js', import.meta.url), 'utf8');

test('hosted card trial is server-side, delayed, and remains unconfirmed', () => {
  assert.match(source, /card_hosted_trial/);
  assert.match(source, /checkout_deferred:true/);
  assert.match(source, /subscription\/one-step\/link/);
  assert.match(source, /payment_method:'credit_card'/);
  assert.doesNotMatch(source, /payment_token/);
  assert.match(source, /payment_status:'pending',payment_followup_needed:true/);
  assert.doesNotMatch(source, /payment_status:'confirmed'/);
});

test('boleto trial has a persisted 20th-day issue date and 30th-day due date', () => {
  assert.match(source, /boleto_issue_on:method==='boleto'&&useTrial\?addDays\(start,19\)/);
  assert.match(source, /first_due_on:method==='boleto'\?\(useTrial\?ends:start\)/);
  assert.match(source, /creation_state:'scheduled'/);
  assert.match(migration, /due_boleto_trials/);
});

test('hosted card checkout is created on day 25 and is valid through day 31', () => {
  assert.match(source, /checkout_kind','card_hosted_trial/);
  assert.match(source, /checkout_link_on:kind==='card_hosted_trial'\?addDays\(start,24\):null/);
  assert.match(source, /checkout_reminder_on:kind==='card_hosted_trial'\?addDays\(start,30\):null/);
  assert.match(cronWorker, /\.lte\('checkout_link_on', today\)/);
  assert.match(cronWorker, /addDays\(today, 6\)/);
  assert.match(cronWorker, /card_checkout_day_25/);
  assert.match(cronWorker, /card_checkout_day_31/);
});

test('WhatsApp follow-up has explicit consent, a durable idempotent ledger, and remains disabled without configuration', () => {
  assert.match(followupMigration, /whatsapp_financial_contact_authorized boolean not null default false/);
  assert.match(followupMigration, /unique\(subscription_id,message_kind\)/);
  assert.match(followupMigration, /revoke all on public\.billing_notification_attempts from anon, authenticated/);
  assert.match(cronWorker, /EVOLUTION_SEND_ENABLED_HOMOLOG/);
  assert.match(cronWorker, /evolution_delivery_disabled/);
  assert.match(cronWorker, /apikey: apiKey/);
  assert.match(cronWorker, /notification_no_longer_eligible/);
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

test('onboarding does not render or send card details to Rio Saúde', () => {
  assert.doesNotMatch(onboarding, /card_cvv/);
  assert.doesNotMatch(onboarding, /card_number/);
  assert.match(onboarding, /action:paymentMethod === 'boleto' \? 'boleto' : 'card_hosted'/);
  assert.match(onboarding, /checkout oficial da Efí/);
});

test('checkout retains its form before the asynchronous duplicate check', () => {
  const checkout = onboarding.slice(onboarding.indexOf('async function startCheckout'), onboarding.indexOf('function renderTrainingPeaks'));
  assert.match(checkout, /const formElement = event\.currentTarget/);
  assert.match(checkout, /const formData = new FormData\(formElement\)/);
  assert.match(checkout, /const form = Object\.fromEntries\(formData\)/);
  assert.doesNotMatch(checkout, /new FormData\(event\.currentTarget\)/);
});

test('free trial is decided by backend history, not an offer URL parameter', () => {
  assert.match(source, /const eligible=await trialAvailable\(c\.profile\.id\);/);
  assert.doesNotMatch(source, /body\.offer/);
  for (const code of [onboarding, publicOnboarding]) {
    assert.doesNotMatch(code, /requestedOffer|offer=standard|offer=trial/);
    assert.match(code, /action:paymentMethod === 'boleto' \? 'boleto' : 'card_hosted'/);
  }
});

test('re-contract preserves an unexpired consumed trial and schedules checkout after it', () => {
  assert.match(source, /cancelledTrialStillActive/);
  assert.match(source, /const checkoutOn=addDays\(prior\.trial_ends_on,1\);/);
  assert.match(source, /reviveUnprovisionedTrial/);
  assert.match(source, /checkout_link_on:method==='card'\?addDays\(prior\.trial_ends_on,-5\):null/);
  assert.match(source, /resumed_trial:true,checkout_deferred:true/);
  assert.match(cronWorker, /'card_hosted_trial', 'card_hosted_resume'/);
  assert.match(onboarding, /paymentOnlyMode/);
});

test('immediate card checkout opens from the trusted click and keeps a manual fallback', () => {
  assert.match(source, /body\.action==='payment_mode'/);
  assert.match(source, /card_checkout:await cardCheckoutMode\(profile\.id\)/);
  assert.match(onboarding, /const checkoutPopup = selectedMethod === 'card' \? openEfiCheckoutFromClick\(\) : null/);
  assert.match(onboarding, /window\.open\('about:blank', '_blank'\)/);
  assert.match(onboarding, /redirectEfiCheckout\(checkoutPopup,paymentUrl\)/);
  assert.match(onboarding, /Abrir o checkout da Efí/);
  assert.match(onboarding, /data\?\.checkout_deferred/);
});
