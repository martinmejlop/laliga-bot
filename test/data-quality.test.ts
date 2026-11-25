import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DataSnapshot, HistoricalMatch } from '../src/domain.ts';
import { assessingSportsReadiness } from '../src/data/quality.ts';
import { parseOfficialPostponement } from '../src/data/official-status.ts';

const NOW=Date.UTC(2026,10,15,10),DAY=86400000;
function row(id:string,home:string,away:string,daysAgo:number):HistoricalMatch {
  const kickoffAt=NOW-daysAgo*DAY;
  return {id,home,away,season:'2026-27',date:new Date(kickoffAt).toISOString().slice(0,10),kickoffAt,
    homeGoals:1,awayGoals:0,status:'finished',source:'controlled-test',captureId:'test',availableAt:NOW-1000};
}
function snapshot():DataSnapshot {
  const matches=Array.from({length:350},(_,index)=>row(`history-${index}`,'Real Madrid CF','FC Barcelona',60+index));
  for(const team of ['Rayo Vallecano de Madrid','Athletic Club','FC Barcelona','Real Madrid CF','Valencia CF','Getafe CF']) {
    for(let index=0;index<8;index++)matches.push(row(`${team}-${index}`,team,'Real Betis Balompié',2+index*2));
  }
  return {version:1,updatedAt:NOW-1000,matches,coverage:[],news:[],newsAnalysis:{status:'empty',checkedAt:NOW-1000,model:'qwen3:8b',facts:[],warnings:[]},errors:[]};
}
const event={home:'Rayo Vallecano',away:'Valencia',kickoffAt:NOW+6*DAY};
test('Una calidad deportiva suficiente conserva como desconocidas las lesiones no cubiertas',()=> {
  const quality=assessingSportsReadiness(snapshot(),event,NOW);
  assert.equal(quality.ready,true);assert.equal(quality.passed,true);
  assert.equal(quality.teams[0].recentMatches,8);assert.ok(quality.teams.every(team=>team.unknowns.length));
});
test('Un resultado pasado desconocido bloquea importes de sus equipos y no los de otros clubes',()=> {
  const data=snapshot();data.matches.push({...row('missing','Rayo Vallecano de Madrid','Athletic Club',40),kickoffAt:null,homeGoals:null,awayGoals:null,status:'unknown'});
  const affected=assessingSportsReadiness(data,event,NOW);
  assert.equal(affected.ready,false);assert.equal(affected.teams[0].missingPastMatches.length,1);
  assert.match(affected.reasons.join(' '),/forma reciente puede estar incompleta/);
  const other=assessingSportsReadiness(data,{home:'Barcelona',away:'Getafe',kickoffAt:NOW+6*DAY},NOW);
  assert.equal(other.ready,true);assert.ok(other.teams.every(team=>team.missingPastMatches.length===0));
});
test('Un encuentro de hoy terminado hace más de tres horas con resultado desconocido también bloquea el siguiente pronóstico',()=>{
 const data=snapshot(),kickoffAt=NOW-4*3600000;
 data.matches.push({...row('today-unfinished','Rayo Vallecano de Madrid','Athletic Club',0),kickoffAt,date:new Date(kickoffAt).toISOString().slice(0,10),status:'unknown',homeGoals:null,awayGoals:null});
 assert.equal(assessingSportsReadiness(data,event,NOW).ready,false);
});
test('Un aplazamiento documentado no se rellena como 0-0 ni se confunde con una pérdida de resultados',()=> {
  const data=snapshot();data.matches.push({...row('postponed','Rayo Vallecano de Madrid','Athletic Club',40),homeGoals:null,awayGoals:null,status:'postponed'});
  const quality=assessingSportsReadiness(data,event,NOW);
  assert.equal(quality.ready,true);assert.equal(quality.teams[0].historyMatches,8);assert.equal(quality.teams[0].missingPastMatches.length,0);
  assert.match(quality.warnings.join(' '),/aplazamiento/);
});
test('La reanudación de un partido ya empezado no se valora como 90 minutos nuevos',()=> {
  const data=snapshot();data.matches.push({...row('resumption','Rayo Vallecano de Madrid','Athletic Club',-24),kickoffAt:null,
    homeGoals:null,awayGoals:null,status:'postponed',source:'official:status-review'});
  const quality=assessingSportsReadiness(data,{home:'Rayo Vallecano',away:'Athletic Club',kickoffAt:NOW+24*DAY},NOW);
  assert.equal(quality.ready,false);assert.match(quality.reasons.join(' '),/reanudación/);
});
test('Datos desactualizados, poco historial y resultados demasiado antiguos no permiten proponer importes',()=> {
  const stale=snapshot();stale.updatedAt=NOW-2*DAY;
  assert.equal(assessingSportsReadiness(stale,event,NOW).ready,false);
  const sparse=snapshot();sparse.matches=sparse.matches.slice(-10);
  assert.match(assessingSportsReadiness(sparse,event,NOW).reasons.join(' '),/Histórico insuficiente/);
  const old=snapshot();old.matches=old.matches.map(match=>({...match,kickoffAt:NOW-40*DAY,date:'2026-10-06'}));
  assert.match(assessingSportsReadiness(old,event,NOW).reasons.join(' '),/30 días/);
});
test('Las observaciones recibidas después del corte se excluyen y no hacen suficiente un historial anterior',()=> {
  const data=snapshot();data.matches=data.matches.map(match=>({...match,availableAt:NOW+1}));
  const quality=assessingSportsReadiness(data,event,NOW);
  assert.equal(quality.ready,false);assert.ok(quality.teams.every(team=>team.historyMatches===0));
  assert.match(quality.warnings.join(' '),/después del corte/);
});
test('Las páginas oficiales permiten conocer la suspensión y fecha, sin inventar UTC ni marcador final',()=> {
  const official='<h1>Rayo Vallecano - Athletic Club</h1><span>RAY</span><b>Suspendido</b><i>25’</i><span>ATH</span>';
  const calendar='<table><tr><td>MIE 09.12.2026</td><td>20:00</td><td>Rayo Vallecano VS Athletic Club</td></tr></table>';
  assert.deepEqual(parseOfficialPostponement(official,calendar),{date:'2026-12-09',timeLabel:'20:00'});
  assert.equal(parseOfficialPostponement(official.replace('Suspendido','Finalizado'),calendar),null);
  assert.deepEqual(parseOfficialPostponement(official,''),{date:'2026-10-10',timeLabel:null});
});
