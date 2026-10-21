import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20261021093000_onboarding_experimental_crm.sql', import.meta.url), 'utf8');
const onboarding = await readFile(new URL('../onboarding.js', import.meta.url), 'utf8');
const productionConfig = await readFile(new URL('../config.js', import.meta.url), 'utf8');
const homologationConfig = await readFile(new URL('../config-homologacao.js', import.meta.url), 'utf8');
const homologationRaceCatalog = await readFile(new URL('../supabase/homologation/20261021121000_onboarding_test_race_catalog.sql', import.meta.url), 'utf8');
const presentation = await readFile(new URL('../apresentacao.html', import.meta.url), 'utf8');
const commercialAdmin = await readFile(new URL('../commercial-admin.js', import.meta.url), 'utf8');
const financialFollowupMigration = await readFile(new URL('../supabase/migrations/20261021150000_commercial_financial_followup.sql', import.meta.url), 'utf8');
const publicHomologationIndex = await readFile(new URL('../homologacao-publica/dist/index.html', import.meta.url), 'utf8');
const publicHomologationConfig = await readFile(new URL('../homologacao-publica/dist/config-homologacao.js', import.meta.url), 'utf8');
const operationsMigration = await readFile(new URL('../supabase/migrations/20261021170000_homologation_billing_operations.sql', import.meta.url), 'utf8');
const efiSandboxPlans = await readFile(new URL('../supabase/homologation/20261021180000_efi_homologation_plans.sql', import.meta.url), 'utf8');
const efiPlanProvisioning = await readFile(new URL('../supabase/functions/efi-activate-discounted-plans/index.ts', import.meta.url), 'utf8');

test('experimental invitations are server-bound, exclusive, and thirty days long', () => {
  assert.match(migration, /ends_on = starts_on \+ 29/);
  assert.match(migration, /lower\(invited_email\)=v_email/);
  assert.match(migration, /starts_on <= \(now\(\) at time zone 'America\/Sao_Paulo'\)::date/);
  assert.match(migration, /if v_invite\.claimed_at is not null then raise exception 'invitation already used'/);
  assert.match(migration, /grant execute on function public\.claim_trial_invitation\(text\) to authenticated/);
  assert.doesNotMatch(migration, /grant execute on function public\.claim_trial_invitation\(text\) to anon/);
});

test('commercial task keys make daily processing idempotent and São Paulo-aware', () => {
  assert.match(migration, /unique \(athlete_user_id, task_key\)/);
  assert.match(migration, /America\/Sao_Paulo/);
  assert.match(migration, /process_commercial_tasks/);
  assert.match(migration, /trial_7_days/);
  assert.match(migration, /trial_3_days/);
  assert.match(migration, /trial_expired_decision/);
  assert.match(migration, /on conflict \(athlete_user_id,task_key\) do update set status='open'/);
});

test('the browser bypasses Efí only after server-reported trial access', () => {
  assert.match(onboarding, /client\.rpc\('my_trial_access'\)/);
  assert.match(onboarding, /client\.rpc\('claim_trial_invitation'/);
  assert.match(onboarding, /if \(trialAccess && trialAccess\.lifecycle_status !== 'trial_expired_decision_pending'\)/);
  assert.match(onboarding, /const needsPayment = !trialAccess/);
});

test('no administrative browser action can declare a payment or conversion confirmed', async () => {
  const admin = await readFile(new URL('../commercial-admin.js', import.meta.url), 'utf8');
  assert.doesNotMatch(admin, /confirmed_efi|Confirmar Efí/);
  assert.doesNotMatch(migration, /elsif p_action='confirmed_efi'/);
  assert.match(migration, /if p_funnel_status not in \('not_converted','contact_pending','negotiating','lost'\)/);
});

test('completion resolves only the interrupted-onboarding task, not payment state', () => {
  assert.match(migration, /sync_commercial_profile_completion/);
  assert.match(migration, /task_key='incomplete_onboarding' and status='open'/);
  assert.doesNotMatch(migration, /payment_status='confirmed'/);
});

test('financial deferral is isolated to the known homologation project', () => {
  assert.match(onboarding, /const isHomologationPreview = config\.supabaseUrl === 'https:\/\/xiiudduncvcxcvbgbqpc\.supabase\.co'/);
  assert.match(onboarding, /config\.environmentLabel === 'HOMOLOGAÇÃO'/);
  assert.match(onboarding, /id="finance-later-homologation"/);
  assert.match(onboarding, /payment_status: 'pending', payment_followup_needed: true, onboarding_step: 5/);
  assert.match(onboarding, /const canFinishWithFinancialFollowup = isHomologationPreview/);
  assert.doesNotMatch(onboarding, /environment\) === 'homologacao'/);
  assert.doesNotMatch(productionConfig, /xiiudduncvcxcvbgbqpc/);
  assert.match(homologationConfig, /https:\/\/xiiudduncvcxcvbgbqpc\.supabase\.co/);
  assert.match(homologationConfig, /environmentLabel: "HOMOLOGAÇÃO"/);
});

test('homologation race catalog is isolated, read-only, and uses non-personal fixtures', () => {
  assert.match(onboarding, /const raceCatalogSource = isHomologationPreview \? 'onboarding_race_catalog' : 'events'/);
  assert.match(onboarding, /client\.from\(raceCatalogSource\)/);
  assert.match(homologationRaceCatalog, /HOMOLOGATION ONLY\. Never apply this file to production/);
  assert.match(homologationRaceCatalog, /alter table public\.onboarding_race_catalog enable row level security/);
  assert.match(homologationRaceCatalog, /revoke all on public\.onboarding_race_catalog from anon/);
  assert.match(homologationRaceCatalog, /grant select on public\.onboarding_race_catalog to authenticated/);
  assert.match(homologationRaceCatalog, /Prova de teste Rio Saúde/);
  assert.doesNotMatch(homologationRaceCatalog, /athlete_email|cpf|health_screenings|auth\.users/i);
});

test('landing routes only monthly coaching plans to the isolated homologation onboarding', () => {
  assert.match(presentation, /const onboardingPage=isHomologationLanding\?'onboarding-homologacao\.html':'onboarding\.html'/);
  assert.match(presentation, /'Corrida — Lagoa':'single_monthly'/);
  assert.match(presentation, /'Corrida — Barra \/ Aterro':'single_290_monthly'/);
  assert.match(presentation, /'Triathlon':'multi_monthly'/);
  assert.match(presentation, /months===1/);
  assert.match(presentation, /onboardingPage\+'\?plan='\+encodeURIComponent\(planCode\)/);
  assert.match(presentation, /months>1/);
  assert.match(presentation, /wa\.me\/5521999410202/);
  assert.match(presentation, /Consultar Sport Lab/);
  assert.match(presentation, /data-panel="lab"[^]*?https:\/\/wa\.me\/5521999410202/);
});

test('URL plan preference is limited to known coaching plans', () => {
  assert.match(onboarding, /new Set\(\['single_monthly', 'single_290_monthly', 'multi_monthly'\]\)/);
  assert.match(onboarding, /if \(!selectablePlanCodes\.has\(selected\)/);
  assert.doesNotMatch(onboarding, /\^\[a-z0-9_-\]\{2,64\}/);
});

test('trial invitations use the configured onboarding page', () => {
  assert.match(commercialAdmin, /page=config\.onboardingPage\|\|'onboarding\.html'/);
  assert.match(commercialAdmin, /\$\{page\}\?trial=/);
  assert.match(homologationConfig, /onboardingPage: "onboarding-homologacao\.html"/);
});

test('financial follow-up remains open until trusted payment confirmation', () => {
  assert.match(financialFollowupMigration, /'financial_followup'/);
  assert.match(financialFollowupMigration, /p\.payment_followup_needed or p\.payment_status <> 'confirmed'/);
  assert.match(financialFollowupMigration, /p\.payment_status='confirmed'/);
  assert.match(financialFollowupMigration, /lifecycle_status='awaiting_contract'/);
  assert.doesNotMatch(financialFollowupMigration, /set\s+payment_status\s*=\s*'confirmed'/i);
});

test('public homologation bundle contains only the isolated Supabase configuration', () => {
  assert.match(publicHomologationIndex, /const isHomologationLanding=true/);
  assert.match(publicHomologationIndex, /onboarding-homologacao\.html/);
  assert.match(publicHomologationConfig, /https:\/\/xiiudduncvcxcvbgbqpc\.supabase\.co/);
  assert.doesNotMatch(publicHomologationIndex, /zzxveirmtgnrokgjthhy/);
  assert.doesNotMatch(publicHomologationConfig, /zzxveirmtgnrokgjthhy|service_role/i);
});

test('financial operations remain server-controlled, with durable charge history and no fake confirmation', () => {
  assert.match(operationsMigration, /create table if not exists public\.billing_charges/);
  assert.match(operationsMigration, /alter table public\.billing_charges enable row level security/);
  assert.match(operationsMigration, /revoke all on public\.billing_charges from anon, authenticated/);
  assert.match(operationsMigration, /free_trial_days smallint not null default 0 check \(free_trial_days in \(0,30\)\)/);
  assert.match(operationsMigration, /free_trial_available/);
  assert.match(operationsMigration, /prior\.cpf=current_profile\.cpf/);
  assert.doesNotMatch(operationsMigration, /set\s+payment_status\s*=\s*'confirmed'/i);
});

test('future notification queue and daily rules are idempotent', () => {
  assert.match(operationsMigration, /event_key text/);
  assert.match(operationsMigration, /commercial_events_one_key_per_athlete/);
  assert.match(operationsMigration, /on conflict \(athlete_user_id,event_key\).*do nothing/);
  assert.match(operationsMigration, /trial_7_days:/);
  assert.match(operationsMigration, /trial_3_days:/);
  assert.match(operationsMigration, /trial_expired:/);
});

test('simple admin operations view remains restricted and excludes PAR-Q', async () => {
  const admin = await readFile(new URL('../commercial-admin.js', import.meta.url), 'utf8');
  assert.match(operationsMigration, /admin_operations_dashboard/);
  assert.match(operationsMigration, /auth\.uid\(\) is not null and public\.is_admin\(\)/);
  assert.doesNotMatch(operationsMigration, /health_screenings/);
  assert.match(admin, /admin_operations_dashboard/);
  assert.match(admin, /students:'Alunos',races:'Provas',finance:'Financeiro',tasks:'Pendências'/);
});

test('sandbox plan provisioning is admin-only, isolated and uses the existing four prices', () => {
  assert.match(efiSandboxPlans, /HOMOLOGATION ONLY\. Do not apply to production/);
  for (const [code, price] of [['single_monthly',39000],['single_290_monthly',29000],['multi_monthly',49000],['multi_tri_u26_monthly',39000]]) {
    assert.match(efiSandboxPlans, new RegExp(`\\('${code}'.*${price}`));
  }
  assert.match(efiPlanProvisioning, /EFI_ENV"\) !== "homologation"/);
  assert.match(efiPlanProvisioning, /admin_only/);
  assert.match(efiPlanProvisioning, /https:\/\/cobrancas-h\.api\.efipay\.com\.br/);
  assert.doesNotMatch(efiPlanProvisioning, /cobrancas\.api\.efipay\.com\.br/);
});
