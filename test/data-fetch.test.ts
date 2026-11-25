import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../src/config.ts';
import { publicResource,scoreboardCacheTtl,type Resource } from '../src/data/fetch.ts';

test('Una ficha previa guardada no queda congelada una semana al pasar su fecha al pasado',()=>{
  const now=Date.UTC(2026,10,23,12),sample=(completed:boolean)=>({raw:JSON.stringify({events:[{status:{type:{completed}}}]})} as Resource);
  assert.equal(scoreboardCacheTtl(sample(false),'20261122',now),120000);
  assert.equal(scoreboardCacheTtl(sample(false),'20261001',now),120000);
  assert.equal(scoreboardCacheTtl(sample(true),'20261122',now),120000);
  assert.equal(scoreboardCacheTtl(sample(true),'20261001',now),7*86400000);
});

test('Releer una muestra descargada conserva horas y procedencia, y una caída no renueva su antigüedad',async t=> {
  const key=`test-${randomUUID()}`,url='https://example.org/test';
  t.after(()=>rmSync(join(ROOT,'data/source-cache',`${key}.json`),{force:true}));
  const first=await publicResource(key,url,{network:true,ttlMs:0,request:async()=>new Response('{"real":true}')});
  const offline=await publicResource(key,url,{network:false,ttlMs:0,request:async()=>{throw new Error('No debería consultarse');}});
  assert.deepEqual(offline.resource,first.resource);assert.match(offline.warning!,/archivada/);
  const failure=await publicResource(key,url,{network:true,ttlMs:0,request:async()=>new Response('',{status:429})});
  assert.deepEqual(failure.resource,first.resource);assert.match(failure.warning!,/429/);
});
test('Una caché reciente evita nuevas consultas y no confunde una respuesta HTTP fallida con datos nuevos',async t=> {
  const key=`test-${randomUUID()}`,url='https://example.org/test';
  t.after(()=>rmSync(join(ROOT,'data/source-cache',`${key}.json`),{force:true}));
  const first=await publicResource(key,url,{network:true,ttlMs:3600000,request:async()=>new Response('{"test":1}')});
  const second=await publicResource(key,url,{network:true,ttlMs:3600000,request:async()=>{throw new Error('La caché debería evitar la petición');}});
  assert.equal(second.resource.receivedAt,first.resource.receivedAt);assert.equal(second.warning,null);
});
test('Una respuesta excesiva o una fuente sin datos se notifica sin inventar muestra',async ()=> {
  const key=`test-${randomUUID()}`;
  await assert.rejects(publicResource(key,'https://example.org/test',{network:true,ttlMs:0,request:async()=>new Response('x'.repeat(3_000_001))}),/3 MB/);
  await assert.rejects(publicResource(key,'https://example.org/test',{network:false,ttlMs:0,request:async()=>{throw new Error('No debería consultarse');}}),/sin muestra/);
});
