import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read = name=>readFile(new URL('../'+name,import.meta.url),'utf8');
const [page,script,adminPage,adminScript,schema,seed,build,space] = await Promise.all([
  read('homologacao-publica/minhas-provas-homologacao.html'),
  read('homologacao-publica/minhas-provas.js'),
  read('homologacao-publica/admin-provas-homologacao.html'),
  read('homologacao-publica/admin-provas.js'),
  read('docs/minhas-provas-homologacao-v1.sql'),
  read('docs/minhas-provas-seed-homologacao-20261022.sql'),
  read('scripts/build-homologation-public.mjs'),
  read('homologacao-publica/meu-espaco-homologacao.html')
]);
test('race page and admin page compile and are linked from Meu espaco',()=>{
  assert.doesNotThrow(()=>new Function(script));
  assert.doesNotThrow(()=>new Function(adminScript));
  assert.match(space,/href="minhas-provas-homologacao\.html"/);
  for(const f of ['minhas-provas-homologacao.html','minhas-provas.js','admin-provas-homologacao.html','admin-provas.js']){
    assert.match(build,new RegExp(f.replaceAll('.','\\.')));
  }
  assert.match(page,/id="race-calendar-grid"/);
  assert.match(page,/id="race-mine-grid"/);
  assert.match(adminPage,/id="race-review-list"/);
  assert.doesNotMatch(page+script+adminPage+adminScript,/zzxveirmtgnrokgjthhy|service_role|EFI_CLIENT_SECRET/);
});
test('race status belongs to authenticated athlete and public count is anonymous aggregate only',()=>{
  assert.match(script,/client\.auth\.getUser\(\)/);
  assert.match(script,/select\("onboarding_completed_at"\)/);
  assert.match(script,/\.eq\("user_id",user\.id\)/);
  assert.match(script,/user_id:state\.user\.id/);
  assert.match(script,/client\.rpc\("race_counts"\)/);
  assert.match(schema,/race_participations_own_create/);
  assert.match(schema,/race_participations_own_edit/);
  assert.match(schema,/race_participations_own_delete/);
  assert.match(schema,/race_private\.counts/);
  assert.match(schema,/where \(select auth\.uid\(\)\) is not null/);
  assert.doesNotMatch(script,/group_interest/);
});
test('suggestions require team approval and race catalog is isolated in homologation',()=>{
  assert.match(script,/status:"pending"/);
  assert.match(adminScript,/client\.rpc\("is_admin"\)/);
  assert.match(adminScript,/client\.rpc\("approve_race_suggestion"/);
  assert.match(schema,/race_suggestions_admin_edit/);
  assert.match(schema,/if \(select auth\.uid\(\)\) is null or not \(select public\.is_admin\(\)\)/);
  assert.match(seed,/insert into public\.events/);
  assert.match(seed,/insert into public\.event_entry_windows/);
  assert.doesNotMatch(seed,/race_responses|athlete_email|athlete_name|cpf/i);
});
