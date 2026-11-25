import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalTeamName, teamsInText, TEAM_CATALOG } from '../src/data/identity.ts';
import { calendarDate, parseEspn, parseOpenFootball } from '../src/data/parsers.ts';

const received=Date.UTC(2026,10,15,10);
const fixture={date:'2026-09-01',time:'21:00',team1:'FC Barcelona',team2:'Real Madrid CF',score:{ft:[2,1]}};
const source=(matches:unknown[])=>JSON.stringify({name:'LaLiga',matches});
test('Los 29 equipos históricos y los nombres de MoviOdds tienen correspondencias explícitas; no se aproxima un nombre desconocido',()=> {
  assert.equal(TEAM_CATALOG.length,29);
  const catalog=JSON.parse(readFileSync(new URL('../config/team-aliases.json',import.meta.url),'utf8'));
  for(const team of catalog.teams)for(const alias of team.moviodds)assert.equal(canonicalTeamName(alias),team.name);
  assert.equal(canonicalTeamName('Deportivo'),'RC Deportivo La Coruña');
  assert.equal(canonicalTeamName('Real Madri'),null);
  assert.deepEqual(teamsInText('El Deportivo Alavés tendrá una duda.'),['Deportivo Alavés']);
});
test('El histórico conserva fechas y resultados sin atribuir UTC a una hora sin zona',()=> {
  const {matches,coverage}=parseOpenFootball(source([fixture]),'2026-27',received,'capture');
  assert.equal(matches[0].kickoffAt,null);assert.equal(matches[0].date,'2026-09-01');
  assert.equal(matches[0].availableAt,received);assert.equal(matches[0].captureId,'capture');
  assert.equal(matches[0].homeGoals,2);assert.equal(coverage.scored,1);assert.equal(coverage.missingKickoff,1);
});
test('Una jornada pasada sin resultado conserva valores desconocidos y se excluye del cómputo de marcadores',()=> {
  const {matches,coverage}=parseOpenFootball(source([{...fixture,score:undefined}]),'2026-27',received,'capture');
  assert.equal(matches[0].status,'unknown');assert.equal(matches[0].homeGoals,null);assert.equal(coverage.scored,0);assert.equal(coverage.missingPastResults,1);
});
test('Resultados de fechas futuras o de hoy sin hora, valores inválidos y duplicados se rechazan',()=> {
  for(const date of ['2026-11-15','2026-11-16'])assert.throws(()=>parseOpenFootball(source([{...fixture,date}]),'2026-27',received,'capture'),/resultado/);
  assert.throws(()=>parseOpenFootball(source([fixture,{...fixture,date:'2026-09-10'}]),'2026-27',received,'capture'),/duplicado/);
  assert.throws(()=>parseOpenFootball(source([{...fixture,score:{ft:[null,1]}}]),'2026-27',received,'capture'),/Marcador/);
  assert.throws(()=>parseOpenFootball(source([{...fixture,team2:'Equipo sin mapa'}]),'2026-27',received,'capture'),/correspondencia/);
  assert.throws(()=>calendarDate('2026-02-30'),/inexistente/);
});
const event={id:'real-test',date:'2026-11-21T13:00Z',status:{type:{completed:false,name:'STATUS_SCHEDULED'}},competitions:[{competitors:[
  {homeAway:'home',score:'0',team:{displayName:'Alavés'}},{homeAway:'away',score:'0',team:{displayName:'Deportivo'}}]}]};
test('El calendario experimental interpreta UTC explícito e ignora los ceros de marcador de eventos futuros',()=> {
  const parsed=parseEspn(JSON.stringify({events:[event]}),received,'capture');
  assert.equal(parsed.matches.length,1);assert.equal(parsed.matches[0].away,'RC Deportivo La Coruña');
  assert.equal(parsed.matches[0].homeGoals,null);assert.equal(parsed.matches[0].status,'scheduled');
  assert.equal(parsed.matches[0].kickoffAt,Date.UTC(2026,10,21,13));
});
test('Una hora sin zona o un resultado del futuro no se convierte en un dato válido',()=> {
  const invalid=[{...event,date:'2026-11-21T13:00'},{...event,status:{type:{completed:true,name:'STATUS_FINAL'}}}];
  const parsed=parseEspn(JSON.stringify({events:invalid}),received,'capture');
  assert.equal(parsed.matches.length,0);assert.equal(parsed.warnings.length,2);
});
test('El aplazamiento se representa como tal y un resultado final real se conserva',()=> {
  const postponed={...event,status:{type:{completed:false,name:'STATUS_POSTPONED'}}};
  assert.equal(parseEspn(JSON.stringify({events:[postponed]}),received,'capture').matches[0].status,'postponed');
  const finished={...event,date:'2026-11-08T13:00Z',status:{type:{completed:true,name:'STATUS_FINAL'}}};
  const parsed=parseEspn(JSON.stringify({events:[finished]}),received,'capture');
  assert.equal(parsed.matches[0].status,'finished');assert.equal(parsed.matches[0].homeGoals,0);
});
