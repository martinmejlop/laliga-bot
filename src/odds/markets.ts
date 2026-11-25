import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {readPublicText} from '../net.ts';
import {parseBoard, type OddsBoard} from './moviodds.ts';
import type {Quote} from './freshness.ts';
import type {MarketSelection} from '../domain.ts';
import {regionalDecision} from './regional.ts';
import {parseChampions,CHAMPIONS_LEAGUE} from './champions.ts';

// Identificadores observados realmente el 15/11. No se solicita ningún complemento de pago.
export const MAIN_GROUPS = ['40','981','10114','10150','10544','171','178002','938','10143'];
export const MAIN_ODDS_URL = `https://moviodds.com/odds?sport=soccer&groups=${MAIN_GROUPS.join(',')}&site=com&league=${encodeURIComponent('Spain La Liga,'+CHAMPIONS_LEAGUE)}`;
const time = (value: unknown) => typeof value==='string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
import {mapMarket} from "./selection.ts";
export {mapMarket} from "./selection.ts";
export function regionVerified(quote:Quote, now=Date.now(), audit:any=JSON.parse(readFileSync(new URL('../../config/region-audit.json',import.meta.url),'utf8'))):boolean {
  return regionalDecision(quote,now,audit).verified;
}
export function applyRegionalAudit(quote:Quote,now=Date.now(),audit:any=JSON.parse(readFileSync(new URL('../../config/region-audit.json',import.meta.url),'utf8'))):void {
  const decision=regionalDecision(quote,now,audit);
  Object.assign(quote,{regionVerified:decision.verified,regionVerificationMode:decision.mode,regionalCheckedAt:decision.checkedAt,priceForCalculation:decision.priceForCalculation});
}
export function parseMarketBoard(data:any,requestedAt:number,receivedAt:number):OddsBoard {
  const board=parseBoard(data,requestedAt,receivedAt);
  for (const match of board.matches) {
    const original=data.matches.find((row:any)=>row.id===match.id);
    const seen=new Set<string>(); const quotes:Quote[]=[];
    for (const raw of original.quotes) {
      if (!MAIN_GROUPS.includes(raw.group_id)) continue;
      if (raw.fixture_id!==match.id || typeof raw.sel_id!=='string' || !raw.sel_id || !Number.isFinite(raw.odds_dec) || raw.odds_dec<=1) throw new Error('Selección de mercado incompleta.');
      const id=JSON.stringify([raw.group_id,raw.market_id ?? '',raw.sel_id]);
      if (seen.has(id)) throw new Error('Selección duplicada.'); seen.add(id);
      const selection=mapMarket(raw,original);
      const group=original.group_status?.[raw.group_id];
      const quote:Quote={eventId:match.id,marketId:`${raw.group_id}:${raw.market_id??''}`,selectionId:raw.sel_id,
        bookmaker:'bet365',competition:'LaLiga',period:'full_time_regulation',line:selection?.line ?? null,price:raw.odds_dec,
        sourceUpdatedAt:time(raw.ts),sourceConfirmedAt:time(group?.polled_at),requestedAt,receivedAt,kickoffAt:match.kickoffAt,
        suspended:raw.suspended!==undefined && raw.suspended!==false,sourceStale:group?.stale===true,
        regionVerified:false,selection:selection??undefined,label:[raw.label,raw.side,raw.line].filter(Boolean).join(' · '),groupName:raw.group_name??raw.group_id,groupId:raw.group_id};
      if(raw.phase!==undefined && raw.phase!=='prematch')quote.validationError='La fase de origen no es previa al partido.';
      applyRegionalAudit(quote,receivedAt);
      quotes.push(quote);
    }
    match.quotes=quotes;
  }
  return board;
}
export async function fetchMarketBoard(request:typeof fetch=fetch) {
  const capture=await readPublicText(MAIN_ODDS_URL,{request,maxBytes:16000000});
  try {
  const data=JSON.parse(capture.raw);
  const board=parseMarketBoard(data,capture.requestedAt,capture.receivedAt);
  try {board.champions=parseChampions(data,capture.receivedAt,MAIN_GROUPS,capture.requestedAt);}
  catch(error){board.champions={competition:'Champions',receivedAt:capture.receivedAt,matches:[],error:error instanceof Error?error.message:'Champions no disponible.'};}
  const championsExtract={site:data.site,server_time:data.server_time,scope:CHAMPIONS_LEAGUE,upstreamSha256:createHash('sha256').update(capture.raw).digest('hex'),matches:data.matches.filter((match:any)=>match.league===CHAMPIONS_LEAGUE&&match.sport==='soccer')};
  const extract={site:data.site,server_time:data.server_time,scope:'LaLiga subset; normalized evidence retains original quote fields',upstreamSha256:createHash('sha256').update(capture.raw).digest('hex'),matches:data.matches.filter((match:any)=>match.league==='Spain La Liga' && match.sport==='soccer')};
  return {board,capture:{...capture,raw:JSON.stringify(extract)},championsCapture:{...capture,raw:JSON.stringify(championsExtract)}};
  } catch(error) {
    if(error instanceof Error)Object.assign(error,{capture});
    throw error;
  }
}
