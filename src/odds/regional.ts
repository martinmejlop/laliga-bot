import type {Quote} from './freshness.ts';

export type RegionalMode='point'|'sampled-coverage'|'unverified';
export interface RegionalDecision {
  verified:boolean; mode:RegionalMode; checkedAt:number|null; reason:string; priceForCalculation:number;
}
// Compatibilidad de cobertura y precio observado son afirmaciones distintas.
// Este módulo no autoriza importes: vigencia, disponibilidad, modelo y saldo tienen sus propias puertas.
type TimedQuote=Quote & {sourceObservedAt?:number|null;timestampKind?:'observation'|'last-price-change'};
type RecordValue=Record<string,unknown>;
const object=(value:unknown):value is RecordValue=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const nonempty=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;
const epoch=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
const price=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>1&&value<=10000;
function auditTime(value:unknown):number|null {
  if(epoch(value))return value;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(value)||!/(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
  const calendar=new Date(`${value.slice(0,10)}T12:00:00Z`);
  if(!Number.isFinite(calendar.getTime())||calendar.toISOString().slice(0,10)!==value.slice(0,10))return null;
  const parsed=Date.parse(value);return epoch(parsed)?parsed:null;
}
function spanishPublicUrl(value:unknown):boolean {
  if(typeof value!=='string')return false;
  try {const url=new URL(value);return url.protocol==='https:'&&['www.bet365.es','bet365.es'].includes(url.hostname)&&!url.username&&!url.password&&(!url.port||url.port==='443');}
  catch {return false;}
}
const scaleFor=(value:number)=>value>=1.1?100:1000;
function floorDisplay(value:number):number {
  const scale=scaleFor(value),scaled=value*scale;
  // Absorbe el error binario de una cantidad que ya está en un tick exacto.
  return Math.floor(scaled+Number.EPSILON*Math.max(1,Math.abs(scaled))*8)/scale;
}
function genuineDisplay(sourcePrice:unknown,displayPrice:unknown):boolean {
  if(!price(sourcePrice)||!price(displayPrice))return false;
  const scale=scaleFor(sourcePrice),tick=1/scale,epsilon=1e-9;
  const truncated=floorDisplay(sourcePrice),rounded=Math.round(sourcePrice*scale)/scale;
  return Math.abs(sourcePrice-displayPrice)<=tick+epsilon &&
    (Math.abs(displayPrice-truncated)<=epsilon||Math.abs(displayPrice-rounded)<=epsilon);
}
function validQuoteTime(quote:TimedQuote,now:number):boolean {
  if(!epoch(now)||!epoch(quote.receivedAt)||!epoch(quote.requestedAt)||quote.receivedAt>now||quote.requestedAt>quote.receivedAt)return false;
  if(!epoch(quote.sourceConfirmedAt)||quote.sourceConfirmedAt>quote.receivedAt)return false;
  if(quote.sourceObservedAt!==undefined&&quote.sourceObservedAt!==null&&(!epoch(quote.sourceObservedAt)||quote.sourceObservedAt>quote.receivedAt))return false;
  if(quote.timestampKind==='observation'){
    if(!epoch(quote.sourceObservedAt)||quote.sourceObservedAt>quote.sourceConfirmedAt)return false;
    return quote.sourceUpdatedAt===null || epoch(quote.sourceUpdatedAt)&&quote.sourceUpdatedAt<=quote.receivedAt;
  }
  if(quote.timestampKind!==undefined&&quote.timestampKind!=='last-price-change')return false;
  return epoch(quote.sourceUpdatedAt)&&quote.sourceUpdatedAt<=quote.sourceConfirmedAt;
}

export function regionalDecision(quote:Quote,now:number,audit:unknown):RegionalDecision {
  const timed=quote as TimedQuote;
  const rawPrice=price(quote?.price)?quote.price:0;
  const reject=(reason:string,checkedAt:number|null=null):RegionalDecision=>({verified:false,mode:'unverified',checkedAt,reason,priceForCalculation:rawPrice});
  if(!quote||quote.bookmaker!=='bet365'||!['LaLiga','Champions'].includes(quote.competition)||quote.period!=='full_time_regulation'||!nonempty(quote.eventId)||!nonempty(quote.selectionId)||!nonempty(quote.marketId)||quote.line!==null&&(!Number.isFinite(quote.line)||typeof quote.line!=='number'))return reject('Identidad de mercado incompleta o fuera del alcance regional.');
  const groupId=nonempty(quote.groupId)?quote.groupId:quote.marketId.split(':')[0];
  if(!nonempty(groupId)||!quote.marketId.startsWith(`${groupId}:`))return reject('El grupo no corresponde a la identidad del mercado.');
  if(!price(quote.price))return reject('Precio decimal inválido.');
  if(!validQuoteTime(timed,now))return reject('Las horas de origen o recepción son desconocidas, futuras o incoherentes.');
  if(!object(audit))return reject('No hay una auditoría regional válida.');
  const hours=audit.expiresAfterHours===undefined?24:audit.expiresAfterHours;
  if(typeof hours!=='number'||!Number.isFinite(hours)||hours<=0||hours>24)return reject('La caducidad de la auditoría regional no es válida.');
  const ttl=hours*3600000;
  if(audit.version===1){
    if(quote.competition!=='LaLiga')return reject('Contraste antiguo limitado a LaLiga.');
    const checkedAt=auditTime(audit.checkedAt);
    if(checkedAt===null)return reject('Falta una hora verificable del contraste puntual.');
    if(checkedAt>now||now-checkedAt>=ttl)return reject('El contraste puntual es futuro o ha caducado.',checkedAt);
    if(audit.eventId!==quote.eventId||!Array.isArray(audit.selections))return reject('Este partido no está en el contraste puntual.',checkedAt);
    const matches=audit.selections.filter((entry:unknown)=>object(entry)&&entry.selectionId===quote.selectionId&&entry.groupId===groupId);
    if(matches.length!==1)return reject('Selección ausente o ambigua en el contraste puntual.',checkedAt);
    const selected=matches[0] as RecordValue;
    if(selected.price!==quote.price)return reject('El precio ya no coincide con el contraste puntual.',checkedAt);
    if(Object.hasOwn(selected,'line')&&selected.line!==quote.line)return reject('La línea no coincide con el contraste puntual.',checkedAt);
    if(timed.timestampKind!=='observation'&&timed.sourceUpdatedAt!>checkedAt)return reject('El precio cambió después del contraste puntual.',checkedAt);
    return {verified:true,mode:'point',checkedAt,reason:'Precio igual al contraste puntual documentado; no equivale a comprobar tu cuenta en este instante.',priceForCalculation:quote.price};
  }
  if(audit.version!==2||audit.publicOnly!==true||!Array.isArray(audit.coverage))return reject('Perfil regional muestral inválido o sin alcance público explícito.');
  const candidates:{entry:RecordValue;selection:RecordValue;checkedAt:number}[]=[];
  let lineMismatch=false;
  for(const entry of audit.coverage){
    if(!object(entry)||(entry.competition??'LaLiga')!==quote.competition||entry.eventId!==quote.eventId||entry.groupId!==groupId||entry.period!==quote.period)continue;
    if(!Array.isArray(entry.selections))return reject('La muestra del mercado no contiene selecciones válidas.');
    const selections=entry.selections.filter((selection:unknown)=>object(selection)&&selection.selectionId===quote.selectionId);
    if(selections.length>1)return reject('La misma selección está duplicada en la muestra regional.');
    if(!selections.length)continue;
    const selection=selections[0] as RecordValue;
    if(selection.line!==quote.line){lineMismatch=true;continue;}
    const checkedAt=auditTime(entry.checkedAt);
    if(checkedAt===null)return reject('La muestra regional no tiene una hora verificable.');
    candidates.push({entry,selection,checkedAt});
  }
  if(!candidates.length)return reject(lineMismatch?'La línea no está comprendida en la muestra regional.':'Esta identidad de partido, mercado y selección no está comprendida en la muestra regional.');
  candidates.sort((a,b)=>b.checkedAt-a.checkedAt);
  const selected=candidates[0],{entry,selection,checkedAt}=selected;
  if(checkedAt>now||now-checkedAt>=ttl)return reject('La muestra regional es futura o ha caducado.',checkedAt);
  if(entry.scope!=='sampled-coverage'||!spanishPublicUrl(entry.url)||!nonempty(selection.label)||!nonempty(selection.side))return reject('La muestra carece de URL española, etiqueta o alcance verificable.',checkedAt);
  if(!genuineDisplay(selection.sourcePrice,selection.displayPrice))return reject('Los precios observados de origen y de España difieren más que un redondeo legítimo.',checkedAt);
  // Una comprobación más reciente que contradice la inicial no se elude buscando otra antigua.
  for(const other of candidates.filter(candidate=>candidate!==selected&&candidate.checkedAt===checkedAt)){
    if(other.entry.scope!==entry.scope||other.selection.sourcePrice!==selection.sourcePrice||other.selection.displayPrice!==selection.displayPrice||other.entry.url!==entry.url)return reject('Hay muestras regionales simultáneas contradictorias.',checkedAt);
  }
  const priceForCalculation=Math.min(quote.price,floorDisplay(quote.price));
  if(priceForCalculation<=1)return reject('El precio conservador no permite un cálculo de valor válido.',checkedAt);
  return {verified:true,mode:'sampled-coverage',checkedAt,reason:'Compatibilidad regional muestral para esta identidad exacta; no es una verificación del precio español actual ni de tu cuenta.',priceForCalculation};
}
