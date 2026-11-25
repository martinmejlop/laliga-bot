import {test} from 'node:test';
import assert from 'node:assert/strict';
import {regionalDecision} from '../src/odds/regional.ts';
import type {Quote} from '../src/odds/freshness.ts';
const NOW=Date.UTC(2026,10,16,10),checkedAt=new Date(NOW-60000).toISOString();
const quote=(extra:Partial<Quote>={}):Quote=>({eventId:'event-one',marketId:'40:40',groupId:'40',selectionId:'selection-one',bookmaker:'bet365',competition:'LaLiga',period:'full_time_regulation',line:null,
  price:2.375,sourceUpdatedAt:NOW-120000,sourceConfirmedAt:NOW-1000,requestedAt:NOW-100,receivedAt:NOW-50,kickoffAt:NOW+86400000,suspended:false,regionVerified:false,...extra});
const legacy=()=>({version:1,eventId:'event-one',checkedAt,expiresAfterHours:24,selections:[{selectionId:'selection-one',groupId:'40',price:2.375}]});
const sample=()=>({version:2,expiresAfterHours:24,publicOnly:true,coverage:[{eventId:'event-one',groupId:'40',period:'full_time_regulation',checkedAt,url:'https://www.bet365.es/#/AC/B1/Eevent-one/',scope:'sampled-coverage',
  selections:[{selectionId:'selection-one',line:null,sourcePrice:2.375,displayPrice:2.37,label:'Local',side:'home'}]}]});

test('El contraste puntual v1 conserva el precio exacto y su condición de último cambio',()=>{
  const q=quote(),audit=legacy();assert.deepEqual(regionalDecision(q,NOW,audit),{verified:true,mode:'point',checkedAt:NOW-60000,reason:'Precio igual al contraste puntual documentado; no equivale a comprobar tu cuenta en este instante.',priceForCalculation:2.375});
  assert.equal(regionalDecision({...q,price:2.4},NOW,audit).verified,false);
  assert.equal(regionalDecision({...q,sourceUpdatedAt:NOW-10000},NOW,audit).verified,false);
  assert.equal(regionalDecision(q,NOW+24*3600000,audit).verified,false);
});

test('Una observación v1 puede tener cambio desconocido y conserva solo el contraste puntual de precio',()=>{
  const observed={...quote(),sourceUpdatedAt:null,sourceObservedAt:NOW-1000,timestampKind:'observation'} as Quote;
  assert.equal(regionalDecision(observed,NOW,legacy()).mode,'point');
  assert.equal(regionalDecision({...observed,price:2.4},NOW,legacy()).verified,false);
  assert.equal(regionalDecision({...observed,sourceObservedAt:NOW+1} as Quote,NOW,legacy()).verified,false);
});

test('La compatibilidad muestral v2 permite variación del precio para la misma identidad sin llamarla precio español actual',()=>{
  const audit=sample(),decision=regionalDecision(quote({price:2.625,sourceUpdatedAt:NOW-10000}),NOW,audit);
  assert.equal(decision.verified,true);assert.equal(decision.mode,'sampled-coverage');assert.equal(decision.priceForCalculation,2.62);
  assert.match(decision.reason,/no es una verificación del precio español actual/);
  assert.equal(audit.coverage[0].selections[0].sourcePrice,2.375);
});

test('La muestra no se generaliza a otro partido, mercado, periodo, selección o línea',()=>{
  const audit=sample();
  for(const change of [{eventId:'other'},{groupId:'981',marketId:'981:981'},{period:'first_half'},{selectionId:'other'},{line:.5},{groupId:'981'},{competition:'Other'}]){
    const decision=regionalDecision({...quote(),...change} as Quote,NOW,audit);assert.equal(decision.verified,false);assert.equal(decision.mode,'unverified');
  }
  const line=sample();line.coverage[0].selections[0].line=.5 as any;
  assert.equal(regionalDecision(quote(),NOW,line).verified,false);
});

test('Los precios iniciales deben corresponder a truncado o redondeo legítimo, no solo estar cerca',()=>{
  for(const displayPrice of [2.37,2.38]){const a=sample();a.coverage[0].selections[0].displayPrice=displayPrice;assert.equal(regionalDecision(quote(),NOW,a).verified,true);}
  for(const [sourcePrice,displayPrice] of [[2.37,2.36],[2.375,2.35],[2.375,2.4],[1.095238,1.09]]){
    const a=sample();Object.assign(a.coverage[0].selections[0],{sourcePrice,displayPrice});assert.equal(regionalDecision(quote(),NOW,a).verified,false);
  }
});

test('Se usa cálculo conservador a tres decimales por debajo de 1,1 y a dos por encima',()=>{
  const a=sample();Object.assign(a.coverage[0].selections[0],{sourcePrice:1.095238,displayPrice:1.095});
  for(const [source,expected]of [[1.095238,1.095],[1.166666666,1.16],[1.1,1.1],[1.727272727,1.72],[2.375,2.37]]){
    const decision=regionalDecision(quote({price:source}),NOW,a);assert.equal(decision.verified,true);assert.equal(decision.priceForCalculation,expected);assert.ok(decision.priceForCalculation<=source);
  }
  Object.assign(a.coverage[0].selections[0],{sourcePrice:1.0956,displayPrice:1.096});assert.equal(regionalDecision(quote({price:1.0956}),NOW,a).priceForCalculation,1.095);
});

test('El error binario no baja un tick adicional ni aumenta el precio de origen',()=>{
  const a=sample();
  for(const source of [2.37,1.14,1.095,2.3699999999999997]){
    const decision=regionalDecision(quote({price:source}),NOW,a);assert.equal(decision.verified,true);assert.ok(decision.priceForCalculation<=source);assert.ok(source-decision.priceForCalculation<.001);
  }
});

test('Las horas futuras, desconocidas o incoherentes no califican una muestra regional',()=>{
  for(const change of [{receivedAt:NOW+1},{requestedAt:NOW+1},{sourceUpdatedAt:NOW+1},{sourceConfirmedAt:NOW+1},{sourceUpdatedAt:null},{sourceConfirmedAt:null},{receivedAt:0},{sourceUpdatedAt:NOW-500}]){
    assert.equal(regionalDecision(quote(change),NOW,sample()).verified,false);
  }
  assert.equal(regionalDecision(quote(),NaN,sample()).verified,false);assert.equal(regionalDecision(quote(),Infinity,sample()).verified,false);
  assert.equal(regionalDecision({...quote(),sourceObservedAt:NOW+1} as Quote,NOW,sample()).verified,false);
  const future=sample();future.coverage[0].checkedAt=new Date(NOW+1).toISOString();assert.equal(regionalDecision(quote(),NOW,future).verified,false);
  assert.equal(regionalDecision(quote(),NOW+24*3600000,sample()).verified,false);
});

test('Una muestra de observación no inventa fecha del último cambio ni requiere que preceda a la auditoría',()=>{
  const observed={...quote(),sourceUpdatedAt:null,sourceObservedAt:NOW-2000,timestampKind:'observation'} as Quote;
  const decision=regionalDecision(observed,NOW,sample());assert.equal(decision.verified,true);assert.equal(observed.sourceUpdatedAt,null);
  assert.equal(regionalDecision({...observed,sourceObservedAt:null} as Quote,NOW,sample()).verified,false);
  assert.equal(regionalDecision({...observed,sourceObservedAt:NOW+100} as Quote,NOW,sample()).verified,false);
});

test('El perfil exige alcance público, URL española, tiempo y campos de muestra bien formados',()=>{
  for(const edit of [(a:any)=>a.publicOnly=false,(a:any)=>a.expiresAfterHours=48,(a:any)=>a.expiresAfterHours=NaN,(a:any)=>a.coverage[0].scope='global',
    (a:any)=>a.coverage[0].url='https://www.bet365.es.evil.example/',(a:any)=>a.coverage[0].url='http://www.bet365.es/',(a:any)=>a.coverage[0].url='https://user:password@www.bet365.es/',
    (a:any)=>a.coverage[0].checkedAt='2026-11-16 09:00:00',(a:any)=>a.coverage[0].checkedAt='2026-02-30T10:00:00Z',(a:any)=>a.coverage[0].selections[0].displayPrice=NaN,(a:any)=>a.coverage[0].selections[0].label='',
    (a:any)=>a.coverage[0].selections[0].side='',(a:any)=>a.coverage[0].selections=null]){
    const a=sample();edit(a);assert.equal(regionalDecision(quote(),NOW,a).verified,false);
  }
  for(const a of [null,undefined,[],false,'audit',{version:3},{version:2,publicOnly:true,coverage:[]}])assert.equal(regionalDecision(quote(),NOW,a).verified,false);
});

test('Una muestra nueva contradictoria no recurre a la anterior y se rechazan duplicados ambiguos',()=>{
  const a=sample(),newer=structuredClone(a.coverage[0]);newer.checkedAt=new Date(NOW-10000).toISOString();newer.selections[0].displayPrice=2.2;a.coverage.push(newer);
  assert.equal(regionalDecision(quote(),NOW,a).verified,false);
  const duplicate=sample();duplicate.coverage[0].selections.push({...duplicate.coverage[0].selections[0]});assert.equal(regionalDecision(quote(),NOW,duplicate).verified,false);
  const tie=sample(),other=structuredClone(tie.coverage[0]);other.selections[0].displayPrice=2.38;tie.coverage.push(other);assert.equal(regionalDecision(quote(),NOW,tie).verified,false);
});

test('La compatibilidad regional no sustituye disponibilidad, frescura, modelo o saldo',()=>{
  const decision=regionalDecision(quote({suspended:true,sourceConfirmedAt:NOW-100000,sourceUpdatedAt:NOW-120000}),NOW,sample());
  assert.equal(decision.verified,true);assert.equal(decision.mode,'sampled-coverage');
  for(const raw of [NaN,Infinity,0,1,-2]){const invalid=regionalDecision(quote({price:raw}),NOW,sample());assert.equal(invalid.verified,false);assert.equal(invalid.priceForCalculation,0);}
});
