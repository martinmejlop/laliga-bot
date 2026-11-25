import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {get as httpGet} from 'node:http';
import {createApplication} from '../src/server.ts';
import {Store} from '../src/storage/store.ts';
import type {DataSnapshot} from '../src/domain.ts';

test('Comprobar una cuota exige un partido conocido y vigilancia activa, cuenta la consulta y nunca registra una apuesta',async t=>{
 const a=await app(t),runtime=a.runtime;
 assert.equal((await a.post('/api/quotes/refresh',{eventId:'unknown'})).status,400);
 const now=Date.now();
 runtime.monitor.board={site:'com',regionVerified:false,requestedAt:now-5,receivedAt:now-1,serverTime:now-2,matches:[{id:'known',home:'Barcelona',away:'Real Madrid',kickoffAt:now+86400000,refreshSeconds:30,quotes:[]}]};
 assert.equal((await a.post('/api/quotes/refresh',{eventId:'known'})).status,400);
 runtime.monitor.running=true;const before=runtime.ledger.snapshot().bets.length;
 assert.equal((await a.post('/api/quotes/refresh',{eventId:'known'})).status,200);
 assert.equal(runtime.monitor.usage().used,1);assert.equal(runtime.monitor.board,null);assert.equal(runtime.ledger.snapshot().bets.length,before);
});

const empty=():DataSnapshot=>({version:1,updatedAt:Date.now(),matches:[],coverage:[],news:[],newsAnalysis:{status:'unavailable',checkedAt:Date.now(),model:'qwen3:8b',facts:[],warnings:['Ejemplo controlado sin red.']},errors:[]});
async function app(t:TestContext,refresh?:()=>Promise<DataSnapshot>){
  const folder=mkdtempSync(join(tmpdir(),'laliga-http-e2e-'));
  const directory=join(folder,'data'),reportsDirectory=join(folder,'reports');
  const application=createApplication({directory,reportsDirectory,artifacts:false,load:empty,refresh:refresh??(async()=>empty()),request:async()=>new Response('',{status:503,headers:{'retry-after':'60'}})});
  application.server.listen(0,'127.0.0.1');await once(application.server,'listening');
  const address=application.server.address();assert.ok(address&&typeof address==='object');
  const base=`http://127.0.0.1:${address.port}`;
  t.after(async()=>{application.runtime.close();await new Promise<void>((resolve,reject)=>application.server.close(error=>error?reject(error):resolve()));rmSync(folder,{recursive:true,force:true});});
  const get=async(path='/api/state',headers:any={})=>fetch(base+path,{headers});
  const state=await(await get()).json();
  const post=async(path:string,value:any,headers:any={})=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-laliga-token':state.csrfToken,...headers},body:JSON.stringify(value)});
  return {...application,folder,directory,reportsDirectory,base,get,post};
}

test('El recorrido HTTP local conserva dinero, idempotencia y separación de los libros sin realizar apuestas externas',async t=>{
  const a=await app(t);
  const first=await(await a.get()).json();assert.equal(first.ledger.manual.availableEur,100);assert.equal(first.ledger.manual.confirmed,false);assert.equal(first.report.bankroll.totalRecommendedEur,0);
  assert.equal((await a.post('/api/balance',{balanceEur:100,idempotencyKey:'controlled-balance'})).status,200);
  assert.equal((await a.post('/api/preferences',{minStakeEur:.1})).status,200);
  const input={idempotencyKey:'controlled-bet',eventId:'controlled-event',eventName:'Partido de prueba aislado',market:'Resultado final',selection:'Local',price:2,stakeEur:2,mode:'manual'};
  assert.equal((await a.post('/api/bets',input)).status,200);assert.equal((await a.post('/api/bets',input)).status,200);
  let state=await(await a.get()).json();assert.equal(state.ledger.manual.availableEur,98);assert.equal(state.ledger.manual.committedEur,2);assert.equal(state.ledger.manual.bets.length,1);
  const betId=state.ledger.manual.bets[0].id;
  assert.equal((await a.post('/api/bets/correct',{betId,idempotencyKey:'controlled-correction',stakeEur:3,price:2,reason:'Ejemplo controlado para comprobar correcciones.'})).status,200);
  state=await(await a.get()).json();assert.equal(state.ledger.manual.availableEur,97);assert.equal(state.ledger.manual.committedEur,3);
  const settlement={betId,result:'won',idempotencyKey:'controlled-settlement'};
  assert.equal((await a.post('/api/bets/settle',settlement)).status,200);assert.equal((await a.post('/api/bets/settle',settlement)).status,200);
  assert.equal((await a.post('/api/bets',{...input,idempotencyKey:'simulation-only',mode:'simulation',stakeEur:5})).status,200);
  state=await(await a.get()).json();assert.equal(state.ledger.manual.availableEur,103);assert.equal(state.ledger.manual.committedEur,0);assert.equal(state.ledger.manual.netProfitEur,3);
  assert.equal(state.ledger.simulation.availableEur,95);assert.equal(state.ledger.simulation.committedEur,5);
  assert.equal(state.report.bankroll.totalRecommendedEur,0);assert.equal(a.runtime.monitor.lastAttemptAt,null);
  const report=await a.get('/reports/latest.html');assert.equal(report.status,200);assert.match(await report.text(),/No se envía ninguna apuesta/);
  const home=await a.get('/');assert.equal(home.status,200);assert.match(await home.text(),/LaLiga/);
});

test('Actualizar datos con el seguimiento detenido no reinicia peticiones de cuotas',async t=>{
 const a=await app(t);let polls=0;t.mock.method(a.runtime.monitor,'poll',async()=>{polls++;});
 await a.post('/api/stop',{});await a.post('/api/refresh',{});
 for(let i=0;i<50&&a.runtime.job.running;i++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(a.runtime.job.running,false);assert.equal(a.runtime.monitor.running,false);assert.equal(polls,0);
});

test('La API exige sesión, origen local y formularios válidos antes de guardar dinero o leer archivos privados',async t=>{
  const a=await app(t);
  for(const headers of [{'x-laliga-token':'wrong'},{origin:'https://untrusted.example'},{'content-type':'text/plain'}]){
    const res=await a.post('/api/balance',{balanceEur:5,idempotencyKey:'forbidden'},headers);assert.equal(res.status,403);
  }
  const spoofed=await new Promise<number>((resolve,reject)=>{const url=new URL(a.base);const request=httpGet({hostname:url.hostname,port:url.port,path:'/api/state',headers:{host:'untrusted.example'}},response=>{response.resume();resolve(response.statusCode!);});request.on('error',reject);});
  assert.equal(spoofed,403);
  for(const path of ['/data/ledger.sqlite','/.env','/src/config.ts','/not-a-page'])assert.equal((await a.get(path)).status,404);
  assert.equal((await a.post('/api/balance',{balanceEur:-1,idempotencyKey:'negative'})).status,400);
  assert.equal((await a.post('/api/preferences',{minStakeEur:.001})).status,400);
  assert.equal((await a.post('/api/bets',{})).status,400);
  assert.equal((await a.post('/api/balance',{padding:'x'.repeat(65000)})).status,400);
  const state=await(await a.get()).json();assert.equal(state.ledger.events.length,0);assert.equal(state.ledger.manual.confirmed,false);
  assert.match((await a.get('/')).headers.get('content-security-policy')??'',/frame-ancestors 'none'/);
});

test('La actualización no se duplica, una fuente fallida retira cuotas y la copia restaura SQLite y sus referencias en carpeta aislada',async t=>{
  let release!:(value:DataSnapshot)=>void,calls=0;
  const pending=new Promise<DataSnapshot>(resolve=>{release=resolve;});
  const a=await app(t,async()=>{calls++;return pending;});
  const first=await a.post('/api/refresh',{});assert.equal(first.status,200);
  const second=await a.post('/api/refresh',{});assert.match((await second.json()).message,/curso/);assert.equal(calls,1);
  release(empty());
  for(let i=0;i<50&&a.runtime.job.running;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(a.runtime.job.running,false);assert.equal(a.runtime.monitor.board,null);
  assert.equal(a.runtime.report().bankroll.totalRecommendedEur,0);
  assert.equal((await a.post('/api/stop',{})).status,200);assert.equal(a.runtime.monitor.running,false);
  const source=new Store(join(a.directory,'laliga.sqlite'));
  source.registerSource('controlled','Fuente de prueba','https://example.org/test','Datos controlados, sin petición externa.');
  const now=Date.now(),captureId=source.capture({sourceId:'controlled',ingestionKey:'controlled-capture',url:'https://example.org/test',format:'controlled-json',rawText:'{"isolated":true}',receivedAt:now});source.close();
  writeFileSync(join(a.directory,'snapshot.json'),JSON.stringify(empty()));
  writeFileSync(join(a.directory,'champions-snapshot.json'),JSON.stringify({...empty(),competition:'Champions',matches:[{id:'ucl-controlled',competition:'Champions',season:'2026-27',date:'2026-11-03',kickoffAt:Date.UTC(2026,10,3,20),home:'Arsenal',away:'PSV',homeGoals:2,awayGoals:1,status:'finished',source:'controlled',captureId,availableAt:now}]}));
  const response=await a.post('/api/backup',{});assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.manifest.recoveryCheckedInIsolatedDirectory,true);assert.equal(result.manifest.sourceChecks.integrity,'ok');
  const restored=new Store(join(result.directory,'laliga.sqlite'),{readOnly:true});
  try{assert.equal(restored.evidence(captureId).raw_text,'{"isolated":true}');}finally{restored.close();}
  assert.ok(JSON.parse(readFileSync(join(result.directory,'manifest.json'),'utf8')).files.some((f:any)=>f.name==='ledger.sqlite'));
  assert.equal(JSON.parse(readFileSync(join(result.directory,'champions-snapshot.json'),'utf8')).matches[0].captureId,captureId);
  assert.equal((await(await a.get()).json()).ledger.manual.availableEur,100);
});
