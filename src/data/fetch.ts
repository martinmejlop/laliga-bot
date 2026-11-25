import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.ts';

export interface Resource {url:string; raw:string; requestedAt:number; receivedAt:number; sha256:string; archived:boolean}
const directory=join(ROOT,'data/source-cache');
export function writeJsonAtomic(path:string,value:unknown) {
  const temp=`${path}.${randomUUID()}.tmp`;
  writeFileSync(temp,JSON.stringify(value,null,2)+'\n','utf8'); renameSync(temp,path);
}
export function scoreboardCacheTtl(resource:Resource,date:string,now=Date.now()):number {
  const today=new Date(now).toLocaleDateString('en-CA',{timeZone:'Europe/Madrid'}).replaceAll('-','');
  if(date>=today)return date===today?120000:6*3600000;
  try {
    const data=JSON.parse(resource.raw);
    // Una ficha previa no se convierte en resultado final al cambiar de día.
    if(!Array.isArray(data.events)||data.events.some((e:any)=>e.status?.type?.completed!==true))return 120000;
    const day=Date.parse(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T12:00:00Z`);
    return now-day<7*86400000?120000:7*86400000;
  }catch{return 0;}
}
export async function publicResource(key:string,url:string,options:{network:boolean;request:typeof fetch;ttlMs:number|((resource:Resource)=>number);fallback?:()=>Resource|null}): Promise<{resource:Resource;warning:string|null}> {
  mkdirSync(directory,{recursive:true});
  const path=join(directory,`${key}.json`);
  let cached:Resource|null=null;
  try {
    const item=JSON.parse(readFileSync(path,'utf8'));
    if (item.url===url&&typeof item.raw==='string'&&Number.isSafeInteger(item.receivedAt)&&item.receivedAt>0&&createHash('sha256').update(item.raw).digest('hex')===item.sha256) cached=item;
  } catch {}
  const ttl=cached?(typeof options.ttlMs==='function'?options.ttlMs(cached):options.ttlMs):0;
  if (cached&&options.network&&Date.now()>=cached.receivedAt&&Date.now()-cached.receivedAt<ttl) return {resource:cached,warning:null};
  let failure:string|null=null;
  if (options.network) {
    try {
      const requestedAt=Date.now();
      const response=await options.request(url,{signal:AbortSignal.timeout(12000),redirect:'error',headers:{accept:'application/json, application/rss+xml, application/xml, text/xml','user-agent':'LaLigaAdvisor/0.2 personal research'}});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const chunks:Uint8Array[]=[];let bytes=0;
      if (!response.body) throw new Error('Respuesta vacía');
      const reader=response.body.getReader();
      try {
        while(true) {
          const part=await reader.read();if(part.done)break;
          bytes+=part.value.length;if(bytes>3_000_000)throw new Error('Respuesta excede 3 MB');chunks.push(part.value);
        }
      } finally { await reader.cancel().catch(()=>{}); }
      const raw=Buffer.concat(chunks).toString('utf8');
      const resource:Resource={url,raw,requestedAt,receivedAt:Date.now(),sha256:createHash('sha256').update(raw).digest('hex'),archived:false};
      writeJsonAtomic(path,resource);
      return {resource,warning:null};
    } catch(error) { failure=error instanceof Error?error.message:'No se pudo consultar'; }
  }
  cached??=options.fallback?.()??null;
  // La procedencia original no cambia al volver a leer el mismo archivo: conserva su identidad inmutable.
  if (cached) return {resource:cached,warning:options.network?`${key}: consulta fallida (${failure}); muestra archivada de ${new Date(cached.receivedAt).toISOString()}.`:`${key}: muestra archivada de ${new Date(cached.receivedAt).toISOString()}, sin actualización de red.`};
  throw new Error(`${key}: ${failure??'sin muestra archivada disponible'}`);
}
export function archivedOpenFootball(season:string):Resource|null {
  const path=join(ROOT,'data/source-audits/2026-11-11T17-48-16.763Z',`openfootball-${season}.json`);
  if (!existsSync(path)) return null;
  const audit=JSON.parse(readFileSync(join(ROOT,'docs/source-audit-t02.json'),'utf8'));
  const item=audit.results.find((row:any)=>row.id===`openfootball-${season}`);
  if (!item) return null;
  const raw=readFileSync(path,'utf8');
  const sha256=createHash('sha256').update(raw).digest('hex');
  if (sha256!==item.sha256) throw new Error('Muestra histórica con huella distinta de la auditoría.');
  return {url:item.url,raw,sha256,requestedAt:Date.parse(item.checkedAt),receivedAt:Date.parse(audit.collectedAt),archived:true};
}
