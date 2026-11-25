import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {catalogSelectionAllowed,evaluateAcceptance,REQUIRED_CONTROLLED_CASES,type AcceptanceInput} from '../src/odds/acceptance.ts';
const now=Date.UTC(2026,10,22,18),catalog=JSON.parse(readFileSync(new URL('../config/market-catalog.json',import.meta.url),'utf8'));
const ref=(captureId='capture-a')=>({captureId,sha256:'a'.repeat(64)});
function valid():AcceptanceInput {
 const coverage=['fixture-a','fixture-b'].flatMap(eventId=>catalog.initialMarkets.map((m:any)=>({eventId,groupId:m.groupIds[0],period:'full_time_regulation',scope:'sampled-coverage',checkedAt:new Date(now-10000).toISOString(),url:'https://www.bet365.es/#/AC/B1/E'+eventId,
  selections:m.selections.map((s:any,i:number)=>({selectionId:eventId+'-'+m.kind+'-'+i,side:s.side,line:s.line,label:s.side,sourcePrice:2.375,displayPrice:2.37}))})));
 return {now,catalog,regionalAudit:{version:2,publicOnly:true,expiresAfterHours:24,coverage},sourceSamples:['history','calendar','news','odds'].map((role:any)=>({...ref(role),role,receivedAt:now-10000,free:true})),
 monitorEvidence:{captures:100,priceChanges:10,explicitSuspensions:1,comparableWithdrawals:1,firstReceivedAt:now-8*3600000,lastReceivedAt:now,maxGapMs:5*3600000,evidenceRefs:[ref('capture-a'),ref('capture-b')],
  continuousWindow:{firstReceivedAt:now-3600000,lastReceivedAt:now,captures:100,maxGapMs:60000,evidenceRefs:[ref('capture-a'),ref('capture-b')]},httpDurationMs:{count:100,p95:900,max:1500},confirmationAgeMs:{count:1000,p95:20000,max:40000},usage:{used:100,limit:4800,freeOnly:true}},
 controlledChecks:{checkedAt:now-10000,passed:20,failed:0,cases:[...REQUIRED_CONTROLLED_CASES],evidenceRef:ref('tests')}};
}
function check(value:AcceptanceInput,id:string){return evaluateAcceptance(value).checks.find(c=>c.id===id)!;}

test('El catálogo inicial admite solo grupos, lados y líneas definidos; conservar investigación no la habilita',()=>{
 const quote:any={groupId:'40',marketId:'40:40',period:'full_time_regulation',selection:{kind:'1x2',side:'home',line:null}};
 assert.equal(catalogSelectionAllowed(quote,catalog),true);
 for(const change of [{period:'first_half'},{groupId:'938'},{marketId:'981:981'},{selection:{kind:'1x2',side:'home',line:0}},{selection:{kind:'asian_handicap',side:'home',line:-.5}},{selection:{kind:'btts',side:'yes',line:null}},{selection:undefined}])assert.equal(catalogSelectionAllowed({...quote,...change},catalog),false);
 assert.ok(catalog.researchMarkets.some((m:any)=>m.kind==='asian_handicap'));assert.ok(catalog.futureFamilies.includes('corners'));
});
test('La aceptación exige evidencia estructurada y acepta una ventana continua sin condenar las pausas externas',()=>{
 const result=evaluateAcceptance(valid());assert.equal(result.tasks.T02.status,'complete');assert.equal(result.tasks.T05.status,'complete');assert.equal(result.regionalSummary.completeFixtures.length,2);
 assert.equal(result.enhancements.bookmakerToProviderDelay.measured,false);
 const empty=valid();empty.monitorEvidence=null;empty.controlledChecks=null;assert.equal(evaluateAcceptance(empty).tasks.T05.status,'partial');
});
test('Una clave conectada o un booleano de éxito no completan fuentes, pruebas ni vigilancia',()=>{
 const value=valid();value.sourceSamples=[];value.controlledChecks={passed:true} as any;value.monitorEvidence={passed:true} as any;
 const result=evaluateAcceptance(value);assert.equal(result.tasks.T02.status,'partial');assert.equal(result.tasks.T05.status,'partial');
 assert.equal(check(value,'controlled-faults').passed,false);assert.equal(check(value,'source-samples').passed,false);
});
test('Todos los mercados iniciales y sus lados deben figurar en dos partidos, con precios regionales consistentes',()=>{
 for(const edit of [(a:any)=>a.coverage=a.coverage.filter((e:any)=>e.eventId==='fixture-a'),(a:any)=>a.coverage=a.coverage.filter((e:any)=>e.groupId!=='10544'),(a:any)=>a.coverage[0].selections.pop(),(a:any)=>a.coverage[0].selections[0].displayPrice=2.2,(a:any)=>a.coverage[0].selections[0].side='unknown',(a:any)=>a.coverage[0].url='https://bet365.es.evil.example/']){
  const value=valid();edit(value.regionalAudit);assert.equal(check(value,'regional-coverage').passed,false);
 }
});
test('Los contrastes caducados o futuros y las reglas sin fuente oficial no se aceptan',()=>{
 for(const checkedAt of [new Date(now+1).toISOString(),new Date(now-24*3600000).toISOString()]){const value=valid();for(const e of (value.regionalAudit as any).coverage)e.checkedAt=checkedAt;assert.equal(check(value,'regional-coverage').passed,false);}
 const value=valid();value.catalog=structuredClone(catalog);(value.catalog as any).initialMarkets[0].rules[0].url='https://other.example/rules';assert.equal(check(value,'rules').passed,false);
 const stale=valid();stale.sourceSamples[0].receivedAt=now-24*3600000;assert.equal(check(stale,'source-samples').passed,false);
});
test('Una revisión regional nueva incompleta o contradictoria no recurre a la antigua',()=>{
 const value=valid(),audit=value.regionalAudit as any,newer=structuredClone(audit.coverage[0]);newer.checkedAt=new Date(now-5000).toISOString();newer.selections=[];audit.coverage.push(newer);assert.equal(check(value,'regional-coverage').passed,false);
 const tie=valid(),same=(tie.regionalAudit as any).coverage[0],conflict=structuredClone(same);conflict.selections[0].displayPrice=2.38;(tie.regionalAudit as any).coverage.push(conflict);assert.equal(check(tie,'regional-coverage').passed,false);
});
test('Las suspensiones explícitas y retiradas comparables no se sustituyen por stale, cambios o pruebas sintéticas',()=>{
 const value=valid();value.monitorEvidence!.explicitSuspensions=0;assert.equal(check(value,'real-suspensions').passed,false);assert.equal(evaluateAcceptance(value).tasks.T02.status,'partial');
 value.monitorEvidence!.explicitSuspensions=1;value.monitorEvidence!.comparableWithdrawals=0;assert.equal(check(value,'real-withdrawals').passed,false);
 value.monitorEvidence!.priceChanges=0;assert.equal(check(value,'real-price-changes').passed,false);
});
test('Se exige una ventana medible, referencias distintas, tiempos coherentes, pruebas y presupuesto gratuitos',()=>{
 for(const edit of [(e:any)=>e.continuousWindow.maxGapMs=180001,(e:any)=>e.continuousWindow.captures=20,(e:any)=>e.continuousWindow.lastReceivedAt=now+1,(e:any)=>e.continuousWindow.evidenceRefs=[ref(),ref()],(e:any)=>e.evidenceRefs=[],(e:any)=>e.httpDurationMs.p95=NaN,(e:any)=>e.confirmationAgeMs.max=-1,(e:any)=>e.usage.used=4801,(e:any)=>e.usage.freeOnly=false]){
  const value=valid();edit(value.monitorEvidence);assert.equal(evaluateAcceptance(value).tasks.T05.status,'partial');
 }
 const value=valid();value.controlledChecks!.cases=value.controlledChecks!.cases.filter(c=>c!=='retry-after');assert.equal(check(value,'controlled-faults').passed,false);
 const badRef=valid();badRef.controlledChecks!.evidenceRef.sha256='missing';assert.equal(check(badRef,'controlled-faults').passed,false);
 assert.throws(()=>evaluateAcceptance({...valid(),now:NaN}));
});
