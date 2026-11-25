import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadAcceptance} from '../src/odds/acceptance-state.ts';
import {REQUIRED_CONTROLLED_CASES} from '../src/odds/acceptance.ts';
import {uniqueCaptureFrames,type EvidenceFrame} from '../scripts/acceptance-evidence.ts';

const now=Date.UTC(2026,10,22,18),catalog=JSON.parse(readFileSync(new URL('../config/market-catalog.json',import.meta.url),'utf8'));
const ref=(captureId:string)=>({captureId,sha256:'a'.repeat(64)});
function evidence(){
 const regionalAudit={version:2,publicOnly:true,expiresAfterHours:24,coverage:['one','two'].flatMap(eventId=>catalog.initialMarkets.map((m:any)=>({eventId,groupId:m.groupIds[0],period:'full_time_regulation',scope:'sampled-coverage',checkedAt:new Date(now-1000).toISOString(),url:'https://www.bet365.es/#/'+eventId,
 selections:m.selections.map((s:any,i:number)=>({...s,selectionId:eventId+m.kind+i,label:s.side,sourcePrice:2,displayPrice:2}))})))};
 const sourceSamples=['history','calendar','news','odds'].map(role=>({...ref(role),role,receivedAt:now-1000,free:true}));
 const monitorEvidence={captures:100,priceChanges:10,explicitSuspensions:1,comparableWithdrawals:1,firstReceivedAt:now-3600000,lastReceivedAt:now,maxGapMs:60000,evidenceRefs:[ref('before'),ref('after')],httpDurationMs:{count:100,p95:900,max:1500},confirmationAgeMs:{count:100,p95:10000,max:15000},usage:{used:100,limit:4800,freeOnly:true}};
 const controlledChecks={checkedAt:now-1000,passed:20,failed:0,cases:[...REQUIRED_CONTROLLED_CASES],evidenceRef:ref('tests')};
 return {regionalAudit,inputs:{sourceSamples,monitorEvidence,controlledChecks}};
}

test('La aceptación se reevalúa con la fecha actual y omite los datos de entrada de la respuesta pública',t=>{
 const dir=mkdtempSync(join(tmpdir(),'laliga-acceptance-state-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const sample=evidence(),path=join(dir,'acceptance-status.json');writeFileSync(path,JSON.stringify({checkedAt:now,inputs:sample.inputs,tasks:{T02:{status:'complete'},T05:{status:'complete'}}}));
 const current=loadAcceptance(dir,now,{catalog,regionalAudit:sample.regionalAudit})!;
 assert.equal(current.tasks.T02.status,'complete');assert.equal(current.tasks.T05.status,'complete');assert.equal(current.checkedAt,now);assert.equal(current.evaluatedAt,now);assert.equal(Object.hasOwn(current,'inputs'),false);
 const expired=loadAcceptance(dir,now+24*3600000,{catalog,regionalAudit:sample.regionalAudit})!;
 assert.equal(expired.tasks.T02.status,'partial');assert.equal(expired.checkedAt,now);assert.equal(expired.evaluatedAt,now+24*3600000);
 const revised=loadAcceptance(dir,now,{catalog,regionalAudit:{...sample.regionalAudit,coverage:[]}})!;
 assert.equal(revised.tasks.T02.status,'partial');assert.ok(revised.tasks.T02.pending.includes('regional-coverage'));
});

test('Un fichero de aceptación antiguo con solo banderas de completado no habilita la operación',t=>{
 const dir=mkdtempSync(join(tmpdir(),'laliga-acceptance-legacy-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 assert.equal(loadAcceptance(dir,now,{catalog,regionalAudit:null}),null);
 writeFileSync(join(dir,'acceptance-status.json'),JSON.stringify({checkedAt:now,tasks:{T02:{status:'complete'},T05:{status:'complete'}},checks:[{passed:true}]}));
 const result=loadAcceptance(dir,now,{catalog,regionalAudit:null})!;assert.equal(result.tasks.T02.status,'partial');assert.equal(result.tasks.T05.status,'partial');
});

test('Una muestra importada y su archivo son la misma observación: prevalece la referencia SQLite',()=>{
 const first:EvidenceFrame={id:'db-first',format:'moviodds-live-fixture-v1',url:'https://moviodds.com/quotes?fi=one&site=com',requestedAt:now-100,receivedAt:now,sha256:'a'.repeat(64),raw:{source:'cache'}};
 const second={...first,id:'db-second',requestedAt:now+900,receivedAt:now+1000,sha256:'b'.repeat(64)};
 const duplicate={...first,id:'file:sample.json:hash'};
 const rows=[...uniqueCaptureFrames([first,second],[duplicate,{...second,id:'file:sample-two.json:hash'}])];
 assert.deepEqual(rows.map(row=>row.id),['db-first','db-second']);
 const distinctTime={...first,id:'file:distinct-time',requestedAt:now+1900,receivedAt:now+2000};
 assert.equal([...uniqueCaptureFrames([first],[distinctTime])].length,2);
});
