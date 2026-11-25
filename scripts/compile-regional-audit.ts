import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT} from '../src/config.ts';
import {mapMarket} from '../src/odds/markets.ts';
import {canonicalTeamName} from '../src/data/identity.ts';
const folder=join(ROOT,'data/regional-evidence/2026-11-22'),manifestPath=process.argv[2];
if(!manifestPath)throw Error('Indica el directorio de la serie capturada.');
const manifest=JSON.parse(readFileSync(join(manifestPath,'manifest.json'),'utf8'));
const displayed=JSON.parse(readFileSync(join(folder,'displayed-prices.json'),'utf8'));
const coverage:any[]=[],rejected:any[]=[];
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const epoch=(value:any)=>Number.isSafeInteger(value)&&value>0;
const utc=(value:any)=>typeof value==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
const norm=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[.,]/g,'').replace(/\s+/g,' ').trim();
function validatePublic(event:any,es:any):{home:string;away:string;lines:string[]} {
 if(!/^\d+$/.test(event.eventId)||!epoch(es.checkedAt)||es.checkedAt>Date.now()||typeof es.text!=='string'||!epoch(event.kickoffAt)||event.kickoffAt<es.checkedAt||event.kickoffAt-es.checkedAt>31*86400000)throw Error('Identidad o fechas del contraste público inválidas.');
 const expected=`https://www.bet365.es/#/AC/B1/C1/D8/E${event.eventId}/F3/G40/`;
 if(es.url!==expected||!es.text.includes(expected))throw Error('La URL española no corresponde al partido esperado.');
 const lines=es.text.split('\n'),head=lines.map((line:string)=>line.match(/\btext (.+?) V\s+(.+)$/)).find((match:any)=>match&&canonicalTeamName(match[1])===canonicalTeamName(event.home)&&canonicalTeamName(match[2])===canonicalTeamName(event.away));
 if(!head||!canonicalTeamName(event.home)||!canonicalTeamName(event.away))throw Error('Los equipos del encabezado público no corresponden al partido.');
 const expectedDate=norm(new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(event.kickoffAt));
 if(!lines.some((line:string)=>norm(line.replace(/^\s*\d+ text /,'')).includes(expectedDate)))throw Error('La fecha y hora públicas no corresponden al inicio esperado.');
 return {home:head[1],away:head[2],lines};
}
function publicMarketBlock(lines:string[],heading:string):string {
 const prefix=`button ${heading}`;
 const index=lines.findIndex(line=>{const at=line.indexOf(prefix);if(at<0)return false;const suffix=line.slice(at+prefix.length);return suffix===''||suffix.startsWith(' CREAR APUESTA');});
 if(index<0)throw Error(`No aparece el encabezado público del mercado: ${heading}`);
 const indent=lines[index].match(/^\s*/)?.[0].length??0;
 let end=index+1;
 while(end<lines.length){const line=lines[end],spaces=line.match(/^\s*/)?.[0].length??0;if(spaces<=indent&&/\bbutton /.test(line))break;end++;}
 return norm(lines.slice(index,end).join(' '));
}
function loadFrame(frame:any,event:any):{capture:any;data:any} {
 if(frame.eventId!==event.eventId||typeof frame.file!=='string')throw Error('Identidad de captura inválida.');
 const base=resolve(manifestPath),file=resolve(base,frame.file),inside=relative(base,file);
 if(!inside||inside.startsWith('..')||isAbsolute(inside))throw Error('Ruta de captura fuera de la serie.');
 const capture=JSON.parse(readFileSync(file,'utf8'));
 if(!epoch(capture.requestedAt)||!epoch(capture.receivedAt)||capture.requestedAt>capture.receivedAt||capture.receivedAt>Date.now()||capture.requestedAt!==frame.requestedAt||capture.receivedAt!==frame.receivedAt||typeof capture.raw!=='string'||sha(capture.raw)!==frame.sha256)throw Error('Huella o marcas de captura incorrectas.');
 const url=new URL(capture.url);
 if(url.origin!=='https://moviodds.com'||url.pathname!=='/quotes'||url.username||url.password||url.searchParams.get('fi')!==event.eventId||url.searchParams.get('site')!=='com'||[...url.searchParams.keys()].some(key=>!['fi','site'].includes(key)))throw Error('La URL del proveedor no corresponde a esta captura.');
 const data=JSON.parse(capture.raw),serverTime=utc(data.server_time);
 if(data.site!=='com'||data.fixture!==event.eventId||!['cache','live-fetch'].includes(data.source)||data.source!==frame.source||data.server_time!==frame.serverTime||!Array.isArray(data.quotes)||!Number.isSafeInteger(data.count)||data.count<=0||data.count!==data.quotes.length||data.count!==frame.count||data.dropped!==0||!data.group_status||typeof data.group_status!=='object'||Array.isArray(data.group_status)||serverTime===null||serverTime>capture.receivedAt+5000||capture.receivedAt-serverTime>30000)throw Error('Sobre del proveedor incompleto o incoherente.');
 if(data.quotes.some((q:any)=>!q||q.fixture_id!==event.eventId))throw Error('La respuesta mezcla partidos.');
 return {capture,data};
}
for(const event of displayed.events){
 const publicFile=join(folder,`${event.eventId}.json`),es=JSON.parse(readFileSync(publicFile,'utf8')),publicData=validatePublic(event,es);
 const candidates=manifest.records.filter((r:any)=>r.file&&r.eventId===event.eventId&&epoch(r.receivedAt)&&Math.abs(r.receivedAt-es.checkedAt)<=60000).sort((a:any,b:any)=>Math.abs(a.receivedAt-es.checkedAt)-Math.abs(b.receivedAt-es.checkedAt)||a.receivedAt-b.receivedAt);
 if(!candidates.length)throw Error(`Falta lectura comparable a menos de un minuto: ${event.eventId}`);
 for(const market of event.markets){
  const block=publicMarketBlock(publicData.lines,market.heading);
  let chosen:any=null;const invalidFrames:any[]=[];
  // Primero elegir por cercanía y metadatos del grupo entero. Nunca buscar después
  // otro precio que coincida si el grupo elegido presenta una discrepancia.
  for(const frame of candidates){
   try {
    const {capture,data}=loadFrame(frame,event),rows=data.quotes.filter((q:any)=>q.group_id===market.groupId),seen=new Set<string>();
    if(!rows.length)throw Error('El grupo no aparece en la captura.');
    const confirmed=utc(data.group_status[market.groupId]?.polled_at);
    for(const q of rows){const changed=utc(q.ts),id=JSON.stringify([q.group_id,q.market_id??'',q.sel_id]);if(typeof q.sel_id!=='string'||!q.sel_id||seen.has(id)||!Number.isFinite(q.odds_dec)||q.odds_dec<=1||confirmed===null||changed===null||changed>confirmed||confirmed>capture.receivedAt)throw Error('Marcas o identidades del grupo incoherentes.');seen.add(id);}
    chosen={frame,capture,data,rows};break;
   }catch(error){invalidFrames.push({sourceFile:frame.file,reason:error instanceof Error?error.message:String(error)});}
  }
  if(!chosen){rejected.push({eventId:event.eventId,groupId:market.groupId,reason:'Ninguna captura temporalmente válida del grupo dentro de un minuto.',invalidFrames});continue;}
  const {frame,capture,rows}=chosen,selections:any[]=[];let mismatch=false;
  for(const side of market.selections){
   const peers=rows.filter((q:any)=>mapMarket(q,event)?.side===side.side);
   if(peers.length!==1)throw Error('Correspondencia de selección ausente o ambigua.');
   const raw=peers[0],mapped=mapMarket(raw,event)!,sourcePrice=raw.odds_dec,displayPrice=side.price,scale=sourcePrice>=1.1?100:1000;
   const match=Number.isFinite(displayPrice)&&displayPrice>1&&[Math.floor(sourcePrice*scale+1e-9)/scale,Math.round(sourcePrice*scale)/scale].some(value=>Math.abs(value-displayPrice)<1e-9);
   const labels:any={home:publicData.home,draw:'Empate',away:publicData.away,home_draw:`${publicData.home} o Empate`,draw_away:`Empate o ${publicData.away}`,home_away:`${publicData.home} o ${publicData.away}`};
   if(!labels[side.side]||!block.includes(norm(`${labels[side.side]} ${displayPrice.toFixed(displayPrice>=1.1?2:3)}`)))throw Error('La selección o el precio transcritos no aparecen bajo su encabezado público.');
   if(!match){mismatch=true;rejected.push({eventId:event.eventId,groupId:market.groupId,side:side.side,sourcePrice,displayPrice,sourceFile:frame.file,reason:'Diferencia de precio superior a redondeo/truncado.'});continue;}
   selections.push({selectionId:raw.sel_id,line:mapped.line,sourcePrice,displayPrice,label:raw.label,side:side.side});
  }
  if(mismatch||selections.length!==market.selections.length)continue;
  coverage.push({eventId:event.eventId,groupId:market.groupId,period:'full_time_regulation',checkedAt:new Date(Math.max(es.checkedAt,capture.receivedAt)).toISOString(),url:es.url,scope:'sampled-coverage',marketHeading:market.heading,kickoffAt:event.kickoffAt,selections,
   evidence:{spanMs:Math.abs(capture.receivedAt-es.checkedAt),publicFile:publicFile.slice(ROOT.length+1),publicSha256:sha(readFileSync(publicFile)),sourceFile:join(manifestPath,frame.file).slice(ROOT.length+1),sourceSha256:frame.sha256,sourceReceivedAt:capture.receivedAt,bookmakerObservedAt:es.checkedAt,discardedInvalidFrames:invalidFrames}});
 }
}
const path=join(ROOT,'config/region-audit.json'),old=JSON.parse(readFileSync(path,'utf8'));
const archive=join(ROOT,'docs/region-audit-before-nov22.json');if(!existsSync(archive))writeFileSync(archive,JSON.stringify(old,null,2));
writeFileSync(path,JSON.stringify({version:2,expiresAfterHours:24,publicOnly:true,scope:'Compatibilidad muestral por identidad; precio de cuenta no comprobado en cada instante. Se excluyen discrepancias de precio.',coverage:[...(old.coverage??[]).filter((e:any)=>!displayed.events.some((event:any)=>event.eventId===e.eventId)),...coverage]},null,2));
writeFileSync(join(ROOT,'docs/regional-comparison-nov22.json'),JSON.stringify({checkedAt:new Date().toISOString(),acceptedMarkets:coverage.length,acceptedSelections:coverage.reduce((n,e)=>n+e.selections.length,0),coverage,rejected},null,2));
console.log(JSON.stringify({acceptedMarkets:coverage.length,acceptedSelections:coverage.reduce((n,e)=>n+e.selections.length,0),rejected}));
