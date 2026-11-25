import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT} from '../src/config.ts';
import {parseLiveFixture,fetchLiveFixture} from '../src/odds/live.ts';
import type {OddsBoard} from '../src/odds/moviodds.ts';
import {checkQuote} from '../src/odds/freshness.ts';

const clock=Date.UTC(2026,10,15,21,39,40),iso=(at:number)=>new Date(at).toISOString();
const event:OddsBoard['matches'][number]={id:'203186631',home:'Real Madrid',away:'Celta Vigo',kickoffAt:clock+6*86400000,refreshSeconds:1800,quotes:[]};
function response(){return {site:'com',fixture:event.id,source:'live-fetch',count:3,dropped:0,groups:1,server_time:iso(clock-100),group_status:{'40':{polled_at:iso(clock-150)}},quotes:[
  {fixture_id:event.id,group_id:'40',group_name:'Full Time Result',market_id:'40',sel_id:'controlled-home',label:'Real Madrid',n2:'1',odds_dec:1.2,ts:iso(clock-300)},
  {fixture_id:event.id,group_id:'40',group_name:'Full Time Result',market_id:'40',sel_id:'controlled-draw',label:'Draw',n2:'X',odds_dec:6.25,ts:iso(clock-300)},
  {fixture_id:event.id,group_id:'40',group_name:'Full Time Result',market_id:'40',sel_id:'controlled-away',label:'Celta Vigo',n2:'2',odds_dec:13,ts:iso(clock-300)}
]};}

test('La lectura directa conserva observación y confirmación reales sin inventar una fecha de cambio',()=>{
  const input=response(),board=parseLiveFixture(input,event,clock-1000,clock),quote=board.matches[0].quotes[0] as any;
  assert.equal(board.matches.length,1);assert.equal(quote.sourceUpdatedAt,null);assert.equal(quote.sourceObservedAt,clock-300);assert.equal(quote.sourceConfirmedAt,clock-150);assert.equal(quote.timestampKind,'observation');
  assert.deepEqual(quote.selection,{kind:'1x2',side:'home',line:null});assert.equal(quote.regionVerified,false);
  assert.equal(input.quotes[0].ts,iso(clock-300));assert.equal(quote.requestedAt,clock-1000);assert.equal(quote.receivedAt,clock);
});

test('Sitio, partido y origen incorrectos se rechazan sin tratar una caché como lectura nueva',()=>{
  for(const change of [{site:'com.au'},{source:'unknown'},{source:undefined},{fixture:'another-id'}])assert.throws(()=>parseLiveFixture({...response(),...change},event,clock-1000,clock),/sitio, partido y lectura directa/);
  const mixed=response();mixed.quotes[0].fixture_id='another';assert.throws(()=>parseLiveFixture(mixed,event,clock-1000,clock),/mezcla identidades/);
});

test('El plan gratuito puede devolver caché: conserva el último cambio y nunca renueva la confirmación al recibirla',()=>{
 const data=response();data.source='cache';data.group_status['40'].polled_at=iso(clock-120000);for(const q of data.quotes)q.ts=iso(clock-86400000);
 const quote=parseLiveFixture(data,event,clock-1000,clock).matches[0].quotes[0];
 assert.equal(quote.timestampKind,'last-price-change');assert.equal(quote.sourceUpdatedAt,clock-86400000);assert.equal(quote.sourceConfirmedAt,clock-120000);assert.equal(quote.sourceObservedAt,undefined);
});

test('Una respuesta truncada o vacía no se usa como prueba de desaparición de mercado',()=>{
  for(const change of [{dropped:1},{count:2},{count:0,quotes:[]}])assert.throws(()=>parseLiveFixture({...response(),...change},event,clock-1000,clock),/incompleta|no devuelve/);
});

test('Las confirmaciones ausentes, futuras o sin zona no se sustituyen por la hora de recepción',()=>{
  assert.throws(()=>parseLiveFixture({...response(),group_status:undefined},event,clock-1000,clock),/confirmación/);
  for(const group_status of [{}, {'40':{}},{'40':{polled_at:iso(clock+1)}},{'40':{polled_at:'2026-11-15T21:39:39'}}]){
    const quotes=parseLiveFixture({...response(),group_status},event,clock-1000,clock).matches[0].quotes;
    assert.ok(quotes.every(quote=>quote.validationError));assert.ok(quotes.every(quote=>!checkQuote({...quote,regionVerified:true},clock).valid));
  }
  assert.throws(()=>parseLiveFixture({...response(),server_time:iso(clock-31000)},event,clock-1000,clock),/servidor/);
  const late=response();late.quotes[0].ts=iso(clock-20);const rows=parseLiveFixture(late,event,clock-1000,clock).matches[0].quotes;
  assert.ok(rows[0].validationError);assert.equal(rows[0].suspended,false);assert.ok(rows.slice(1).every(row=>!row.validationError));
  assert.throws(()=>parseLiveFixture(response(),{...event,kickoffAt:clock},clock-1000,clock),/inicio/);
});

test('Un rechazo estructural de /quotes conserva la captura pública para auditarlo sin cabeceras',async t=>{
  t.mock.method(Date,'now',()=>clock);const raw=JSON.stringify({...response(),dropped:1});
  await assert.rejects(fetchLiveFixture(event,async()=>new Response(raw)),(error:any)=>{
    assert.equal(error.capture.raw,raw);assert.equal(error.capture.requestedAt,clock);assert.equal(error.capture.receivedAt,clock);
    assert.equal(error.capture.headers,undefined);assert.equal(error.capture.url,`https://moviodds.com/quotes?fi=${event.id}&site=com`);return true;
  });
});

test('El transporte conserva el texto original y solo consulta el endpoint público de lectura',async t=>{
  t.mock.method(Date,'now',()=>clock);
  const raw=JSON.stringify(response(),null,1);
  const result=await fetchLiveFixture(event,async(url,options)=>{
    assert.equal(url,`https://moviodds.com/quotes?fi=${event.id}&site=com`);assert.equal(options?.method,undefined);assert.equal(options?.redirect,'error');
    assert.equal((options?.headers as any)?.authorization,undefined);return new Response(raw);
  });
  assert.equal(result.capture.raw,raw);assert.equal(result.capture.receivedAt,clock);assert.equal(result.board.matches[0].quotes.length,3);
});

test('La muestra real archivada de /quotes mantiene las horas del proveedor y su procedencia',()=>{
  const path=join(ROOT,'data/acceptance-history-probe/real-madrid-quotes.json');
  // El test mantiene una muestra controlada portable si no se ha descargado esta evidencia local.
  if(!existsSync(path)){assert.ok(parseLiveFixture(response(),event,clock-1000,clock));return;}
  const capture=JSON.parse(readFileSync(path,'utf8')),data=JSON.parse(capture.raw);
  assert.equal(capture.status,200);assert.equal(data.source,'live-fetch');assert.equal(data.site,'com');
  const board=parseLiveFixture(data,{...event,kickoffAt:1795291200000},capture.requestedAt,capture.receivedAt);
  assert.ok(board.matches[0].quotes.length>=3);assert.ok(board.matches[0].quotes.every((quote:any)=>quote.sourceUpdatedAt===null&&quote.sourceObservedAt!==null&&quote.sourceConfirmedAt!==null));
  assert.ok(board.matches[0].quotes.every(quote=>capture.receivedAt-quote.sourceConfirmedAt!<1000));
});
