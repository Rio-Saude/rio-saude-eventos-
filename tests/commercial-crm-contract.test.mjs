import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20261021093000_onboarding_experimental_crm.sql', import.meta.url), 'utf8');
const onboarding = await readFile(new URL('../onboarding.js', import.meta.url), 'utf8');

test('experimental invitations are server-bound, exclusive, and thirty days long', () => {
  assert.match(migration, /ends_on = starts_on \+ 29/);
  assert.match(migration, /lower\(invited_email\)=v_email/);
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
});

test('the browser bypasses Efí only after server-reported trial access', () => {
  assert.match(onboarding, /client\.rpc\('my_trial_access'\)/);
  assert.match(onboarding, /client\.rpc\('claim_trial_invitation'/);
  assert.match(onboarding, /if \(trialAccess && trialAccess\.lifecycle_status !== 'trial_expired_decision_pending'\)/);
  assert.match(onboarding, /const needsPayment = !trialAccess/);
});
