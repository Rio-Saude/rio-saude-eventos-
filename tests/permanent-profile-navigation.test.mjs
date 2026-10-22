import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8');
const [space, dataPage, dataLogic, onboardingPage, onboardingLogic, build] = await Promise.all([
  read('homologacao-publica/meu-espaco-homologacao.html'),
  read('homologacao-publica/meus-dados-homologacao.html'),
  read('homologacao-publica/meus-dados.js'),
  read('homologacao-publica/onboarding-homologacao.html'),
  read('homologacao-publica/onboarding.js'),
  read('scripts/build-homologation-public.mjs')
]);

test('Meu espaço opens the permanent personal-data page', () => {
  assert.match(space, /href="meus-dados-homologacao\.html"/);
  assert.doesNotMatch(space, /href="onboarding-homologacao\.html\?edit=1"/);
  assert.match(dataPage, /id="profile-content"/);
  assert.match(dataPage, /meus-dados\.js/);
  assert.doesNotThrow(() => new Function(dataLogic));
  assert.match(build, /'meus-dados-homologacao\.html'/);
  assert.match(build, /'meus-dados\.js'/);
});

test('Personal updates stay scoped to the authenticated athlete', () => {
  assert.match(dataLogic, /client\.auth\.getUser\(\)/);
  assert.match(dataLogic, /\.eq\('user_id',user\.id\)/);
  assert.match(dataLogic, /\.update\(values\)\.eq\('user_id',currentUser\.id\)/);
  const mapping = dataLogic.match(/const values = \{([\s\S]*?)\n    \};/);
  assert.ok(mapping, 'Editable values map exists');
  assert.match(mapping[1], /first_name/);
  assert.match(mapping[1], /last_name/);
  assert.match(mapping[1], /whatsapp/);
  assert.match(mapping[1], /city/);
  assert.match(mapping[1], /whatsapp_financial_contact_authorized/);
  assert.doesNotMatch(mapping[1], /cpf:|birth_date:|email:|payment_status:|onboarding_step:/);
  assert.doesNotMatch(dataLogic, /efi-billing|create_subscription|service_role/);
});

test('Rehire uses payment step without showing initial onboarding or steps', () => {
  assert.doesNotThrow(() => new Function(onboardingLogic));
  assert.match(onboardingPage, /id="onboarding-hero"/);
  assert.match(onboardingPage, /id="rehire-hero"/);
  assert.match(onboardingPage, /Contratar novamente\./);
  assert.match(onboardingLogic, /completed \|\| paymentOnlyMode/);
  assert.match(onboardingLogic, /if \(paymentOnlyMode\) \{\s*renderProgress\(4\);\s*renderPayment\(\);/);
  assert.match(onboardingLogic, /paymentOnlyMode \? "Escolha seu plano"/);
  assert.match(onboardingLogic, /startCheckout/);
  assert.match(onboardingLogic, /efi-billing/);
});
