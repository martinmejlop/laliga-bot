import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildReport,renderReport} from '../src/report.ts';
import {fitModel,type Evaluation} from '../src/model/service.ts';
import {Ledger} from '../src/ledger/service.ts';
import type {DataSnapshot,HistoricalMatch,MarketSelection} from '../src/domain.ts';
import type {OddsBoard} from '../src/odds/moviodds.ts';
import type {Quote} from '../src/odds/freshness.ts';

// Los partidos, precios y gates de este archivo son ejemplos controlados en memoria.
// No demuestran rentabilidad ni se guardan en la base o informes del usuario.
const DAY=86400000,clock=Date.now();
const names=['FC Barcelona','Real Madrid CF','Athletic Club','CA Osasuna','Getafe CF','Sevilla FC','Valencia CF','Villarreal CF'];
const matches:HistoricalMatch[]=[];
for(let season=0;season<6;season++){
  let i=0;
  for(let h=0;h<names.length;h++)for(let a=0;a<names.length;a++)if(h!==a){
    const time=clock-(2+(56-i)*2+season*365)*DAY,date=new Date(time).toISOString().slice(0,10);
    const firstYear=2026-season,seasonLabel=`${firstYear}-${String((firstYear+1)%100).padStart(2,'0')}`;
    matches.push({id:`controlled-${season}-${h}-${a}`,season:seasonLabel,date,kickoffAt:null,home:names[h],away:names[a],homeGoals:(h+i)%4,awayGoals:(a+i)%3,status:'finished',source:'controlled',captureId:`controlled-capture-${season}`,availableAt:time+DAY});i++;
  }
}
const model=fitModel(matches,clock-1000);
const controlledSelection:MarketSelection={kind:'1x2',side:'home',line:null};
const evaluation:Evaluation={version:'controlled-test-only',status:'evaluated',sampleSize:500,validation:null,test:null,benchmark:{validation:null,test:null},selectedOptions:{},
  chronology:{trainEnd:null,validationStart:null,validationEnd:null,testStart:null,testEnd:null,trainingCount:300,validationCount:100,testCount:100},
  limitations:['Evaluación controlada para probar la ruta de presentación; no es evidencia de ventaja.'],roi:null,modelGate:{passed:true,reasons:[]},
  marketGates:{'1x2':{passed:true,reasons:[],testedLines:[null],sampleSize:100,selections:[{...controlledSelection,passed:true,reasons:[],metrics:null,benchmark:null,settlement:{predictedMean:null,observedMean:null},brierImprovement:null}]}}};

function setup(confirmed=true){
  const ledger=new Ledger(':memory:');
  if(confirmed)ledger.confirmBalance({balanceEur:100,idempotencyKey:'controlled-balance'});
  const now=Date.now()+10;
  const snapshot:DataSnapshot={version:1,updatedAt:now-100,matches,coverage:[],news:[],newsAnalysis:{status:'unavailable',checkedAt:now-100,model:'qwen3:8b',facts:[],warnings:['IA sin conexión, ejemplo controlado.']},errors:[]};
  const quote:Quote={eventId:'controlled-event',marketId:'40:40',selectionId:'controlled-home',bookmaker:'bet365',competition:'LaLiga',period:'full_time_regulation',line:null,price:4,
    sourceUpdatedAt:now-1000,sourceConfirmedAt:now-200,requestedAt:now-100,receivedAt:now-50,kickoffAt:now+DAY,suspended:false,regionVerified:true,selection:controlledSelection};
  const board:OddsBoard={requestedAt:quote.requestedAt,receivedAt:quote.receivedAt,serverTime:now-150,site:'com',regionVerified:false,
    matches:[{id:quote.eventId,home:'Barcelona',away:'Real Madrid',kickoffAt:quote.kickoffAt,refreshSeconds:30,quotes:[quote]}]};
  const input={snapshot,model,evaluation:structuredClone(evaluation),board,ledger:ledger.snapshot(),monitor:{running:true,error:null},preferences:{minStakeEur:.1},generatedAt:now,now};
  return {ledger,input,quote};
}
test('El recorrido positivo controlado usa gates exactos, propone un importe limitado y no descuenta fondos',()=>{
  const {ledger,input}=setup();try{
    const before=ledger.snapshot();
    const report=buildReport(input);
    assert.equal(input.snapshot.matches.length,336);assert.equal(new Set(input.snapshot.matches.map(row=>`${row.season}:${row.home}:${row.away}`)).size,336);
    assert.equal(report.fixtures[0].quality.ready,true);
    assert.equal(report.candidates.length,1);assert.ok(report.candidates[0].expectedValue>=.08);
    assert.equal(report.candidates[0].actionable,true);assert.ok(report.candidates[0].stakeEur>0&&report.candidates[0].stakeEur<=1);
    assert.equal(report.candidates[0].greatOpportunity,true);assert.equal(report.status,'ready');
    assert.deepEqual(ledger.snapshot(),before);
    const html=renderReport(report);assert.match(html,/experimental|experimentales/i);assert.match(html,/Copia fechada/);assert.match(html,/No se envía ninguna apuesta/);
  }finally{ledger.close();}
});
test('Sin partidos, sin cuotas o con una lista vacía el informe se abstiene sin romperse',()=>{
  const {ledger,input}=setup();try{
    const missing=buildReport({...input,board:null});
    assert.equal(missing.status,'empty');assert.equal(missing.candidates.length,0);assert.equal(missing.bankroll.totalRecommendedEur,0);
    const none=buildReport({...input,board:{...input.board,matches:[]}});
    assert.equal(none.status,'empty');assert.equal(none.bankroll.totalRecommendedEur,0);
  }finally{ledger.close();}
});

test('Una selección de hándicap con gate aprobado permanece fuera del catálogo inicial hasta su contraste específico',()=>{
 const {ledger,input,quote}=setup();try{
  const selection:MarketSelection={kind:'asian_handicap',side:'away',line:.5};
  const changed={...quote,selection,line:.5,price:100,marketId:'938:938',groupId:'938'};
  const evaluation:any=structuredClone(input.evaluation);evaluation.marketGates.asian_handicap={passed:true,reasons:[],selections:[{...selection,passed:true,reasons:[]}]};
  const report=buildReport({...input,evaluation,board:{...input.board,matches:[{...input.board.matches[0],quotes:[changed]}]}});
  assert.equal(report.candidates[0].stakeEur,0);assert.equal(report.candidates[0].actionable,false);assert.match(report.candidates[0].reasons.join(' '),/fuera del catálogo inicial/);
 }finally{ledger.close();}
});
test('Una cuota sin región verificada, suspendida o caducada conserva su motivo y nunca recibe dinero',()=>{
  const {ledger,input,quote}=setup();try{
    for(const change of [{regionVerified:false},{suspended:true},{sourceConfirmedAt:input.now-90000,sourceUpdatedAt:input.now-100000},{receivedAt:input.now-40000,requestedAt:input.now-40100,sourceConfirmedAt:input.now-40200,sourceUpdatedAt:input.now-40300}]){
      const board={...input.board,matches:[{...input.board.matches[0],quotes:[{...quote,...change}]}]};
      const report=buildReport({...input,board});
      assert.equal(report.bankroll.totalRecommendedEur,0);assert.equal(report.candidates[0].actionable,false);assert.equal(report.candidates[0].greatOpportunity,false);
      assert.ok(report.candidates[0].reasons.length>0);
    }
  }finally{ledger.close();}
});
test('Una vigilancia detenida o con error invalida oportunidades aunque la cuota parezca reciente',()=>{
  const {ledger,input}=setup();try{
    for(const monitor of [{running:false,error:null},{running:true,error:'Fallo controlado de la fuente'}]){
      const report=buildReport({...input,monitor});assert.equal(report.bankroll.totalRecommendedEur,0);assert.equal(report.candidates[0].actionable,false);
      assert.ok(report.candidates[0].reasons.some((reason:string)=>/Vigilancia/i.test(reason)));
    }
  }finally{ledger.close();}
});

test('La aceptación operativa pendiente bloquea importes aunque precio, modelo y saldo del ejemplo sean válidos',()=>{
 const {ledger,input}=setup();try{const report=buildReport({...input,operationalReady:false});assert.equal(report.bankroll.totalRecommendedEur,0);assert.equal(report.candidates[0].actionable,false);assert.match(report.candidates[0].reasons.join(' '),/Comprobación técnica/);}finally{ledger.close();}
});

test('Cambiar una cuota recalcula el valor y retira el importe si desaparece la ventaja',()=>{
 const {ledger,input,quote}=setup();try{
  const before=buildReport(input);assert.ok(before.candidates[0].stakeEur>0);
  const board={...input.board,matches:[{...input.board.matches[0],quotes:[{...quote,price:1.01}]}]};
  const after=buildReport({...input,board});assert.notEqual(after.candidates[0].id,before.candidates[0].id);assert.ok(after.candidates[0].expectedValue<0);assert.equal(after.candidates[0].stakeEur,0);
 }finally{ledger.close();}
});
test('Un valor estimado muy alto no autoriza dinero sin saldo confirmado o sin mínimo de cuenta',()=>{
  const {ledger,input}=setup(false);try{
    input.board.matches[0].quotes[0].price=100;
    const report=buildReport(input);assert.ok(report.candidates[0].expectedValue>1);
    assert.equal(report.bankroll.totalRecommendedEur,0);assert.equal(report.candidates[0].greatOpportunity,false);
    ledger.confirmBalance({balanceEur:100,idempotencyKey:'confirm-later'});
    const minimum=buildReport({...input,ledger:ledger.snapshot(),preferences:{minStakeEur:null}});
    assert.equal(minimum.bankroll.totalRecommendedEur,0);assert.equal(minimum.candidates[0].greatOpportunity,false);
  }finally{ledger.close();}
});
test('Una familia aprobada no habilita otros lados o líneas y un modelo con poco historial se abstiene',()=>{
  const {ledger,input}=setup();try{
    const wrongSide=structuredClone(input.evaluation);wrongSide.marketGates['1x2']!.selections[0].side='away';
    const gated=buildReport({...input,evaluation:wrongSide});assert.equal(gated.bankroll.totalRecommendedEur,0);
    assert.ok(gated.candidates[0].reasons.some((reason:string)=>/Validación/i.test(reason)));
    const sparse=fitModel(matches.slice(0,10),clock-1000);
    const insufficient=buildReport({...input,model:sparse});assert.equal(insufficient.bankroll.totalRecommendedEur,0);
  }finally{ledger.close();}
});
test('Los datos deportivos de más de un día y la evaluación ausente no generan apuestas',()=>{
  const {ledger,input}=setup();try{
    const stale=buildReport({...input,snapshot:{...input.snapshot,updatedAt:input.now-25*3600000}});
    assert.equal(stale.bankroll.totalRecommendedEur,0);
    const absent=buildReport({...input,evaluation:null});assert.equal(absent.bankroll.totalRecommendedEur,0);
  }finally{ledger.close();}
});
test('El inicio de un partido entre consultas retira su oportunidad sin romper el informe entero',()=>{
  const {ledger,input}=setup();try{
    input.board.matches[0].kickoffAt=input.now-10;
    input.board.matches[0].quotes[0].kickoffAt=input.now-10;
    const report=buildReport({...input,model:{...input.model,cutoff:input.now}});
    assert.equal(report.bankroll.totalRecommendedEur,0);
    assert.ok(report.candidates.every((candidate:any)=>!candidate.actionable));
  }finally{ledger.close();}
});
test('Una exposición manual que ya agota el límite de equipo bloquea otra apuesta de ese club',()=>{
  const {ledger,input}=setup();try{
    ledger.recordBet({idempotencyKey:'controlled-existing',eventId:'another-controlled-event',eventName:'FC Barcelona — Getafe CF',market:'Resultado final',selection:'FC Barcelona',price:2,stakeEur:3,mode:'manual'});
    const report=buildReport({...input,ledger:ledger.snapshot()});
    assert.equal(report.bankroll.totalRecommendedEur,0);
  }finally{ledger.close();}
});
test('Omitir una selección retira su presupuesto y una evaluación antigua sin gate exacto no la habilita',()=>{
  const {ledger,input}=setup();try{
    const candidate=buildReport(input).candidates[0];
    const omitted=buildReport({...input,decisions:[{recommendationId:candidate.id,status:'omitted'}]});
    assert.equal(omitted.bankroll.totalRecommendedEur,0);assert.equal(omitted.candidates[0].decisionStatus,'omitted');
    assert.ok(omitted.candidates[0].reasons.some((reason:string)=>/omitida/i.test(reason)));
    const legacy:any=structuredClone(input.evaluation);delete legacy.marketGates;
    const old=buildReport({...input,evaluation:legacy});assert.equal(old.bankroll.totalRecommendedEur,0);
  }finally{ledger.close();}
});
test('Los metadatos incoherentes de una cuota la excluyen sin fingir una suspensión del proveedor',()=>{
  const {ledger,input,quote}=setup();try{
    quote.validationError='Confirmación de origen anterior al último cambio de precio.';
    assert.equal(quote.suspended,false);
    const report=buildReport(input);
    assert.equal(report.candidates[0].quote.suspended,false);
    assert.equal(report.bankroll.totalRecommendedEur,0);assert.equal(report.candidates[0].actionable,false);
    assert.equal(report.candidates[0].greatOpportunity,false);
    assert.ok(report.candidates[0].reasons.some((reason:string)=>/invalid-source-metadata/.test(reason)));
  }finally{ledger.close();}
});
test('La calidad deportiva bloquea un archivo incompleto aunque el modelo y el gate del ejemplo pasen',()=>{
  const {ledger,input}=setup();try{
    const shortSnapshot={...input.snapshot,matches:input.snapshot.matches.slice(0,112)};
    const report=buildReport({...input,snapshot:shortSnapshot});
    assert.equal(report.fixtures[0].quality.ready,false);
    assert.equal(report.bankroll.totalRecommendedEur,0);
    assert.ok(report.candidates[0].reasons.some((reason:string)=>/Histórico insuficiente/.test(reason)));
  }finally{ledger.close();}
});
test('LaLiga y Champions comparten el límite de 5 € con saldo de 50 €, sin reutilizar las puertas de evaluación de otra competición',()=>{
 const {ledger,input,quote}=setup();try{
  ledger.confirmBalance({balanceEur:50,idempotencyKey:'controlled-shared-balance'});
  const championsSnapshot={...input.snapshot,competition:'Champions' as const,matches:input.snapshot.matches.map(m=>({...m,competition:'Champions' as const,id:'ucl-'+m.id}))};
  const championsQuote={...quote,eventId:'ucl-event',competition:'Champions' as const};
  const wrapper={quote:championsQuote,id:'ucl-quote',groupId:'40',market:'Full Time Result',label:'Barcelona',price:quote.price,confirmedAt:quote.sourceConfirmedAt,changedAt:quote.sourceUpdatedAt,suspended:false,stale:false,validTimes:true};
  const board={...input.board,champions:{competition:'Champions' as const,receivedAt:input.now-50,matches:[{id:'ucl-event',home:'Barcelona',away:'Real Madrid',kickoffAt:quote.kickoffAt,quotes:[wrapper]}]}};
  const champions={snapshot:championsSnapshot,model:fitModel(championsSnapshot.matches,input.model.cutoff),evaluation:structuredClone(input.evaluation),operationalReady:true};
  const context={...input,ledger:ledger.snapshot(),board,champions,preferences:{minStakeEur:.1,maxBetFraction:.1}};
  const report=buildReport(context);assert.equal(report.candidates.length,2);assert.ok(report.candidates.every(c=>c.modelValidated));assert.ok(report.bankroll.totalRecommendedEur<=5);assert.equal(ledger.snapshot().bets.length,0);
  for(const row of champions.evaluation.marketGates['1x2']!.selections)row.passed=false;
  const rejected=buildReport(context);assert.ok(rejected.candidates.find(c=>c.competition==='LaLiga')!.stakeEur>0);assert.equal(rejected.candidates.find(c=>c.competition==='Champions')!.stakeEur,0);
  champions.evaluation=structuredClone(input.evaluation);const root=structuredClone(input.evaluation);for(const row of root.marketGates['1x2']!.selections)row.passed=false;
  const championsOnly=buildReport({...context,evaluation:root,champions});assert.ok(championsOnly.candidates.find(c=>c.competition==='Champions')!.stakeEur>0);assert.equal(championsOnly.candidates.find(c=>c.competition==='LaLiga')!.stakeEur,0);
  championsQuote.competition='LaLiga' as any;assert.equal(buildReport(context).candidates.find(c=>c.competition==='Champions')!.stakeEur,0);
 }finally{ledger.close();}
});
