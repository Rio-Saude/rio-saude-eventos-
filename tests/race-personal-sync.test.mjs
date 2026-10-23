import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const [page,races,onboarding,onboardHtml,css,parq]=await Promise.all([
  read('homologacao-publica/minhas-provas-homologacao.html'),
  read('homologacao-publica/minhas-provas.js'),
  read('homologacao-publica/onboarding.js'),
  read('homologacao-publica/onboarding-homologacao.html'),
  read('homologacao-publica/portal.css'),
  read('homologacao-publica/parq.js')
]);
test('races synchronize with onboarding goals before optional collective moderation',()=>{
  assert.doesNotThrow(()=>new Function(races));
  assert.match(races,/onboarding_completed_at,goal_events/);
  assert.match(races,/function renderMine\(\)[\s\S]*state\.goals/);
  assert.match(races,/goal_events:goals/);
  assert.ok(races.indexOf('await persistGoals(next);')<races.indexOf('queued=await submitForCalendar(entry);'));
  assert.match(races,/function goalCard\(goal\)/);
  assert.match(races,/function removeGoal\(goal,button\)/);
  assert.match(page,/id="suggest-intent"/);
  assert.match(page,/id="race-add-from-mine"/);
});
test('athletes have 5k, 10k, half and marathon calendar filters',()=>{
  for(const value of ['run5','run10','half','marathon','trail','tri']) assert.match(page,new RegExp('value="'+value+'"'));
  const i=races.indexOf('function matchesFilter(event) {'),end=races.indexOf('const future =',i);
  assert.ok(i>=0&&end>i);
  const categoryOf=e=>/triathlon|triatlo|ironman/i.test(e.category||'')?'tri':/trail|montanha/i.test(e.category||'')?'trail':'run';
  const check=(category,event)=>new Function('state','categoryOf','event',races.slice(i,end)+';return matchesFilter(event)')({category},categoryOf,event);
  assert.equal(check('run5',{category:'Corrida',name:'Corrida 5 km'}),true);
  assert.equal(check('run10',{category:'Corrida',name:'Corrida 10 km'}),true);
  assert.equal(check('half',{category:'Corrida',name:'Meia Maratona'}),true);
  assert.equal(check('marathon',{category:'Corrida',name:'Meia Maratona'}),false);
  assert.equal(check('marathon',{category:'Corrida',name:'Maratona'}),true);
  assert.equal(check('tri',{category:'Triathlon',name:'70.3'}),true);
});
test('onboarding edits retain personal race fields',()=>{
  assert.doesNotThrow(()=>new Function(onboarding));
  assert.match(onboarding,/goal_events:races/);
  for(const field of ['status','distance','category','city','notes']) assert.match(onboarding,new RegExp('entry\\.'+field));
  assert.match(onboardHtml,/onboarding\.js\?v=20261022-races/);
});
test('PAR-Q and race remove buttons are mobile touch-friendly',()=>{
  assert.match(parq,/name="term_accept"/);
  assert.match(css,/\.parq-option\{min-height:48px\}/);
  assert.match(css,/width:22px;height:22px/);
  assert.match(css,/#selected-race-list \.race-selected-item \.secondary-btn/);
  assert.match(css,/min-width:44px;max-width:44px;min-height:44px/);
});

test('old race suggestions appear as personal interests without an admin decision',()=>{
  assert.match(races,/Older "Sugerir prova" submissions had no personal record/);
  assert.match(races,/const imported=state\.goals\.slice\(\)/);
  assert.match(races,/status:"interest"/);
  assert.match(races,/await persistGoals\(imported\)/);
  assert.match(races,/id,name,event_date,city,category,distance,status/);
});
