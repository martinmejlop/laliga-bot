import {readFileSync} from 'node:fs';
import type {Quote} from './freshness.ts';
import {mapMarket} from './selection.ts';
import {regionalDecision} from './regional.ts';
// Los históricos y el modelo son propios; el presupuesto se asigna conjuntamente.
export const CHAMPIONS_LEAGUE='UEFA Champions League';
const stamp=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))?Date.parse(v):null;
export interface ChampionsQuote {
  quote:Quote;
  id:string; groupId:string; market:string; label:string; price:number;
  confirmedAt:number|null; changedAt:number|null; suspended:boolean; stale:boolean; validTimes:boolean;
}
export interface ChampionsBoard {
  competition:'Champions'; receivedAt:number; captureId?:string; error?:string;
  matches:{id:string;home:string;away:string;kickoffAt:number;quotes:ChampionsQuote[]}[];
}
export function parseChampions(data:any,receivedAt:number,groups:readonly string[],requestedAt=receivedAt):ChampionsBoard {
  const result:ChampionsBoard={competition:'Champions',receivedAt,matches:[]};
  if(data?.site!=='com'||!Array.isArray(data.matches)||data.partial===true||data.truncated===true||data.complete===false||data.dropped!==undefined&&data.dropped!==0)throw Error('Catálogo de Champions incompleto.');
  const seen=new Set<string>();
  for(const m of data.matches){
    // Excluye AFC, femenina, Youth League, clasificatorios con otro nombre y e-soccer.
    if(m.league!==CHAMPIONS_LEAGUE||m.sport!=='soccer'||m.in_play!==false)continue;
    const kickoffAt=stamp(m.kickoff_utc);
    if(kickoffAt===null||kickoffAt<=receivedAt)continue;
    if(typeof m.id!=='string'||!m.id||seen.has(m.id)||typeof m.home!=='string'||!m.home||typeof m.away!=='string'||!m.away||!Array.isArray(m.quotes))throw Error('Identidad de Champions ambigua.');
    seen.add(m.id);const quotes:ChampionsQuote[]=[],ids=new Set<string>();
    for(const q of m.quotes){
      if(!groups.includes(q.group_id))continue;
      const id=JSON.stringify([q.group_id,q.market_id??'',q.sel_id]);
      if(q.fixture_id!==m.id||typeof q.sel_id!=='string'||!q.sel_id||ids.has(id)||!Number.isFinite(q.odds_dec)||q.odds_dec<=1)throw Error('Selección de Champions inválida.');
      ids.add(id);const group=m.group_status?.[q.group_id],confirmedAt=stamp(group?.polled_at),changedAt=stamp(q.ts);
      const selection=mapMarket(q,m),quote:Quote={eventId:m.id,marketId:`${q.group_id}:${q.market_id??''}`,selectionId:q.sel_id,bookmaker:'bet365',competition:'Champions',period:'full_time_regulation',line:selection?.line??null,price:q.odds_dec,sourceUpdatedAt:changedAt,sourceConfirmedAt:confirmedAt,receivedAt,requestedAt,kickoffAt,regionVerified:false,suspended:q.suspended!==undefined&&q.suspended!==false||q.phase!==undefined&&q.phase!=='prematch',sourceStale:group?.stale===true,selection:selection??undefined,label:[q.label,q.side,q.line??q.handicap].filter(v=>v!==undefined&&v!==null&&v!=='').join(' · '),groupName:q.group_name??q.group_id,groupId:q.group_id};
      if(confirmedAt===null||changedAt===null||changedAt>confirmedAt||confirmedAt>receivedAt)quote.validationError='Marcas de origen de Champions incoherentes o ausentes.';
      const regional=regionalDecision(quote,receivedAt,JSON.parse(readFileSync(new URL('../../config/region-audit.json',import.meta.url),'utf8')));
      Object.assign(quote,{regionVerified:regional.verified,regionVerificationMode:regional.mode,regionalCheckedAt:regional.checkedAt,priceForCalculation:regional.priceForCalculation});
      quotes.push({quote,id,groupId:q.group_id,market:String(q.group_name??q.group_id),label:[q.label,q.side,q.line??q.handicap].filter(v=>v!==undefined&&v!==null&&v!=='').join(' · ')||String(q.n2??q.sel_id),price:q.odds_dec,
        confirmedAt,changedAt,suspended:q.suspended!==undefined&&q.suspended!==false||q.phase!==undefined&&q.phase!=='prematch',stale:group?.stale===true,
        validTimes:confirmedAt!==null&&changedAt!==null&&changedAt>0&&changedAt<=confirmedAt&&confirmedAt<=receivedAt});
    }
    result.matches.push({id:m.id,home:m.home,away:m.away,kickoffAt,quotes});
  }
  result.matches.sort((a,b)=>a.kickoffAt-b.kickoffAt);return result;
}
export function championsState(board:ChampionsBoard|null|undefined,now=Date.now(),context?:{snapshot:any;model:any;evaluation:any;report:any}) {
  const trained=context?.model?.status==='trained',evaluated=context?.evaluation?.status==='evaluated',candidates=context?.report?.candidates.filter((c:any)=>c.competition==='Champions')??[],active=candidates.filter((c:any)=>c.actionable);
  return {competition:'Champions',mode:trained&&evaluated?'analysis':'observation',stakeEur:active.reduce((s:number,c:any)=>s+c.stakeEur,0),opportunities:active.length,analysedMatches:context?.report?.fixtures.filter((f:any)=>f.competition==='Champions').length??0,trainingMatches:context?.model?.trainingMatches??0,historyMatches:context?.snapshot?.matches.filter((m:any)=>m.status==='finished').length??0,evaluation:context?.evaluation??null,news:context?.snapshot?.news??[],modelVersion:context?.model?.version??null,
    receivedAt:board?.receivedAt??null,captureId:board?.captureId??null,error:board?.error??context?.snapshot?.errors?.[0]??null,
    pending:[...(!trained?['Históricos y modelo propios de Champions']:[]),...(!evaluated?['Evaluación por fechas y por mercado']:[]),...(!board?.matches.some(m=>m.quotes.some(q=>q.quote?.regionVerified))?['Contraste de cuotas con Bet365 España']:[])],
    matches:board?.matches.filter(m=>m.kickoffAt>now).map(m=>({...m,prediction:context?.report?.fixtures.find((f:any)=>f.id===m.id&&f.competition==='Champions')?.prediction??null,quotes:m.quotes.map(q=>{const quote=q.quote;return {...q,price:quote?.price??q.price,status:q.suspended?'suspended':!q.validTimes||quote?.validationError?'invalid-time':q.stale||now<(quote?.receivedAt??board.receivedAt)||now-(quote?.receivedAt??board.receivedAt)>30000||q.confirmedAt===null||now-(quote?.sourceConfirmedAt??q.confirmedAt)>60000?'expired':'observed'};})}))??[]};
}
