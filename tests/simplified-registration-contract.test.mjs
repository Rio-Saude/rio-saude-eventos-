import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { healthScreeningPayload, profileUpdatePayload } from '../simplified-registration-core.mjs';

const page = await readFile(new URL('../simplified-registration.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../simplified-registration.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261023120000_simplified_registration.sql', import.meta.url), 'utf8');
const grantsMigration = await readFile(new URL('../supabase/migrations/20261023130000_lock_down_simplified_registration_grants.sql', import.meta.url), 'utf8');
const registrationsAdmin = await readFile(new URL('../admin-cadastros.html', import.meta.url), 'utf8');

class TestFormData {
  constructor(values) { this.values = new Map(Object.entries(values)); }
  get(name) { return this.values.get(name) ?? null; }
  has(name) { return this.values.has(name); }
}

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

test('complete simplified registration preserves personal data while persisting the sports profile', () => {
  const athlete = { first_name: 'Ana', last_name: 'Silva', whatsapp: '21999999999', birth_date: '1990-01-02', city: 'Rio de Janeiro' };
  const personal = profileUpdatePayload({ stage: 4 }, new TestFormData(athlete));
  Object.assign(athlete, personal);
  const sport = profileUpdatePayload({ stage: 5, modalities: ['corrida'], running_experience: '1 a 2 anos', goal_events: [{ name: 'Prova teste', event_date: '2027-01-10' }] }, new TestFormData({}));
  Object.assign(athlete, sport);
  assert.deepEqual(athlete, {
    first_name: 'Ana', last_name: 'Silva', whatsapp: '21999999999', birth_date: '1990-01-02', city: 'Rio de Janeiro',
    modalities: ['corrida'], running_experience: '1 a 2 anos', goal_events: [{ name: 'Prova teste', event_date: '2027-01-10' }]
  });
  assert.equal('first_name' in sport, false);
  assert.equal('city' in sport, false);
});

test('active sessions hydrate profile and state before rendering the simplified registration', () => {
  assert.match(app, /session=data\.session; if\(session\?\.user\) await loadUser\(\); render\(\)/);
  assert.match(app, /const s=await client\.from\('simplified_registration_states'\)/);
});

test('a positive health response creates the internal follow-up signal without formal PAR-Q fields', () => {
  const form = new TestFormData({ q1: 'no', q2: 'yes', q3: 'no', q4: 'no', q5: 'no', q6: 'no', q7: 'no', q8: 'no', q9: 'no', q10: 'no' });
  const triage = healthScreeningPayload('00000000-0000-0000-0000-000000000001', form);
  assert.equal(triage.medical_review_recommended, true);
  assert.equal(triage.answers.q2, true);
  assert.doesNotMatch(JSON.stringify(triage), /signed_name|declaration_accepted/);
  assert.match(migration, /admins read simplified health triage/);
  assert.match(registrationsAdmin, /health_triage_positive/);
});

test('administrative registration list is private, includes incomplete registrations, and exports no health answers', () => {
  assert.match(registrationsAdmin, /db\.rpc\('is_admin'\)/);
  assert.match(registrationsAdmin, /simplified_registration_states/);
  assert.match(registrationsAdmin, /athlete_profiles/);
  assert.match(registrationsAdmin, /completed_at\?'completed':'in_progress'/);
  assert.match(registrationsAdmin, /cadastros-iniciais-rio-saude\.csv/);
  assert.match(registrationsAdmin, /Acompanhamento de saúde/);
  assert.match(registrationsAdmin, /\^\[=\+\\-@\\t\\r\]/);
  assert.doesNotMatch(registrationsAdmin, /\.select\('user_id,answers/);
  assert.match(migration, /admins read simplified registration states/);
  assert.match(grantsMigration, /revoke all privileges.*public, anon, authenticated/);
  assert.match(grantsMigration, /grant select, insert, update.*simplified_registration_states/);
  assert.match(grantsMigration, /grant select, insert.*simplified_health_screenings/);
});
