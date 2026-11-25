import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mapMarket,parseMarketBoard,regionVerified,MAIN_ODDS_URL} from '../src/odds/markets.ts';
import {MarketMonitor} from '../src/odds/monitor.ts';
import {checkQuote,type Quote} from '../src/odds/freshness.ts';
import {Store} from '../src/storage/store.ts';

const NOW=Date.UTC(2026,10,15,12);
const iso=(at:number)=>new Date(at).toISOString();
function rawQuote(now=NOW,extra:Record<string,any>={}) {
  return {fixture_id:'controlled-event',sel_id:'controlled-selection',group_id:'40',market_id:'40',
    odds_dec:2,ts:iso(now-200),n2:'1',label:'Barcelona',...extra};
}
function rawMatch(now=NOW,extra:Record<string,any>={}) {
  return {id:'controlled-event',sport:'soccer',league:'Spain La Liga',home:'Barcelona',away:'Real Madrid',
    in_play:false,kickoff_utc:iso(now+2*86400000),refresh_s:1800,
    group_status:{'40':{polled_at:iso(now-20)}},quotes:[rawQuote(now)],...extra};
}
const envelope=(now=NOW,matches:any[]=[rawMatch(now)])=>({site:'com',server_time:iso(now-10),matches});
function temp(t:TestContext) {
  const directory=mkdtempSync(join(tmpdir(),'laliga-monitor-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  return directory;
}
function clock(t:TestContext) {
  let value=NOW;t.mock.method(Date,'now',()=>value);
  return {now:()=>value,advance:(delta:number)=>{value+=delta;}};
}
function monitored(t:TestContext,request:typeof fetch) {
  const directory=temp(t),monitor=new MarketMonitor({directory,request});
  t.after(()=>monitor.stop());return {directory,monitor};
}
function quote(now=NOW):Quote {
  return {eventId:'event-a',selectionId:'selection-a',marketId:'40:40',groupId:'40',bookmaker:'bet365',competition:'LaLiga',period:'full_time_regulation',line:null,
    price:2,sourceUpdatedAt:now-200,sourceConfirmedAt:now-20,receivedAt:now,requestedAt:now-10,kickoffAt:now+86400000,suspended:false,regionVerified:false};
}
const audit=(now=NOW)=>({version:1,checkedAt:iso(now-100),eventId:'event-a',selections:[{selectionId:'selection-a',groupId:'40',price:2}]});

test('El desfase pequeño del sobre se archiva sin inventar as-of ni alterar las confirmaciones',async t=>{
 clock(t);const {monitor,directory}=monitored(t,async()=>new Response(JSON.stringify({...envelope(),server_time:iso(NOW+56)})));
 await monitor.poll();assert.equal(monitor.error,null);assert.ok(monitor.captureId);assert.equal(monitor.board!.matches[0].quotes[0].sourceConfirmedAt,NOW-20);
 const store=new Store(join(directory,'laliga.sqlite'),{readOnly:true});try{const e=store.evidence(monitor.captureId!);assert.equal(e.source_as_of,null);assert.match(String(e.raw_text),/2026-11-15T12:00:00.056Z/);assert.equal(store.issues().length,1);}finally{store.close();}
});

test('Consulta directa: renueva solo el partido leído, conserva evidencia y detecta cambios sin inventar último cambio',async t=>{
  const c=clock(t),directory=temp(t);let calls=0;
  const monitor=new MarketMonitor({directory,enableLive:true,request:async url=>{
    calls++;
    if(calls===1)return new Response(JSON.stringify(envelope(c.now(),[rawMatch(),rawMatch(NOW,{id:'other-event',quotes:[rawQuote(NOW,{fixture_id:'other-event',sel_id:'other-sel'})]})])));
    assert.match(String(url),/\/quotes\?fi=controlled-event&site=com/);
    return new Response(JSON.stringify({site:'com',source:'live-fetch',fixture:'controlled-event',count:1,dropped:0,server_time:iso(c.now()-1),group_status:{'40':{polled_at:iso(c.now()-10)}},quotes:[rawQuote(c.now(),{odds_dec:2.2,ts:iso(c.now()-10)})]}));
  }});t.after(()=>monitor.stop());
  await monitor.poll();const original=monitor.board!.matches.find(m=>m.id==='other-event')!.quotes[0].receivedAt;
  c.advance(20000);monitor.viewed('controlled-event');await monitor.poll();
  const q=monitor.board!.matches.find(m=>m.id==='controlled-event')!.quotes[0];assert.equal(q.sourceUpdatedAt,null);assert.equal(q.sourceObservedAt,c.now()-10);
  assert.equal(monitor.board!.matches.find(m=>m.id==='other-event')!.quotes[0].receivedAt,original);assert.equal(monitor.usage().used,2);assert.equal(monitor.changes[0].kind,'price-changed');
  const store=new Store(join(directory,'laliga.sqlite'),{readOnly:true});try{assert.equal(store.evidence(monitor.captureId!).format,'moviodds-live-fixture-v1');}finally{store.close();}
  const restarted=new MarketMonitor({directory});assert.equal(restarted.changes[0].kind,'price-changed');restarted.stop();
});

test('Las selecciones se identifican por n2 o etiquetas explícitas, nunca por orden de la lista',()=>{
  const match=rawMatch();
  assert.deepEqual(mapMarket(rawQuote(NOW,{n2:'2',label:'Real Madrid'}),match),{kind:'1x2',side:'away',line:null});
  assert.deepEqual(mapMarket(rawQuote(NOW,{n2:'',label:'Empate'}),match),{kind:'1x2',side:'draw',line:null});
  assert.deepEqual(mapMarket(rawQuote(NOW,{n2:'1',label:'Etiqueta no disponible'}),match),{kind:'1x2',side:'home',line:null});
  const board=parseMarketBoard(envelope(NOW,[rawMatch(NOW,{quotes:[
    rawQuote(NOW,{n2:'2',label:'Real Madrid',sel_id:'away'}),rawQuote(NOW,{n2:'X',label:'Draw',sel_id:'draw'}),rawQuote(NOW,{n2:'1',label:'Barcelona',sel_id:'home'})
  ]})]),NOW-10,NOW);
  assert.deepEqual(board.matches[0].quotes.map(q=>q.selection?.side),['away','draw','home']);
});

test('Una identidad contradictoria o desconocida no se convierte en un pronóstico',()=>{
  const match=rawMatch();
  assert.equal(mapMarket(rawQuote(NOW,{n2:'1',label:'Real Madrid'}),match),null);
  assert.equal(mapMarket(rawQuote(NOW,{n2:'unknown',label:'unknown'}),match),null);
  assert.equal(mapMarket(rawQuote(NOW,{group_id:'not-selected',n2:'1'}),match),null);
  assert.equal(mapMarket(rawQuote(NOW,{period:'first_half'}),match),null);
  assert.equal(mapMarket(rawQuote(NOW,{group_id:'171',line:'1',side:'Real Madrid'}),match),null);
});

test('Las líneas asiáticas de cuarto se conservan y las fracciones ambiguas se rechazan',()=>{
  const match=rawMatch();
  assert.deepEqual(mapMarket(rawQuote(NOW,{group_id:'178002',line:'-0.5,-1',side:'Barcelona'}),match),{kind:'asian_handicap',side:'home',line:-.75});
  assert.deepEqual(mapMarket(rawQuote(NOW,{group_id:'178002',line:'0,0.5',side:'Real Madrid'}),match),{kind:'asian_handicap',side:'away',line:.25});
  assert.deepEqual(mapMarket(rawQuote(NOW,{group_id:'981',line:'2,2.5',side:'over'}),match),{kind:'total_goals',side:'over',line:2.25});
  assert.deepEqual(mapMarket(rawQuote(NOW,{group_id:'981',line:'2.75',side:'under'}),match),{kind:'total_goals',side:'under',line:2.75});
  for(const line of ['2.3','2,3','2,2.5,3','NaN','2.25,2.5'])assert.equal(mapMarket(rawQuote(NOW,{group_id:'981',line,side:'over'}),match),null);
});

test('El contraste regional está limitado al partido, selección, grupo, precio y fecha observados',()=>{
  const q=quote(),a=audit();
  assert.equal(regionVerified(q,NOW,a),true);
  assert.equal(regionVerified({...q,eventId:'another-event'},NOW,a),false);
  assert.equal(regionVerified({...q,selectionId:'another-selection'},NOW,a),false);
  assert.equal(regionVerified({...q,groupId:'981'},NOW,a),false);
  assert.equal(regionVerified({...q,price:2.01},NOW,a),false);
  assert.equal(regionVerified({...q,sourceUpdatedAt:NOW-50},NOW,a),false);
  assert.equal(regionVerified({...q,sourceUpdatedAt:null},NOW,a),false);
  assert.equal(regionVerified(q,NOW+24*3600000,a),false);
  assert.equal(regionVerified(q,NOW-101,a),false);
  assert.equal(regionVerified(q,NOW,{...a,version:2}),false);
  assert.equal(regionVerified(q,Number.NaN,a),false);
});

test('Cada mercado conserva su propia confirmación y la marca global no rellena fechas ausentes',()=>{
  const quotes=[rawQuote(),rawQuote(NOW,{group_id:'981',market_id:'981',sel_id:'total',line:'2.5',side:'over'})];
  const match=rawMatch(NOW,{quotes,polled_at:iso(NOW-1),group_status:{'40':{polled_at:iso(NOW-20)},'981':{stale:true,polled_at:iso(NOW-120000)}}});
  const board=parseMarketBoard(envelope(NOW,[match]),NOW-10,NOW);
  const total=board.matches[0].quotes.find(q=>q.groupId==='981')!;
  assert.equal(total.sourceConfirmedAt,NOW-120000);assert.equal(total.suspended,false);assert.equal(total.sourceStale,true);
  const missing=parseMarketBoard(envelope(NOW,[{...match,group_status:{'40':{polled_at:iso(NOW-20)}}}]),NOW-10,NOW);
  assert.equal(missing.matches[0].quotes.find(q=>q.groupId==='981')!.sourceConfirmedAt,null);
  assert.equal(checkQuote({...total,regionVerified:true},NOW).valid,false);
});

test('Se excluyen fútbol virtual, otras ligas, partidos iniciados y no se habilitan periodos sin modelo',()=>{
  for(const match of [rawMatch(NOW,{sport:'esoccer'}),rawMatch(NOW,{league:'Spain Segunda'}),rawMatch(NOW,{in_play:true}),rawMatch(NOW,{kickoff_utc:iso(NOW-1000)})]) {
    assert.equal(parseMarketBoard(envelope(NOW,[match]),NOW-10,NOW).matches.length,0);
  }
  assert.throws(()=>parseMarketBoard(envelope(NOW,[rawMatch(),rawMatch()]),NOW-10,NOW),/ambigua/);
  const half=rawMatch(NOW,{quotes:[rawQuote(NOW,{period:'first_half'})]});
  assert.equal(parseMarketBoard(envelope(NOW,[half]),NOW-10,NOW).matches[0].quotes[0].selection,undefined);
  assert.equal(mapMarket(rawQuote(NOW,{group_id:'10114',n2:'1X'}),rawMatch())?.side,'home_draw');
});

test('La consulta automática conserva evidencia y cambios dentro de su carpeta aislada',async t=>{
  const c=clock(t);let calls=0;
  const {directory,monitor}=monitored(t,async(url,options)=>{
    assert.equal(url,MAIN_ODDS_URL);assert.equal(options?.redirect,'error');assert.equal((options?.headers as any)?.authorization,undefined);
    calls++;return new Response(JSON.stringify(envelope(c.now(),[rawMatch(c.now(),{quotes:[rawQuote(c.now(),{odds_dec:calls===1?2:2.2})]})])));
  });
  await monitor.poll();assert.equal(monitor.board?.matches.length,1);assert.equal(monitor.usage().used,1);
  c.advance(1000);await monitor.poll();
  assert.equal(monitor.usage().used,2);assert.equal(monitor.changes[0].kind,'price-changed');
  assert.deepEqual([monitor.changes[0].previousPrice,monitor.changes[0].price],[2,2.2]);
  assert.ok(existsSync(join(directory,'latest-odds.json')));assert.ok(existsSync(join(directory,'price-changes.json')));
  assert.ok(existsSync(join(directory,'laliga.sqlite')));assert.ok(monitor.captureId);
  assert.equal(monitor.board!.matches[0].quotes[0].regionVerified,false);
});

test('Los fallos consumen presupuesto y el tope conservador de 4800 persiste tras reiniciar',async t=>{
  clock(t);const directory=temp(t),path=join(directory,'odds-usage.json');
  writeFileSync(path,JSON.stringify({month:'2026-11',used:4799}));let calls=0;
  const request:typeof fetch=async()=>{calls++;return new Response('',{status:503});};
  const first=new MarketMonitor({directory,request});t.after(()=>first.stop());
  await first.poll();assert.equal(first.usage().used,4800);assert.equal(calls,1);assert.equal(first.board,null);
  const second=new MarketMonitor({directory,request});t.after(()=>second.stop());
  await second.poll();assert.equal(calls,1);assert.equal(second.state().monthlyLimit,4800);
  assert.equal(second.board,null);assert.match(second.error!,/Límite mensual/);
  assert.equal(JSON.parse(readFileSync(path,'utf8')).used,4800);
  assert.equal(second.usage(Date.UTC(2026,11,1)).used,0);
});

test('Retry-After impide consultar de nuevo antes del plazo indicado por la fuente',async t=>{
  const c=clock(t);let calls=0;
  const {monitor}=monitored(t,async()=>{calls++;return calls===1?new Response('',{status:429,headers:{'retry-after':'600'}}):new Response(JSON.stringify(envelope(c.now())));});
  await monitor.poll();assert.equal(calls,1);assert.equal(monitor.board,null);
  c.advance(599999);await monitor.poll();assert.equal(calls,1);assert.equal(monitor.usage().used,1);
  c.advance(1);await monitor.poll();assert.equal(calls,2);assert.equal(monitor.usage().used,2);assert.ok(monitor.board);
});

test('Un contador ausente de validez o con JSON dañado bloquea la red para proteger el límite gratuito',async t=>{
  clock(t);const directory=temp(t),path=join(directory,'odds-usage.json');let calls=0;
  const monitor=new MarketMonitor({directory,request:async()=>{calls++;return new Response(JSON.stringify(envelope()));}});t.after(()=>monitor.stop());
  for(const value of [{month:'2026-11',used:-1},{month:'2026-11',used:1.5},{month:'2026-11',used:null},{month:'2026-99',used:1}]) {
    writeFileSync(path,JSON.stringify(value));assert.equal(monitor.usage().used,4800);await monitor.poll();
    assert.equal(calls,0);assert.equal(monitor.board,null);assert.match(monitor.error!,/contador/);
  }
  writeFileSync(path,'{broken json');assert.equal(monitor.usage().used,4800);await monitor.poll();assert.equal(calls,0);
});

test('Un fallo posterior a una respuesta válida retira las cuotas en vez de reutilizarlas',async t=>{
  const c=clock(t);let calls=0;
  const {monitor}=monitored(t,async()=>++calls===1?new Response(JSON.stringify(envelope(c.now()))):new Response('',{status:500}));
  await monitor.poll();assert.ok(monitor.board);const success=monitor.lastSuccessAt;
  c.advance(1000);await monitor.poll();
  assert.equal(monitor.board,null);assert.equal(monitor.lastSuccessAt,success);assert.equal(monitor.state().quoteCount,0);assert.match(monitor.error!,/HTTP 500/);
  monitor.stop();assert.equal(monitor.running,false);assert.equal(monitor.nextPollAt,null);assert.equal(monitor.board,null);
});

test('Detener durante una consulta en vuelo descarta su resultado y no vuelve a activar cuotas',async t=>{
  const c=clock(t);let release!:(response:Response)=>void;
  const {monitor,directory}=monitored(t,()=>new Promise(resolve=>{release=resolve;}));
  monitor.running=true;const pending=monitor.poll();assert.equal(monitor.busy,true);
  monitor.stop();release(new Response(JSON.stringify(envelope(c.now()))));await pending;
  assert.equal(monitor.board,null);assert.equal(monitor.running,false);assert.equal(monitor.busy,false);assert.equal(monitor.nextPollAt,null);
  assert.match(monitor.error!,/detenida/);assert.equal(existsSync(join(directory,'latest-odds.json')),false);
  assert.equal(monitor.usage().used,1);
});

test('Un error de correspondencia no publica parcialmente el lote de cuotas',async t=>{
  clock(t);const {monitor}=monitored(t,async()=>new Response(JSON.stringify(envelope(NOW,[rawMatch(NOW,{away:'Equipo no registrado'})]))));
  await monitor.poll();assert.equal(monitor.board,null);assert.equal(monitor.captureId,null);assert.match(monitor.error!,/correspondencia/);
});

test('Una marca temporal incoherente se conserva como evidencia y solo excluye esa cuota',async t=>{
  clock(t);
  const data=envelope(NOW,[rawMatch(NOW,{quotes:[rawQuote(NOW,{ts:iso(NOW-5)}),rawQuote(NOW,{sel_id:'valid-draw',n2:'X',label:'Draw',odds_dec:3})]})]);
  const {monitor,directory}=monitored(t,async()=>new Response(JSON.stringify(data)));
  await monitor.poll();assert.ok(monitor.board);assert.equal(monitor.invalidQuoteCount,1);assert.equal(monitor.error,null);
  const bad=monitor.board.matches[0].quotes.find(q=>q.selectionId==='controlled-selection')!;
  assert.equal(bad.suspended,false);assert.ok(bad.validationError);assert.deepEqual(checkQuote(bad,NOW),{valid:false,reason:'invalid-source-metadata'});
  const store=new Store(join(directory,'laliga.sqlite'),{readOnly:true});
  try{const fixture=store.fixtureByExternal('moviodds:com','controlled-event')!;assert.equal(store.quoteHistory(fixture).length,1);assert.equal(store.issues().length,1);assert.match(String(store.evidence(monitor.captureId!).raw_text),/controlled-selection/);}finally{store.close();}
});

test('Un precio cambiado con la misma marca de cambio invalida la respuesta completa',async t=>{
  const c=clock(t);let calls=0;
  const {monitor}=monitored(t,async()=>{calls++;return new Response(JSON.stringify(envelope(c.now(),[rawMatch(c.now(),{quotes:[rawQuote(c.now(),{odds_dec:calls===1?2:3,ts:iso(NOW-200)})]})])));});
  await monitor.poll();assert.ok(monitor.board);c.advance(1000);await monitor.poll();assert.equal(monitor.board,null);assert.match(monitor.error!,/incoherentes/);
});

test('Las ausencias se comparan dentro del mismo endpoint y no entre catálogo y partido',async t=>{
  const c=clock(t),directory=temp(t);let calls=0;
  const monitor=new MarketMonitor({directory,enableLive:true,request:async()=>{
    calls++;const quotes=[rawQuote(c.now()),rawQuote(c.now(),{sel_id:'draw',n2:'X',label:'Draw',odds_dec:3})];
    if(calls===1)return new Response(JSON.stringify(envelope(c.now(),[rawMatch(c.now(),{quotes:[...quotes,rawQuote(c.now(),{sel_id:'catalogue-only',n2:'2',label:'Real Madrid',odds_dec:4})]})])));
    const current=calls===2?quotes:quotes.slice(0,1);
    return new Response(JSON.stringify({site:'com',source:'cache',fixture:'controlled-event',count:current.length,dropped:0,server_time:iso(c.now()-1),group_status:{'40':{polled_at:iso(c.now()-10)}},quotes:current}));
  }});t.after(()=>monitor.stop());
  await monitor.poll();c.advance(20000);monitor.viewed('controlled-event');await monitor.poll();
  assert.equal(monitor.changes.some(change=>change.kind==='withdrawn'),false);
  c.advance(20000);await monitor.poll();
  const withdrawn=monitor.changes.filter(change=>change.kind==='withdrawn');assert.equal(withdrawn.length,1);assert.equal(withdrawn[0].selectionId,'draw');assert.match(withdrawn[0].scope,/^fixture:controlled-event:/);assert.equal(withdrawn[0].reason,'missing-from-same-endpoint-response');
  assert.equal(monitor.changes.some(change=>change.selectionId==='catalogue-only'),false);
  assert.equal(monitor.state().recentRequests[0].source,'cache');assert.ok(existsSync(join(directory,'odds-scopes.json')));
});

test('El rechazo de un lote incompleto se archiva y queda medido sin publicar precios ni cabeceras',async t=>{
  const c=clock(t),directory=temp(t);let calls=0;
  const monitor=new MarketMonitor({directory,enableLive:true,request:async()=>++calls===1?new Response(JSON.stringify(envelope(c.now()))):new Response(JSON.stringify({site:'com',source:'cache',fixture:'controlled-event',count:1,dropped:1,server_time:iso(c.now()-1),group_status:{'40':{polled_at:iso(c.now()-10)}},quotes:[rawQuote(c.now())]}))});t.after(()=>monitor.stop());
  await monitor.poll();c.advance(20000);monitor.viewed('controlled-event');await monitor.poll();assert.equal(monitor.board,null);assert.ok(monitor.lastFailedCaptureId);
  const store=new Store(join(directory,'laliga.sqlite'),{readOnly:true});try{const evidence=store.evidence(monitor.lastFailedCaptureId!);assert.equal(evidence.format,'moviodds-rejected-response-v1');assert.match(String(evidence.raw_text),/"dropped":1/);}finally{store.close();}
  const last=monitor.state().recentRequests[0];assert.equal(last.ok,false);assert.equal(last.captureId,monitor.lastFailedCaptureId);assert.equal(last.durationMs,0);assert.equal(last.headers,undefined);assert.match(last.url,/\/quotes\?fi=controlled-event&site=com/);
});

test('Un reloj incoherente en una selección de partido no invalida sus selecciones válidas',async t=>{
  const c=clock(t),directory=temp(t);let calls=0;
  const monitor=new MarketMonitor({directory,enableLive:true,request:async()=>++calls===1?new Response(JSON.stringify(envelope(c.now()))):new Response(JSON.stringify({site:'com',source:'cache',fixture:'controlled-event',count:2,dropped:0,server_time:iso(c.now()-1),group_status:{'40':{polled_at:iso(c.now()-10)}},quotes:[rawQuote(c.now(),{ts:iso(c.now()-5)}),rawQuote(c.now(),{sel_id:'valid-draw',n2:'X',label:'Draw',odds_dec:3})]}))});t.after(()=>monitor.stop());
  await monitor.poll();c.advance(20000);monitor.viewed('controlled-event');await monitor.poll();assert.equal(monitor.error,null);assert.equal(monitor.invalidQuoteCount,1);
  const rows=monitor.board!.matches[0].quotes;assert.ok(rows[0].validationError);assert.equal(rows[0].suspended,false);assert.equal(rows[1].validationError,undefined);
  const store=new Store(join(directory,'laliga.sqlite'),{readOnly:true});try{const fixture=store.fixtureByExternal('moviodds:com','controlled-event')!;assert.equal(store.quoteHistory(fixture).length,2);assert.match(String(store.evidence(monitor.captureId!).raw_text),/valid-draw/);}finally{store.close();}
  assert.equal(monitor.state().recentRequests[0].invalidQuoteCount,1);
});

test('El plazo Retry-After y las métricas sobreviven al reinicio sin reutilizar el tablero',async t=>{
 const c=clock(t),directory=temp(t);let calls=0;
 const request:typeof fetch=async()=>{calls++;return calls===1?new Response('',{status:429,headers:{'retry-after':'600'}}):new Response(JSON.stringify(envelope(c.now())));};
 const first=new MarketMonitor({directory,request});await first.poll();first.stop();
 const second=new MarketMonitor({directory,request});t.after(()=>second.stop());assert.equal(second.board,null);assert.equal(second.state().recentRequests[0].ok,false);
 await second.poll();assert.equal(calls,1);c.advance(599999);await second.poll();assert.equal(calls,1);c.advance(1);await second.poll();assert.equal(calls,2);assert.equal(second.error,null);assert.equal(second.state().recentRequests.length,2);
});

test('Un grupo entero ausente en la misma consulta se retira sin declarar un cierre del operador',async t=>{
 const c=clock(t),directory=temp(t);let calls=0;
 const monitor=new MarketMonitor({directory,enableLive:true,request:async()=>{
  calls++;if(calls===1)return new Response(JSON.stringify(envelope(c.now())));
  const resultQuotes=[rawQuote(c.now()),rawQuote(c.now(),{sel_id:'draw',n2:'X',label:'Draw',odds_dec:3})];
  const totals=[rawQuote(c.now(),{group_id:'981',market_id:'981',sel_id:'total-over',side:'over',line:'2.5'}),rawQuote(c.now(),{group_id:'981',market_id:'981',sel_id:'total-under',side:'under',line:'2.5'})];
  const quotes=calls===2?[...resultQuotes,...totals]:resultQuotes;
  return new Response(JSON.stringify({site:'com',source:'cache',fixture:'controlled-event',count:quotes.length,dropped:0,server_time:iso(c.now()-1),group_status:{'40':{polled_at:iso(c.now()-10)},'981':{polled_at:iso(c.now()-10)}},quotes}));
 }});t.after(()=>monitor.stop());
 await monitor.poll();c.advance(20000);monitor.viewed('controlled-event');await monitor.poll();c.advance(20000);await monitor.poll();
 assert.equal(monitor.error,null);assert.equal(monitor.board!.matches[0].quotes.length,2);
 const withdrawn=monitor.changes.filter(change=>change.kind==='withdrawn');assert.equal(withdrawn.length,2);assert.ok(withdrawn.every(change=>change.marketId==='981:981'&&change.reason==='missing-from-same-endpoint-response'));
 assert.equal(monitor.changes.some(change=>change.kind==='suspended'),false);
});

test('Una respuesta de partido vacía se archiva e invalida precios sin inventar una retirada o suspensión',async t=>{
 const c=clock(t),directory=temp(t);let calls=0;
 const monitor=new MarketMonitor({directory,enableLive:true,request:async()=>++calls===1?new Response(JSON.stringify(envelope(c.now()))):new Response(JSON.stringify({site:'com',source:'cache',fixture:'controlled-event',count:0,dropped:0,server_time:iso(c.now()-1),group_status:{},quotes:[]}))});t.after(()=>monitor.stop());
 await monitor.poll();c.advance(20000);monitor.viewed('controlled-event');await monitor.poll();
 assert.equal(monitor.board,null);assert.match(monitor.error!,/no devuelve precios/);assert.ok(monitor.lastFailedCaptureId);assert.equal(monitor.changes.some(change=>['withdrawn','suspended'].includes(change.kind)),false);
 const store=new Store(join(directory,'laliga.sqlite'),{readOnly:true});try{const evidence=store.evidence(monitor.lastFailedCaptureId!);const original=JSON.parse(String(evidence.raw_text));assert.equal(original.count,0);assert.deepEqual(original.quotes,[]);}finally{store.close();}
 assert.equal(monitor.state().recentRequests[0].ok,false);
});

test('Un fixture que sigue en el original como in_play se excluye por inicio, no como ausencia del proveedor',async t=>{
 const c=clock(t);let calls=0;
 const {monitor,directory}=monitored(t,async()=>new Response(JSON.stringify(envelope(c.now(),[rawMatch(c.now(),{in_play:++calls>1})]))));
 await monitor.poll();c.advance(1000);await monitor.poll();assert.equal(monitor.error,null);assert.equal(monitor.board!.matches.length,0);
 const change=monitor.changes.find(change=>change.kind==='withdrawn');assert.equal(change.reason,'not-prematch');
 const store=new Store(join(directory,'laliga.sqlite'),{readOnly:true});try{const original=JSON.parse(String(store.evidence(monitor.captureId!).raw_text));assert.equal(original.matches[0].id,'controlled-event');assert.equal(original.matches[0].in_play,true);}finally{store.close();}
});

test('Una fila con confirmación antigua e incoherente queda inválida y no revive el precio anterior',async t=>{
 const c=clock(t),directory=temp(t);let calls=0;
 const monitor=new MarketMonitor({directory,enableLive:true,request:async()=>{
  calls++;if(calls===1)return new Response(JSON.stringify(envelope(c.now())));
  const quotes=calls===2?[rawQuote(c.now())]:[rawQuote(c.now(),{odds_dec:9,ts:iso(NOW+19500)})];
  return new Response(JSON.stringify({site:'com',source:'cache',fixture:'controlled-event',count:1,dropped:0,server_time:iso(c.now()-1),group_status:{'40':{polled_at:iso(calls===2?c.now()-10:NOW+19400)}},quotes}));
 }});t.after(()=>monitor.stop());
 await monitor.poll();c.advance(20000);monitor.viewed('controlled-event');await monitor.poll();assert.equal(monitor.board!.matches[0].quotes[0].price,2);
 c.advance(20000);await monitor.poll();assert.equal(monitor.error,null);assert.equal(monitor.invalidQuoteCount,1);
 const quote=monitor.board!.matches[0].quotes[0];assert.equal(quote.price,9);assert.ok(quote.validationError);assert.equal(quote.suspended,false);assert.equal(checkQuote({...quote,regionVerified:true},c.now()).valid,false);
 const store=new Store(join(directory,'laliga.sqlite'),{readOnly:true});try{const fixture=store.fixtureByExternal('moviodds:com','controlled-event')!;assert.equal(store.quoteHistory(fixture).length,2);assert.match(String(store.evidence(monitor.captureId!).raw_text),/"odds_dec":9/);}finally{store.close();}
});
