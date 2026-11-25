import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseChampions,championsState} from '../src/odds/champions.ts';
import {MarketMonitor} from '../src/odds/monitor.ts';
import {Store} from '../src/storage/store.ts';
import {allMatches} from '../src/odds/moviodds.ts';
import {regionalDecision} from '../src/odds/regional.ts';
const NOW=Date.UTC(2026,10,23,9),iso=(n:number)=>new Date(n).toISOString();
const match=(extra:any={})=>({id:'ucl',home:'Bodo/Glimt',away:'LASK Linz',sport:'soccer',league:'UEFA Champions League',in_play:false,kickoff_utc:iso(NOW+86400000),group_status:{'40':{polled_at:iso(NOW-10),stale:false}},quotes:[{fixture_id:'ucl',sel_id:'1',market_id:'40',group_id:'40',group_name:'Full Time Result',label:'Bodo/Glimt',n2:'1',ts:iso(NOW-20),odds_dec:2.5,suspended:false,phase:'prematch'}],...extra});
const envelope=(matches:any[])=>({site:'com',server_time:iso(NOW-1),matches});
test('Champions identifica exclusivamente UEFA masculina previa al partido y conserva todos los mercados solicitados',()=>{
  const data=envelope([match(),match({id:'afc',league:'AFC Champions League Elite'}),match({id:'women',league:'UEFA Womens Champions League'}),match({id:'virtual',sport:'esoccer'}),match({id:'live',in_play:true}),match({id:'finished',kickoff_utc:iso(NOW)})]);
  const board=parseChampions(data,NOW,['40']);assert.equal(board.matches.length,1);assert.equal(board.matches[0].quotes[0].price,2.5);
  assert.throws(()=>parseChampions(envelope([match(),match()]),NOW,['40']),/ambigua/);
  assert.throws(()=>parseChampions({...data,partial:true},NOW,['40']),/incompleto/);
});
test('Champions caduca por confirmación y recepción, retira partidos empezados y nunca propone dinero',()=>{
  const board=parseChampions(envelope([match()]),NOW,['40']);
  assert.equal(championsState(board,NOW).matches[0].quotes[0].status,'observed');
  assert.equal(championsState(board,NOW+30001).matches[0].quotes[0].status,'expired');
  assert.equal(championsState(board,NOW-1).matches[0].quotes[0].status,'expired');
  board.matches[0].quotes[0].suspended=true;
  assert.equal(championsState(board,NOW).matches[0].quotes[0].status,'suspended');
  assert.equal(championsState(board,NOW).stakeEur,0);assert.equal(championsState(board,NOW+86400000).matches.length,0);
  assert.equal(championsState(null,NOW).matches.length,0);
});
test('Los precios sin tiempos coherentes permanecen invalidados en Champions',()=>{
  const m=match();m.quotes[0].ts=iso(NOW+1);
  assert.equal(championsState(parseChampions(envelope([m]),NOW,['40']),NOW).matches[0].quotes[0].status,'invalid-time');
  assert.throws(()=>parseChampions(envelope([match({quotes:[{...m.quotes[0],fixture_id:'otro'}]})]),NOW,['40']),/inválida/);
});
test('Una sola consulta gratuita archiva Champions aparte y no crea partidos de LaLiga con equipos europeos',async t=>{
  t.mock.method(Date,'now',()=>NOW);const directory=mkdtempSync(join(tmpdir(),'ucl-monitor-'));let calls=0;
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const monitor=new MarketMonitor({directory,request:async input=>{calls++;assert.match(new URL(String(input)).searchParams.get('league')??'',/UEFA Champions League/);return new Response(JSON.stringify(envelope([match()])));}});
  t.after(()=>monitor.stop());await monitor.poll();assert.equal(calls,1);assert.equal(monitor.usage().used,1);
  assert.equal(monitor.board!.matches.length,0);assert.equal(monitor.board!.champions!.matches.length,1);
  const store=new Store(join(directory,'laliga.sqlite'),{readOnly:true});try{
    assert.equal(store.evidence(monitor.board!.champions!.captureId!).format,'moviodds-champions-extract-v1');
    assert.equal(store.summary().counts.fixtures,0);
    assert.doesNotMatch(String(store.evidence(monitor.captureId!).raw_text),/Bodo/);
  }finally{store.close();}
  monitor.stop();assert.equal(championsState(monitor.board?.champions,NOW).matches.length,0);
});
test('Refrescar solo LaLiga no renueva la hora de Champions y un fallo posterior retira ambas vistas',async t=>{
  let now=NOW,calls=0;t.mock.method(Date,'now',()=>now);
  const directory=mkdtempSync(join(tmpdir(),'ucl-direct-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const local=match({id:'ll',league:'Spain La Liga',home:'Barcelona',away:'Real Madrid'});
  local.quotes=local.quotes.map(q=>({...q,fixture_id:'ll',label:'Barcelona'}));
  const monitor=new MarketMonitor({directory,enableLive:true,request:async()=>{
    if(++calls===1)return new Response(JSON.stringify(envelope([local,match()])));
    if(calls===2)return new Response(JSON.stringify({site:'com',source:'cache',fixture:'ll',count:1,dropped:0,server_time:iso(now-1),group_status:{'40':{polled_at:iso(now-10)}},quotes:local.quotes}));
    return new Response('fallo',{status:503});
  }});t.after(()=>monitor.stop());
  await monitor.poll();const captureId=monitor.board!.champions!.captureId;
  now+=20000;monitor.viewed('ll');await monitor.poll();
  assert.equal(monitor.board!.champions!.receivedAt,NOW);assert.equal(monitor.board!.champions!.captureId,captureId);
  now+=20000;assert.equal(championsState(monitor.board!.champions,now).matches[0].quotes[0].status,'expired');
  await monitor.poll();assert.equal(monitor.board,null);assert.equal(championsState(monitor.board?.champions,now).matches.length,0);
});
test('La consulta directa de Champions conserva sus tiempos y evidencia propios y no crea equipos europeos en fixtures de LaLiga',async t=>{
 let now=NOW,calls=0;t.mock.method(Date,'now',()=>now);const directory=mkdtempSync(join(tmpdir(),'ucl-full-direct-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const local=match({id:'ll',league:'Spain La Liga',home:'Barcelona',away:'Real Madrid'});local.quotes=local.quotes.map(q=>({...q,fixture_id:'ll',label:'Barcelona'}));
 const monitor=new MarketMonitor({directory,enableLive:true,request:async input=>{
  if(++calls===1)return new Response(JSON.stringify(envelope([local,match()])));
  assert.match(String(input),/quotes\?fi=ucl/);
  return new Response(JSON.stringify({site:'com',source:'cache',fixture:'ucl',count:1,dropped:0,server_time:iso(now-1),group_status:{'40':{polled_at:iso(now-10)}},quotes:match().quotes}));
 }});t.after(()=>monitor.stop());await monitor.poll();const original=monitor.board!.matches[0].quotes[0].receivedAt;
 now+=20000;await monitor.poll({eventId:'ucl'});assert.equal(calls,2);assert.equal(monitor.board!.matches[0].quotes[0].receivedAt,original);
 const quote=allMatches(monitor.board).find(m=>m.competition==='Champions')!.quotes[0];assert.equal(quote.competition,'Champions');assert.equal(quote.receivedAt,now);assert.ok(quote.captureId);
 const store=new Store(join(directory,'laliga.sqlite'),{readOnly:true});try{assert.equal(store.summary().counts.fixtures,1);assert.equal(store.evidence(quote.captureId!).format,'moviodds-champions-live-v1');}finally{store.close();}
});
test('El contraste regional no cruza las identidades entre competiciones aunque coincidieran los identificadores',()=>{
 const quote=parseChampions(envelope([match()]),NOW,['40'],NOW-50).matches[0].quotes[0].quote;
 const entry={competition:'Champions',eventId:'ucl',groupId:'40',period:'full_time_regulation',checkedAt:iso(NOW-1),url:'https://www.bet365.es/#/AC/B1/C1/D8/Eucl/F3/G40/',scope:'sampled-coverage',selections:[{selectionId:'1',label:'Bodo/Glimt',side:'home',line:null,sourcePrice:2.5,displayPrice:2.5}]};
 const audit={version:2,publicOnly:true,expiresAfterHours:24,coverage:[entry]};
 assert.equal(regionalDecision(quote,NOW,audit).verified,true);assert.equal(regionalDecision({...quote,competition:'LaLiga'},NOW,audit).verified,false);
});
test('El panel activo puede renovar ambas competiciones en una sola consulta del catálogo sin duplicar consumo',async t=>{
 let now=NOW,calls=0;t.mock.method(Date,'now',()=>now);const directory=mkdtempSync(join(tmpdir(),'ucl-catalogue-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const monitor=new MarketMonitor({directory,enableLive:true,catalogueWhileActive:true,request:async url=>{calls++;assert.match(String(url),/\/odds\?/);return new Response(JSON.stringify({...envelope([match()]),server_time:iso(now-1)}));}});t.after(()=>monitor.stop());
 await monitor.poll();now+=20000;monitor.viewed('ucl');await monitor.poll();assert.equal(calls,2);assert.equal(monitor.usage().used,2);assert.equal(monitor.board!.champions!.matches[0].quotes[0].quote.receivedAt,now);
});
