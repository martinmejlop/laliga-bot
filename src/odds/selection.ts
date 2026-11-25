import type {MarketSelection} from "../domain.ts";
const key = (s:unknown) => typeof s==='string'?s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim():'';
function numberLine(value:unknown):number|null {
  if (typeof value!=='string' || !/^[+-]?\d+(?:\.\d+)?(?:,[+-]?\d+(?:\.\d+)?)?$/.test(value.trim())) return null;
  const values=value.split(',').map(Number);
  const result=values.reduce((a,b)=>a+b,0)/values.length;
  return values.length<=2 && (values.length===1 || Math.abs(values[0]-values[1])===0.5) && Number.isInteger(result*4) && Math.abs(result)<=20 ? result:null;
}
export function mapMarket(raw:any,match:any):MarketSelection|null {
  if (raw.period!==undefined && !['','0','full_time','full_time_regulation'].includes(String(raw.period))) return null;
  const label=key(raw.label), side=key(raw.side), home=key(match.home), away=key(match.away);
  if (raw.group_id==='40') {
    const a=({ '1':'home','x':'draw','2':'away' } as const)[key(raw.n2)];
    const b=label===home?'home':label===away?'away':['draw','empate'].includes(label)?'draw':null;
    if (a && b && a!==b) return null;
    return a||b?{kind:'1x2',side:(a||b)!,line:null}:null;
  }
  if (raw.group_id==='10114') {
    const value=({'1x':'home_draw','12':'home_away','x2':'draw_away'} as const)[key(raw.n2)];
    return value?{kind:'double_chance',side:value,line:null}:null;
  }
  if (raw.group_id==='10150') return ['yes','no'].includes(label)?{kind:'btts',side:label as 'yes'|'no',line:null}:null;
  if (raw.group_id==='10544') return label===home||label===away?{kind:'dnb',side:label===home?'home':'away',line:null}:null;
  const line=numberLine(raw.line ?? raw.handicap);
  if (['981','10143'].includes(raw.group_id) && line!==null && line>=0 && ['over','under'].includes(side)) return {kind:'total_goals',side:side as 'over'|'under',line};
  if (['178002','938'].includes(raw.group_id) && line!==null && [home,away].includes(side)) return {kind:'asian_handicap',side:side===home?'home':'away',line};
  // Un hándicap europeo exige confirmar el signo común de sus tres selecciones. Se conserva sin proponer si es ambiguo.
  if (raw.group_id==='171' && line!==null && Number.isInteger(line) && side===home) return {kind:'european_handicap',side:'home',line};
  return null;
}
