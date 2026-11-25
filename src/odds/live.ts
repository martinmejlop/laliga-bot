import {readPublicText} from '../net.ts';
import {parseMarketBoard,MAIN_GROUPS,applyRegionalAudit} from './markets.ts';
import {allMatches,type OddsBoard} from './moviodds.ts';
import {parseChampions,CHAMPIONS_LEAGUE} from './champions.ts';

type Event=OddsBoard['matches'][number];
function utc(value:unknown):number|null {
  if(typeof value!=='string'||!/(Z|[+-]\d{2}:\d{2})$/i.test(value))return null;
  const result=Date.parse(value);return Number.isFinite(result)&&result>0?result:null;
}

/** Single-fixture response; cache and direct reads keep different timestamp semantics. */
export function parseLiveFixture(data:any,event:Event,requestedAt:number,receivedAt:number):OddsBoard {
  if(!event||typeof event.id!=='string'||!event.id||typeof event.home!=='string'||!event.home.trim()||typeof event.away!=='string'||!event.away.trim()||event.home===event.away||!Number.isSafeInteger(event.kickoffAt)||event.kickoffAt<=receivedAt)throw new Error('Identidad o inicio del partido no válidos para una consulta previa.');
  if(!Number.isSafeInteger(requestedAt)||!Number.isSafeInteger(receivedAt)||requestedAt<=0||receivedAt<requestedAt)throw new Error('Horas de solicitud y recepción incompatibles.');
  if(!data||data.site!=='com'||!['live-fetch','cache'].includes(data.source)||data.fixture!==event.id)throw new Error('La consulta no confirma sitio, partido y lectura directa o caché identificada esperados.');
  if(!Array.isArray(data.quotes)||!Number.isSafeInteger(data.count)||data.count!==data.quotes.length||data.dropped!==0)throw new Error('Respuesta de precios incompleta: no se utiliza para retirar ni renovar selecciones.');
  if(!data.count)throw new Error('El proveedor no devuelve precios confirmados; no se supone que el mercado haya cerrado.');
  if(!data.group_status||typeof data.group_status!=='object'||Array.isArray(data.group_status))throw new Error('Falta confirmación por mercado en la lectura directa.');
  const serverTime=utc(data.server_time);
  // Tolerancia del reloj del sobre, igual al catálogo; nunca se aplica a la confirmación de una cuota.
  if(serverTime===null||serverTime>receivedAt+5000||receivedAt-serverTime>30000)throw new Error('La respuesta tiene una hora de servidor antigua o incompatible.');
  for(const raw of data.quotes){
    if(!raw||raw.fixture_id!==event.id)throw new Error('La respuesta mezcla identidades de partidos.');
    if(!MAIN_GROUPS.includes(raw.group_id))continue;
  }
  const envelope={site:data.site,server_time:data.server_time,matches:[{
    id:event.id,sport:'soccer',league:event.competition==='Champions'?CHAMPIONS_LEAGUE:'Spain La Liga',home:event.home,away:event.away,in_play:false,
    kickoff_utc:new Date(event.kickoffAt).toISOString(),refresh_s:event.refreshSeconds,
    group_status:data.group_status,quotes:data.quotes
  }]};
  const board=event.competition==='Champions'?{requestedAt,receivedAt,serverTime,site:'com' as const,regionVerified:false as const,matches:[],champions:parseChampions(envelope,receivedAt,MAIN_GROUPS,requestedAt)}:parseMarketBoard(envelope,requestedAt,receivedAt);
  for(const match of allMatches(board))for(const quote of match.quotes){
    const raw=data.quotes.find((row:any)=>row.sel_id===quote.selectionId&&`${row.group_id}:${row.market_id??''}`===quote.marketId);
    const confirmed=utc(data.group_status[quote.groupId!]?.polled_at),observed=utc(raw?.ts);
    quote.sourceConfirmedAt=confirmed;
    // Direct fetch stamps rows at the read; cache keeps the actual last-change timestamps.
    if(data.source==='live-fetch')Object.assign(quote,{sourceUpdatedAt:null,sourceObservedAt:observed,timestampKind:'observation'});
    else Object.assign(quote,{sourceUpdatedAt:observed,timestampKind:'last-price-change'});
    // Identidad y lote ya están verificados. Un reloj incoherente excluye esa
    // selección, no destruye el resto del partido ni inventa una suspensión.
    if(confirmed===null||observed===null||confirmed>receivedAt||observed>confirmed)quote.validationError='Marcas de observación o confirmación de mercado no verificadas.';
    applyRegionalAudit(quote,receivedAt);
  }
  return board;
}

export async function fetchLiveFixture(event:Event,request:typeof fetch=fetch):Promise<{board:OddsBoard;capture:{raw:string;url:string;requestedAt:number;receivedAt:number}}> {
  if(!event||typeof event.id!=='string'||!event.id.trim())throw new Error('Partido requerido.');
  const url=`https://moviodds.com/quotes?fi=${encodeURIComponent(event.id)}&site=com`;
  const capture=await readPublicText(url,{request,maxBytes:16000000,timeoutMs:20000});
  try {
    let data:any;
    try{data=JSON.parse(capture.raw);}catch{throw new Error('El proveedor no ha devuelto precios en un formato legible.');}
    return {board:parseLiveFixture(data,event,capture.requestedAt,capture.receivedAt),capture};
  } catch(error) {
    // Texto público original para auditoría del rechazo; nunca incluye cabeceras.
    Object.assign(error as Error,{capture});throw error;
  }
}
