import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const onboarding = await readFile(new URL('../homologacao-publica/onboarding.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../homologacao-publica/meu-espaco-homologacao.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../homologacao-publica/meu-espaco.js', import.meta.url), 'utf8');
const build = await readFile(new URL('../scripts/build-homologation-public.mjs', import.meta.url), 'utf8');

test('completed homologation onboarding routes to Meu espaço without affecting payment or edit flows', () => {
  assert.match(onboarding, /const mySpacePage = isHomologationPreview/);
  assert.match(onboarding, /profile\.onboarding_completed_at && mySpacePage && !editing && !paymentOnlyMode/);
  assert.match(onboarding, /window\.location\.replace\(mySpacePage\)/);
});

test('Meu espaço keeps the four entry points and opens TrainingPeaks externally', () => {
  for (const label of ['Minhas provas', 'Meus treinos', 'Meu plano', 'Meus dados']) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /https:\/\/home\.trainingpeaks\.com\/login/);
  assert.match(page, /target="_blank" rel="noopener noreferrer"/);
  assert.match(page, /Seu treino continua por aqui\./);
});

test('Meu espaço accepts only the current authenticated and completed athlete profile', () => {
  assert.match(script, /client\.auth\.getSession\(\)/);
  assert.match(script, /\.eq\('user_id', session\.user\.id\)/);
  assert.match(script, /select\('first_name,onboarding_completed_at'\)/);
  assert.match(script, /if \(!profile\?\.onboarding_completed_at\)/);
  assert.match(script, /client\.auth\.signOut\(\)/);
  assert.doesNotMatch(script, /service_role|billing_subscriptions|health_screenings/i);
});

test('the homologation build includes only the Meu espaço static assets', () => {
  assert.match(build, /'meu-espaco-homologacao\.html'/);
  assert.match(build, /'meu-espaco\.js'/);
});

test('Minha assinatura keeps the homologation context and returns to Meu espaço', async () => {
  const subscriptionPage = await readFile(new URL('../homologacao-publica/minha-assinatura-homologacao.html', import.meta.url), 'utf8');
  assert.match(subscriptionPage, /HOMOLOGAÇÃO · use somente dados fictícios/);
  assert.match(subscriptionPage, /href="meu-espaco-homologacao\.html">Meu espaço/);
});
