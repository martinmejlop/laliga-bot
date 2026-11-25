import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {analyzeFrames,unpackFrame,capturedFrames,type EvidenceFrame} from '../scripts/acceptance-evidence.ts';
const NOW=Date.UTC(2026,10,22,18),iso=(at:number)=>new Date(at).toISOString();
function rawQuote(id='one',group='40',extra:any={}){return {fixture_id:'e1',group_id:group,market_id:group,sel_id:id,odds_dec:2,ts:iso(NOW-1000),...extra};}
function board(id:string,at:number,quotes=[rawQuote()],groups='40',status:any={'40':{polled_at:iso(at-10)}}):EvidenceFrame{return {id,format:'moviodds-laliga-extract-v1',url:`https://moviodds.com/odds?sport=soccer&groups=${groups}&site=com`,requestedAt:at-200,receivedAt:at,raw:{site:'com',server_time:iso(at-1),matches:[{id:'e1',sport:'soccer',league:'Spain La Liga',home:'A',away:'B',group_status:status,quotes}]}};}
function direct(id:string,at:number,fixture='e1',extra:any={}):EvidenceFrame{return {id,format:'moviodds-live-fixture-v1',url:`https://moviodds.com/quotes?fi=${fixture}&site=com`,requestedAt:at-200,receivedAt:at,raw:{site:'com',fixture,source:'cache',count:1,dropped:0,group_status:{'40':{polled_at:iso(at-10)}},quotes:[rawQuote('one','40',{fixture_id:fixture})],...extra}};}

test('El auditor separa los filtros de grupos y endpoints antes de contar ausencias',()=>{
 const result=analyzeFrames([board('one',NOW,[rawQuote()]),board('two',NOW+1000,[rawQuote('total','981')],'40,981',{'40':{polled_at:iso(NOW+900)},'981':{polled_at:iso(NOW+900)}}),direct('three',NOW+2000)]);
 assert.equal(result.absences.comparableCoveredSelectionAbsences,0);assert.equal(result.sample.comparableScopeStreams,3);assert.equal(result.sample.comparisons,0);
});
test('Una selección ausente solo cuenta dentro del mismo partido y grupo cubierto',()=>{
 const a=board('a',NOW,[rawQuote('one'),rawQuote('two')]),b=board('b',NOW+1000,[rawQuote('two')]);
 const result=analyzeFrames([a,b]);assert.equal(result.absences.comparableCoveredSelectionAbsences,1);assert.equal(result.absences.selectionExamples[0].before.selectionId,'one');
 const missingGroup=board('c',NOW+1000,[], '40',{});assert.equal(analyzeFrames([a,missingGroup]).absences.comparableCoveredSelectionAbsences,0);assert.equal(analyzeFrames([a,missingGroup]).absences.wholeGroupAbsences,1);
 const olderGroup=board('d',NOW+1000,[], '40',{'40':{polled_at:iso(NOW-100)}});assert.equal(analyzeFrames([a,olderGroup]).absences.comparableCoveredSelectionAbsences,0);
});
test('Las consultas por partido no se comparan con otros partidos ni con respuestas truncadas',()=>{
 const a=direct('a',NOW),b=direct('b',NOW+1000,'e2'),c=direct('c',NOW+2000,'e1',{count:2});
 const result=analyzeFrames([a,b,c]);assert.equal(result.sample.comparableScopeStreams,2);assert.equal(result.sample.rejectedCaptures,1);assert.equal(result.absences.comparableCoveredSelectionAbsences,0);
 assert.equal(unpackFrame(direct('mixed',NOW,'e2',{fixture:'e1'})),null);
});
test('Una marca stale no se confunde con suspended y los flags no prueban suspensión del operador',()=>{
 const a=board('a',NOW),b=board('b',NOW+1000,[rawQuote()], '40',{'40':{polled_at:iso(NOW+990),stale:true}}),c=board('c',NOW+2000,[rawQuote('one','40',{suspended:true})]);
 const result=analyzeFrames([a,b,c]);assert.equal(result.confirmationState.distinctGroupStaleTransitions,2);assert.equal(result.suspensions.trackedFalseToTrueTransitions,1);assert.equal(result.suspensions.trackedGroupsExplicitRawTrueObservations,1);assert.equal(result.acceptance.independentBet365SpainSuspensionProof,false);
});
test('La duración HTTP y la edad de confirmación no se presentan como demora de propagación',()=>{
 const a=board('a',NOW),b=board('b',NOW+20000,[rawQuote('one','40',{odds_dec:2.1,ts:iso(NOW+18000)})]);
 const r=analyzeFrames([a,b]);assert.equal(r.priceChanges.coherentLastChangeCount,1);assert.equal(r.timing.httpDurationMs.p50,200);assert.equal(r.timing.confirmationAgeAtReceiptMs.p50,10);assert.equal(r.timing.bookmakerToProviderPropagationMeasured,false);assert.equal(r.timing.receivedAfterLastChangeMs.p50,2000);
});
test('Los cambios con fechas incoherentes se conservan pero no se acreditan como cambio coherente',()=>{
 const a=board('a',NOW),b=board('b',NOW+2000,[rawQuote('one','40',{odds_dec:3,ts:iso(NOW+5000)})]);
 const r=analyzeFrames([a,b]);assert.equal(r.priceChanges.count,1);assert.equal(r.priceChanges.coherentLastChangeCount,0);assert.equal(r.invalidRawQuoteMetadata.count,1);
});
test('Las series continuadas y los huecos se describen sin afirmar vigilancia permanente',()=>{
 const r=analyzeFrames([board('a',NOW),board('b',NOW+20000),board('c',NOW+40000),board('d',NOW+200000)]);
 assert.equal(r.timing.longestGlobalRunWithGapsAtMost60s.captures,3);assert.equal(r.timing.longestGlobalRunWithGapsAtMost60s.durationMs,40000);assert.equal(r.timing.gapExamples.length,1);assert.equal(r.timing.globalCaptureGapMs.max,160000);
});
test('El alcance de aceptación puede restringirse a los grupos declarados sin adoptar suspensiones de otra familia',()=>{
 const quotes=[rawQuote(),rawQuote('other','10150',{suspended:true})],frame=board('a',NOW,quotes,'40,10150',{'40':{polled_at:iso(NOW-10)},'10150':{polled_at:iso(NOW-10)}});
 const restricted=analyzeFrames([frame],['40']);assert.equal(restricted.suspensions.allGroupsExplicitRawTrueObservations,1);assert.equal(restricted.suspensions.trackedGroupsExplicitRawTrueObservations,0);assert.equal(restricted.sample.trackedRawQuoteObservations,1);
});
test('Los cambios en lecturas directas conservan cambio desconocido y no inventan latencia desde último cambio',()=>{
 const a=direct('a',NOW,'e1',{source:'live-fetch'}),b=direct('b',NOW+20000,'e1',{source:'live-fetch',quotes:[rawQuote('one','40',{odds_dec:2.2,ts:iso(NOW+19000)})]});
 const r=analyzeFrames([a,b]);assert.equal(r.priceChanges.coherentObservationCount,1);assert.equal(r.priceChanges.coherentLastChangeCount,0);assert.equal(r.acceptance.realPriceChangesObserved,true);assert.equal(r.timing.receivedAfterLastChangeMs.count,0);
});
test('La captura acotada exige huella, identidad y horas del manifiesto antes de usar los precios',t=>{
 const directory=mkdtempSync(join(tmpdir(),'laliga-acceptance-audit-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const f=direct('a',NOW),capture={raw:JSON.stringify(f.raw),url:f.url,requestedAt:f.requestedAt,receivedAt:f.receivedAt};
 const file='000-123.json',sha256=createHash('sha256').update(capture.raw).digest('hex');
 writeFileSync(join(directory,file),JSON.stringify({...capture,url:'https://moviodds.com/quotes?fi=123&site=com',raw:JSON.stringify({...f.raw,fixture:'123',quotes:[rawQuote('one','40',{fixture_id:'123'})]})}));
 const saved=JSON.parse(JSON.stringify({...capture,url:'https://moviodds.com/quotes?fi=123&site=com',raw:JSON.stringify({...f.raw,fixture:'123',quotes:[rawQuote('one','40',{fixture_id:'123'})]})}));
 writeFileSync(join(directory,'manifest.json'),JSON.stringify({purpose:'bounded-acceptance-public-read',rounds:1,ids:['123'],records:[{file,eventId:'123',sha256:createHash('sha256').update(saved.raw).digest('hex'),requestedAt:saved.requestedAt,receivedAt:saved.receivedAt}]}));
 assert.equal([...capturedFrames(directory).frames].length,1);
 writeFileSync(join(directory,file),JSON.stringify({...saved,raw:saved.raw.replace('"odds_dec":2','"odds_dec":3')}));
 assert.throws(()=>[...capturedFrames(directory).frames],/manifiesto/);
});
test('Una respuesta vacía íntegra del mismo partido acredita retirada de fuente sin afirmar cierre del operador',()=>{
 const a=direct('a',NOW),empty=direct('empty',NOW+1000,'e1',{count:0,quotes:[],group_status:{}});
 const r=analyzeFrames([a,empty],['40']);assert.equal(r.absences.eligibleWholeGroupWithdrawals,1);assert.equal(r.monitorEvidence.comparableWithdrawals,1);assert.equal(r.absences.comparableCoveredSelectionAbsences,0);assert.equal(r.acceptance.independentBet365SpainWithdrawalProof,false);assert.equal(r.suspensions.trackedGroupsExplicitRawTrueObservations,0);
 const truncated=direct('truncated',NOW+1000,'e1',{count:0,quotes:[],group_status:{},dropped:1});assert.equal(analyzeFrames([a,truncated]).monitorEvidence.comparableWithdrawals,0);
 const failed=direct('failed',NOW+1000,'e1',{count:0,quotes:[],source:'error'});assert.equal(analyzeFrames([a,failed]).monitorEvidence.comparableWithdrawals,0);
});
test('Un grupo declarado pero nunca cotizado y una confirmación ausente con precios presentes no acreditan retiradas',()=>{
 const neverQuoted=board('a',NOW,[]),missing=board('b',NOW+1000,[],'40',{});
 assert.equal(analyzeFrames([neverQuoted,missing]).monitorEvidence.comparableWithdrawals,0);
 const quoted=board('a',NOW),stillQuoted=board('b',NOW+1000,[rawQuote()],'40',{}),r=analyzeFrames([quoted,stillQuoted]);
 assert.equal(r.absences.wholeGroupAbsences,1);assert.equal(r.absences.eligibleWholeGroupWithdrawals,0);assert.equal(r.monitorEvidence.comparableWithdrawals,0);
 const declaredEmpty=direct('c',NOW+1000,'e1',{count:0,quotes:[]});const expected=analyzeFrames([direct('a',NOW),declaredEmpty]);assert.equal(expected.absences.comparableCoveredSelectionAbsences,1);assert.equal(expected.absences.eligibleWholeGroupWithdrawals,0);assert.equal(expected.monitorEvidence.comparableWithdrawals,1);
});
test('El partido ausente del mismo tablero cuenta una sola vez y conserva referencias antes/después',()=>{
 const a=board('a',NOW,[rawQuote('one'),rawQuote('two')]),b=board('b',NOW+1000);b.raw.matches=[];a.sha256='a'.repeat(64);b.sha256='b'.repeat(64);
 const r=analyzeFrames([a,b]);assert.equal(r.absences.eligibleWholeFixtureWithdrawals,1);assert.equal(r.monitorEvidence.comparableWithdrawals,1);assert.equal(r.absences.eligibleWholeGroupWithdrawals,0);assert.equal(r.absences.comparableCoveredSelectionAbsences,0);
 assert.deepEqual(r.absences.fixtureExamples[0].evidenceRefs,{before:{captureId:'a',sha256:'a'.repeat(64)},after:{captureId:'b',sha256:'b'.repeat(64)}});
 const empty=board('empty',NOW,[]);assert.equal(analyzeFrames([empty,b]).monitorEvidence.comparableWithdrawals,0);
});
test('Un cambio del filtro in_play no se cuenta como desaparición y los rawmatches iniciados no se excluyen',()=>{
 const a=board('a',NOW),filtered=board('b',NOW+1000);filtered.raw.matches=[];filtered.url+='&in_play=1';assert.equal(analyzeFrames([a,filtered]).monitorEvidence.comparableWithdrawals,0);
 const started=board('started',NOW+1000);started.raw.matches[0].in_play=true;const r=analyzeFrames([a,started]);assert.equal(r.sample.trackedRawQuoteObservations,2);assert.equal(r.absences.wholeFixtureAbsences,0);assert.equal(r.monitorEvidence.comparableWithdrawals,0);
});
test('Respuestas parciales o normalizadas no aportan pruebas de retirada del tablero bruto',()=>{
 const a=board('a',NOW),partial=board('partial',NOW+1000);partial.raw.matches=[];partial.raw.partial=true;
 assert.equal(analyzeFrames([a,partial]).sample.rejectedCaptures,1);assert.equal(analyzeFrames([a,partial]).monitorEvidence.comparableWithdrawals,0);
 const normalized={...partial,format:'normalized-moviodds-board-v1',raw:{site:'com',matches:[]}};assert.equal(analyzeFrames([a,normalized]).monitorEvidence.comparableWithdrawals,0);
});
