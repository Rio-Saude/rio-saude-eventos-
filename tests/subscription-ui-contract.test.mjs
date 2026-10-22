import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8');
const [page, logic, css, space] = await Promise.all([
  read('homologacao-publica/minha-assinatura-homologacao.html'),
  read('homologacao-publica/minha-assinatura.js'),
  read('homologacao-publica/portal.css'),
  read('homologacao-publica/meu-espaco-homologacao.html')
]);

test('Meu plano keeps the portal entry point and compiles without changing the billing backend', () => {
  assert.doesNotThrow(() => new Function(logic));
  assert.match(space, /href="minha-assinatura-homologacao\.html"/);
  assert.match(page, /id="subscription-back"/);
  assert.match(page, /id="content"/);
  assert.match(css, /\.subscription-primary-card/);
  assert.match(css, /\.subscription-body \[hidden\]/);
  assert.match(logic, /\.eq\('environment','homologation'\)/);
  assert.match(logic, /client\.functions\.invoke\('efi-billing', \{body:\{action:'cancel'\}\}\)/);
  assert.match(logic, /onboarding-homologacao\.html\?payment=1/);
  assert.doesNotMatch(logic, /service_role|EFI_CLIENT_SECRET|zzxveirmtgnrokgjthhy/);
});

test('Only existing monthly plans are billed: quarterly/semiannual are informational', () => {
  assert.match(logic, /Trimestral e semestral/);
  assert.match(logic, /Em avaliação/);
  assert.match(logic, /modality_tier/);
  assert.doesNotMatch(logic, /action:'change_plan'|action:'create_subscription'/);
  assert.match(logic, /subscription\.next_charge_on/);
  assert.match(logic, /free_trial_days/);
});

async function renderFor({tier='single', status='active', payment='card'}={}) {
  const elements = {
    '#content': {innerHTML:''},
    '#subscription-back': {href:'',textContent:''}
  };
  const profile = {id:'profile-fixture',base_preference:'Lagoa',onboarding_completed_at:'2026-10-21T10:00:00Z'};
  const sub = {id:'subscription-fixture',status,payment_method:payment,price_cents:tier==='multi'?49000:39000,free_trial_days:0,trial_ends_on:null,first_charge_on:'2026-11-15',next_charge_on:'2026-11-15',first_due_on:'2026-11-15',cancelled_effective_on:status==='cancelled'?'2026-11-14':null,billing_plans:{name:tier==='multi'?'2 ou mais modalidades':'1 modalidade',modality_tier:tier,interval_months:1}};
  function query(table) {
    const chain = {
      select(){return this;},eq(){return this;},order(){return this;},limit(){return this;},
      async maybeSingle(){return {data:table==='athlete_profiles'?profile:sub,error:null};},
      then(resolve,reject){return Promise.resolve({data:[],error:null}).then(resolve,reject);}
    };
    return chain;
  }
  const client = {auth:{async getUser(){return {data:{user:{id:'athlete-fixture'}},error:null};}},from:query,functions:{invoke(){throw Error('Never call billing on a read-only render');}}};
  const doc = {querySelector(selector){return elements[selector]||null;}};
  const win = {RIO_SAUDE_CONFIG:{supabaseUrl:'https://staging.supabase.co',supabaseAnonKey:'publishable-fixture'},supabase:{createClient:()=>client}};
  runInNewContext(logic,{window:win,document:doc,Date,URL,Intl});
  for(let n=0;n<8;n++) await Promise.resolve();
  return elements['#content'].innerHTML;
}

test('Single modality renders Corrida without cheaper alternative plans',async()=>{
  const html=await renderFor();
  assert.match(html, />Corrida<\/h2>/);
  assert.match(html, /Base Lagoa/);
  assert.match(html, /Conheça o Triathlon/);
  assert.match(html, /Trimestral e semestral/);
  assert.doesNotMatch(html, /Corrida Online|Aterro|trocar automaticamente/i);
});

test('Multiple modalities render Triathlon with no duplicate Triathlon promotion',async()=>{
  const html=await renderFor({tier:'multi'});
  assert.match(html, />Triathlon<\/h2>/);
  assert.match(html, /Natação, ciclismo e corrida/);
  assert.doesNotMatch(html, /Conheça o Triathlon/);
});

test('Cancelled subscriptions offer rehire and never show the cancellation action again',async()=>{
  const html=await renderFor({status:'cancelled'});
  assert.match(html, /Sem novas cobranças/);
  assert.match(html, /Contratar novamente/);
  assert.doesNotMatch(html, /id="cancel"/);
});
