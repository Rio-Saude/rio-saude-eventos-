import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../simplified-registration.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../simplified-registration.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261023120000_simplified_registration.sql', import.meta.url), 'utf8');

test('simplified registration is a standalone route that reuses the existing visual and PAR-Q question modules', () => {
  assert.match(page, /portal\.css/);
  assert.match(page, /parq\.js/);
  assert.match(page, /simplified-registration\.js/);
  assert.match(app, /window\.RioSaudePARQ\?\.questions/);
});

test('simplified registration does not invoke billing, TrainingPeaks, or formal PAR-Q acceptance', () => {
  assert.doesNotMatch(app, /efi-create-subscription|billing_subscriptions|declaration_accepted|signed_name/);
  assert.match(app, /Nenhuma cobrança, assinatura, ativação de TrainingPeaks ou PAR-Q formal/);
});

test('the migration preserves formal onboarding and stores triage separately with owner-only writes', () => {
  assert.match(migration, /simplified_registration_states/);
  assert.match(migration, /simplified_health_screenings/);
  assert.match(migration, /health_triage_positive/);
  assert.match(migration, /user_id = \(select auth\.uid\(\)\)/);
  assert.doesNotMatch(migration, /onboarding_completed_at/);
});
