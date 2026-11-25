import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseChampionsText,parseChampionsEspn} from '../src/data/champions-parsers.ts';
import {fitModel} from '../src/model/service.ts';
const now=Date.UTC(2026,10,23);
test('El histórico real conserva 90 minutos, excluye penaltis y no confunde el cambio de grupo con un cambio de año',()=>{
 const raw=readFileSync(new URL('./fixtures/champions-2021-22.txt',import.meta.url),'utf8'),data=parseChampionsText(raw,'2021-22',now,'sample');
 assert.equal(data.matches.length,125);assert.equal(data.warnings.length,0);
 const chelsea=data.matches.find(m=>m.home==='Real Madrid CF'&&m.away==='Chelsea')!;
 assert.deepEqual([chelsea.date,chelsea.homeGoals,chelsea.awayGoals],['2022-04-12',1,3]);
 const city=data.matches.find(m=>m.home==='Real Madrid CF'&&m.away==='Manchester City')!;
 assert.deepEqual([city.date,city.homeGoals,city.awayGoals],['2022-05-04',2,1]);
 assert.ok(data.matches.filter(m=>m.stage?.includes('Group')).every(m=>m.date.startsWith('2021')));
 assert.equal(data.matches.filter(m=>m.neutral).length,1);
 assert.throws(()=>parseChampionsText('= Otra competición','2021-22',now,'sample'),/incompatible/);
});
test('Champions admite dos encuentros del mismo cruce en fechas distintas sin borrar una eliminatoria',()=>{
 const data=parseChampionsText(readFileSync(new URL('./fixtures/champions-2021-22.txt',import.meta.url),'utf8'),'2021-22',now,'sample');
 const first=data.matches.find(m=>m.home==='Real Madrid CF'&&m.away==='Chelsea')!;
 const second={...first,id:'another-round',date:'2022-05-05',homeGoals:2,awayGoals:0};
 assert.equal(fitModel([first,second],Date.UTC(2022,5,1),{availability:'reconstructed'}).trainingMatches,2);
 assert.throws(()=>fitModel([first,{...second,date:first.date}],Date.UTC(2022,5,1),{availability:'reconstructed'}),/contradictorios/);
});
test('Un resultado de ESPN tras prórroga usa las dos partes reglamentarias y nunca el tanteo final de 120 minutos',()=>{
 const event={id:'e',date:'2026-11-03T20:00Z',status:{period:4,type:{completed:true,name:'STATUS_FINAL_AET'}},competitions:[{altGameNote:'UEFA Champions League, Round of 16',competitors:[{homeAway:'home',team:{displayName:'Real Madrid'},score:'3',linescores:[{period:1,value:1},{period:2,value:1},{period:3,value:1},{period:4,value:0}]},{homeAway:'away',team:{displayName:'PSV Eindhoven'},score:'1',linescores:[{period:1,value:1},{period:2,value:0},{period:3,value:0},{period:4,value:0}]}]}]};
 const envelope={leagues:[{slug:'uefa.champions'}],events:[event]};
 let result=parseChampionsEspn(JSON.stringify(envelope),now,'sample');assert.deepEqual([result.matches[0].homeGoals,result.matches[0].awayGoals],[2,1]);
 delete (event.competitions[0].competitors[0] as any).linescores;
 result=parseChampionsEspn(JSON.stringify(envelope),now,'sample');assert.equal(result.matches[0].status,'unknown');assert.equal(result.matches[0].homeGoals,null);
 assert.throws(()=>parseChampionsEspn(JSON.stringify({...envelope,leagues:[{slug:'esp.1'}]}),now,'sample'),/Champions/);
});
