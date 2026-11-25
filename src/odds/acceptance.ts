import type {Quote} from './freshness.ts';
import type {MarketSelection} from '../domain.ts';

export interface EvidenceRef {captureId:string;sha256:string;}
export interface SourceSample extends EvidenceRef {role:'history'|'calendar'|'news'|'odds';receivedAt:number;free:boolean;}
export interface TimingSummary {count:number;p95:number;max:number;}
export interface ContinuousWindow {
  firstReceivedAt:number;lastReceivedAt:number;captures:number;maxGapMs:number;evidenceRefs:EvidenceRef[];
}
export interface MonitorAcceptanceEvidence {
  captures:number;priceChanges:number;explicitSuspensions:number;comparableWithdrawals:number;
  firstReceivedAt:number;lastReceivedAt:number;maxGapMs:number;
  httpDurationMs:TimingSummary;confirmationAgeMs:TimingSummary;evidenceRefs:EvidenceRef[];
  continuousWindow?:ContinuousWindow;
  usage?:{used:number;limit:number;freeOnly:boolean};
  regionalDelaySamples?:{eventId:string;marketId:string;bookmakerObservedAt:number;providerReceivedAt:number;evidenceRef:EvidenceRef}[];
}
export const REQUIRED_CONTROLLED_CASES=['price-change-recalculation','suspension','withdrawal','provider-failure','retry-after','stale-response','restart','budget-limit'] as const;
export interface ControlledAcceptanceChecks {
  checkedAt:number;passed:number;failed:number;cases:string[];evidenceRef:EvidenceRef;
}
export interface AcceptanceCheck {id:string;task:'T02'|'T05';passed:boolean;detail:string;}
export interface AcceptanceInput {
  now:number;catalog:unknown;regionalAudit:unknown;sourceSamples:SourceSample[];
  monitorEvidence:MonitorAcceptanceEvidence|null;controlledChecks:ControlledAcceptanceChecks|null;
}
type ObjectValue=Record<string,any>;
const object=(v:unknown):v is ObjectValue=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const epoch=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
const nonempty=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
const count=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const evidenceRef=(v:unknown):v is EvidenceRef=>object(v)&&nonempty(v.captureId)&&typeof v.sha256==='string'&&/^[a-f0-9]{64}$/i.test(v.sha256);
const references=(v:unknown):boolean=>Array.isArray(v)&&v.length>=2&&v.every(evidenceRef)&&new Set(v.map(ref=>ref.captureId)).size>=2;
function utc(value:unknown):number|null {
  if(epoch(value))return value;
  if(typeof value!=='string'||!/(Z|[+-]\d{2}:\d{2})$/i.test(value))return null;
  const parsed=Date.parse(value);return epoch(parsed)?parsed:null;
}
function officialUrl(value:unknown,help=false):boolean {
  if(typeof value!=='string')return false;
  try {const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&(help?url.hostname==='help.bet365.es':['www.bet365.es','bet365.es'].includes(url.hostname));}catch{return false;}
}
function activeCatalog(catalog:unknown):ObjectValue[] {
  return object(catalog)&&catalog.version===1&&['LaLiga','Champions'].includes(catalog.competition)&&catalog.bookmaker==='bet365'&&catalog.region==='ES'&&catalog.period==='full_time_regulation'&&Array.isArray(catalog.initialMarkets)?catalog.initialMarkets:[];
}
/** Inclusion only; quote freshness, regional decision and model gates still apply separately. */
export function catalogSelectionAllowed(quote:Pick<Quote,'groupId'|'marketId'|'period'|'selection'>&{competition?:'LaLiga'|'Champions'},catalog:unknown):boolean {
  if(!object(catalog)||catalog.competition!==(quote.competition??'LaLiga'))return false;
  if(quote.period!=='full_time_regulation'||!quote.selection)return false;
  const group=quote.groupId??quote.marketId.split(':')[0],selection:MarketSelection=quote.selection;
  if(!quote.marketId.startsWith(`${group}:`))return false;
  return activeCatalog(catalog).some(m=>object(m)&&m.kind===selection.kind&&Array.isArray(m.groupIds)&&m.groupIds.includes(group)&&Array.isArray(m.selections)&&m.selections.some((s:any)=>object(s)&&s.side===selection.side&&s.line===selection.line&&(s.team??null)===(selection.team??null)));
}
function validRule(rule:unknown,now:number):boolean {
  if(!object(rule)||!officialUrl(rule.url,true)||!nonempty(rule.scope)||typeof rule.checkedOn!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(rule.checkedOn))return false;
  const checked=Date.parse(`${rule.checkedOn}T00:00:00Z`);
  return Number.isFinite(checked)&&new Date(checked).toISOString().slice(0,10)===rule.checkedOn&&checked<=now&&now-checked<90*86400000;
}
export function catalogRulesCurrent(catalog:unknown,now:number):boolean {
 const markets=activeCatalog(catalog);return markets.length>=3&&markets.every(m=>Array.isArray(m.rules)&&m.rules.length>0&&m.rules.every((r:unknown)=>validRule(r,now)));
}
function validDisplay(source:unknown,display:unknown):boolean {
  if(typeof source!=='number'||!Number.isFinite(source)||source<=1||typeof display!=='number'||!Number.isFinite(display)||display<=1)return false;
  const scale=source>=1.1?100:1000,epsilon=1e-9;
  return Math.abs(source-display)<=1/scale+epsilon&&[Math.floor(source*scale+epsilon)/scale,Math.round(source*scale)/scale].some(p=>Math.abs(p-display)<epsilon);
}
function timing(value:unknown):boolean {
  return object(value)&&count(value.count)&&value.count>0&&typeof value.p95==='number'&&Number.isFinite(value.p95)&&value.p95>=0&&typeof value.max==='number'&&Number.isFinite(value.max)&&value.max>=value.p95;
}

/** This verifies evidence structure and acceptance criteria, not the truth of third-party claims. */
export function evaluateAcceptance(input:AcceptanceInput) {
  if(!epoch(input.now))throw new Error('Hora de aceptación inválida.');
  const now=input.now,checks:AcceptanceCheck[]=[],catalog=activeCatalog(input.catalog);
  const add=(task:'T02'|'T05',id:string,passed:boolean,detail:string)=>checks.push({task,id,passed,detail});
  const catalogValid=catalog.length>=3&&new Set(catalog.map(m=>m.kind)).size===catalog.length&&catalog.every(m=>object(m)&&nonempty(m.kind)&&Array.isArray(m.groupIds)&&m.groupIds.length>0&&m.groupIds.every(nonempty)&&Array.isArray(m.selections)&&m.selections.length>0&&nonempty(m.settlement));
  add('T02','catalog',catalogValid,'Catálogo explícito por grupo, selección, línea y periodo; no equivale a recomendar toda una familia.');
  add('T02','rules',catalogValid&&catalog.every(m=>Array.isArray(m.rules)&&m.rules.length>0&&m.rules.every((r:unknown)=>validRule(r,now))),'Cada mercado inicial conserva referencias oficiales españolas revisadas en los últimos 90 días.');
  const samples=Array.isArray(input.sourceSamples)?input.sourceSamples:[];
  const sourcesReady=['history','calendar','news','odds'].every(role=>samples.some(s=>s?.role===role&&s.free===true&&evidenceRef(s)&&epoch(s.receivedAt)&&s.receivedAt<=now&&now-s.receivedAt<24*3600000));
  add('T02','source-samples',sourcesReady,'Capturas reales, identificadas y gratuitas de históricos, calendario, noticias y cuotas, recibidas en las últimas 24 horas.');
  const audit=input.regionalAudit,validEntries:ObjectValue[]=[];
  const hours=object(audit)?audit.expiresAfterHours:undefined;
  if(object(audit)&&audit.version===2&&audit.publicOnly===true&&typeof hours==='number'&&hours>0&&hours<=24&&Array.isArray(audit.coverage))for(const entry of audit.coverage){
    if((entry.competition??'LaLiga')!==(object(input.catalog)?input.catalog.competition:'LaLiga'))continue;
    if(!object(entry)||entry.scope!=='sampled-coverage'||entry.period!=='full_time_regulation'||!nonempty(entry.eventId)||!nonempty(entry.groupId)||!officialUrl(entry.url)||!Array.isArray(entry.selections)||!entry.selections.length)continue;
    const checked=utc(entry.checkedAt);
    if(checked===null||checked>now||now-checked>=hours*3600000)continue;
    const peers=audit.coverage.filter((e:any)=>object(e)&&e.eventId===entry.eventId&&e.groupId===entry.groupId&&e.period===entry.period);
    // Do not let a new incomplete/contradictory profile fall back to an older one.
    if(peers.some((e:any)=>utc(e.checkedAt)===null||utc(e.checkedAt)!>checked))continue;
    const latest=peers.filter((e:any)=>utc(e.checkedAt)===checked);
    if(latest.some((e:any)=>JSON.stringify(e.selections)!==JSON.stringify(entry.selections)||e.url!==entry.url||e.scope!==entry.scope))continue;
    const admitted=catalog.find(m=>m.groupIds?.includes(entry.groupId));
    if(!admitted)continue;
    const selections=entry.selections;
    if(new Set(selections.map((s:any)=>s?.selectionId)).size!==selections.length)continue;
    if(!selections.every((s:any)=>object(s)&&nonempty(s.selectionId)&&nonempty(s.label)&&nonempty(s.side)&&validDisplay(s.sourcePrice,s.displayPrice)&&admitted.selections.some((a:any)=>a.side===s.side&&a.line===s.line)))continue;
    // The initial catalogue requires every declared side for each compared market.
    if(!admitted.selections.every((s:any)=>selections.some((e:any)=>e.side===s.side&&e.line===s.line)))continue;
    validEntries.push(entry);
  }
  const fixtureGroups=new Map<string,Set<string>>();
  for(const entry of validEntries){const groups=fixtureGroups.get(entry.eventId)??new Set<string>();groups.add(entry.groupId);fixtureGroups.set(entry.eventId,groups);}
  const completeFixtures=[...fixtureGroups].filter(([,groups])=>catalog.every(m=>m.groupIds.some((g:string)=>groups.has(g)))).map(([id])=>id);
  add('T02','regional-coverage',completeFixtures.length>=2,'Muestra pública vigente con todos los mercados iniciales y sus lados en al menos dos partidos. No acredita precio español actual ni condiciones particulares de cuenta.');
  const evidence=input.monitorEvidence;
  const evidenceValid=object(evidence)&&count(evidence.captures)&&evidence.captures>=2&&epoch(evidence.firstReceivedAt)&&epoch(evidence.lastReceivedAt)&&evidence.firstReceivedAt<=evidence.lastReceivedAt&&evidence.lastReceivedAt<=now&&references(evidence.evidenceRefs);
  add('T05','real-price-changes',evidenceValid&&count(evidence!.priceChanges)&&evidence!.priceChanges>0,'Cambios de precios de capturas reales comparables, con referencias y huellas de los originales.');
  add('T05','real-suspensions',evidenceValid&&count(evidence!.explicitSuspensions)&&evidence!.explicitSuspensions>0,'Suspensión explícita en el campo de la fuente. Un estado stale o fallo de confirmación no la sustituye ni demuestra por sí solo suspensión del operador.');
  add('T05','real-withdrawals',evidenceValid&&count(evidence!.comparableWithdrawals)&&evidence!.comparableWithdrawals>0,'Ausencia real entre respuestas completas del mismo alcance. No se cuentan diferencias de filtros, fases o endpoints como cierre del operador.');
  const window=evidence?.continuousWindow??evidence;
  const continuity=evidenceValid&&object(window)&&epoch(window.firstReceivedAt)&&epoch(window.lastReceivedAt)&&window.lastReceivedAt<=now&&window.firstReceivedAt<=window.lastReceivedAt&&window.lastReceivedAt-window.firstReceivedAt>=3600000&&count(window.captures)&&window.captures>=21&&typeof window.maxGapMs==='number'&&Number.isFinite(window.maxGapMs)&&window.maxGapMs>0&&window.maxGapMs<=180000&&references(window.evidenceRefs);
  add('T05','continuous-window',Boolean(continuity),'Criterio operativo escogido: una ventana observada de al menos una hora y 21 capturas, con hueco máximo de tres minutos; las pausas fuera de esa ventana no la invalidan.');
  const measured=evidenceValid&&timing(evidence!.httpDurationMs)&&timing(evidence!.confirmationAgeMs);
  add('T05','measured-delay',measured,'Duración HTTP y antigüedad de confirmación medidas; no se presentan como propagación desde Bet365 España.');
  const usage=evidence?.usage;
  const freeBudget=evidenceValid&&object(usage)&&count(usage.used)&&count(usage.limit)&&usage.limit>0&&usage.limit<=4800&&usage.used<=usage.limit&&usage.freeOnly===true;
  add('T05','free-budget',Boolean(freeBudget),'Contador persistente dentro del tope local conservador de 4.800 consultas y solo fuentes gratuitas.');
  const controlled=input.controlledChecks;
  const controlledPass=object(controlled)&&epoch(controlled.checkedAt)&&controlled.checkedAt<=now&&now-controlled.checkedAt<7*86400000&&count(controlled.passed)&&controlled.passed>=REQUIRED_CONTROLLED_CASES.length&&controlled.failed===0&&evidenceRef(controlled.evidenceRef)&&Array.isArray(controlled.cases)&&REQUIRED_CONTROLLED_CASES.every(id=>controlled.cases.includes(id));
  add('T05','controlled-faults',Boolean(controlledPass),'Pruebas recientes de recálculo, suspensión, retirada, fallos, Retry-After, caducidad, reinicio y límite; referenciadas a su resultado.');
  // T02 originally also requires observing the source series and measuring delay/consumption.
  add('T02','observed-source-series',evidenceValid&&count(evidence!.priceChanges)&&evidence!.priceChanges>0&&count(evidence!.explicitSuspensions)&&evidence!.explicitSuspensions>0&&Boolean(continuity)&&measured&&Boolean(freeBudget),'T02 conserva la comprobación real de series, suspensión, demora de origen/recepción y consumo; abrir una clave no satisface ese requisito.');
  const regionalDelays=(evidence?.regionalDelaySamples??[]).filter(s=>nonempty(s?.eventId)&&nonempty(s.marketId)&&epoch(s.bookmakerObservedAt)&&epoch(s.providerReceivedAt)&&s.bookmakerObservedAt<=s.providerReceivedAt&&s.providerReceivedAt<=now&&evidenceRef(s.evidenceRef));
  const tasks=Object.fromEntries(['T02','T05'].map(task=>{const own=checks.filter(c=>c.task===task);return [task,{status:own.every(c=>c.passed)?'complete':'partial',passed:own.filter(c=>c.passed).length,total:own.length,pending:own.filter(c=>!c.passed).map(c=>c.id)}];}));
  return {version:1,checkedAt:now,catalogId:object(input.catalog)?input.catalog.id??null:null,tasks,checks,
    regionalSummary:{validMarketSamples:validEntries.length,completeFixtures,selectionSamples:validEntries.reduce((n,e)=>n+e.selections.length,0)},
    enhancements:{bookmakerToProviderDelay:{measured:regionalDelays.length>0,samples:regionalDelays.length,note:'Mejora independiente: una pareja de observaciones no mide por sí sola la hora exacta en que cambió el operador. No se confunde con duración HTTP.'}},
    limitation:'La aceptación técnica del catálogo acotado no acredita rentabilidad, cobertura universal ni disponibilidad continua.'};
}
