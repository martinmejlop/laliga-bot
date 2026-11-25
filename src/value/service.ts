import type { MarketSelection } from '../domain.ts';
import type { Prediction } from '../model/service.ts';

export interface SettlementProbabilities { win:number; halfWin:number; push:number; halfLoss:number; loss:number; }
export interface SelectionValue {
  valid:boolean; reason?:string; probabilities:SettlementProbabilities;
  expectedValue:number; breakEvenOdds:number|null; probabilityWin:number; kellyFraction:number;
}
type Outcome=keyof SettlementProbabilities;
const empty=():SettlementProbabilities=>({win:0,halfWin:0,push:0,halfLoss:0,loss:0});
const quarter=(line:number)=>Number.isFinite(line)&&Math.abs(line*4-Math.round(line*4))<1e-8;
const sign=(x:number)=>Math.abs(x)<1e-9?0:x>0?1:-1;
function splitLine(line:number):number[]{return Math.abs(line*2-Math.round(line*2))<1e-8?[line]:[Math.floor(line*2)/2,Math.ceil(line*2)/2];}
function handicapOutcome(margin:number,line:number):Outcome {
  const signs=splitLine(line).map(component=>sign(margin+component));
  const average=signs.reduce((a,b)=>a+b,0)/signs.length;
  return average===1?'win':average===.5?'halfWin':average===0?'push':average===-.5?'halfLoss':'loss';
}
export function settleScore(selection:MarketSelection,homeGoals:number,awayGoals:number):Outcome {
  if(!Number.isSafeInteger(homeGoals)||!Number.isSafeInteger(awayGoals)||homeGoals<0||awayGoals<0)throw new Error('Marcador de liquidación inválido.');
  const diff=homeGoals-awayGoals;
  switch(selection.kind){
    case '1x2': {
      if(selection.line!==null||!['home','draw','away'].includes(selection.side))throw new Error('Selección 1X2 inválida.');
      return (selection.side==='home'?diff>0:selection.side==='away'?diff<0:diff===0)?'win':'loss';
    }
    case 'double_chance': {
      if(selection.line!==null||!['home_draw','home_away','draw_away'].includes(selection.side))throw new Error('Doble oportunidad inválida.');
      return (selection.side==='home_draw'?diff>=0:selection.side==='draw_away'?diff<=0:diff!==0)?'win':'loss';
    }
    case 'dnb': {
      if((selection.line!==null&&selection.line!==0)||!['home','away'].includes(selection.side))throw new Error('Empate no válido inválido.');
      return handicapOutcome(selection.side==='home'?diff:-diff,0);
    }
    case 'asian_handicap': {
      if(selection.line===null||!quarter(selection.line)||Math.abs(selection.line)>12||!['home','away'].includes(selection.side))throw new Error('Hándicap asiático inválido.');
      // La línea se expresa desde el equipo seleccionado, también al elegir visitante.
      return handicapOutcome(selection.side==='home'?diff:-diff,selection.line);
    }
    case 'european_handicap': {
      if(selection.line===null||!Number.isSafeInteger(selection.line)||Math.abs(selection.line)>12||!['home','draw','away'].includes(selection.side))throw new Error('Hándicap europeo inválido.');
      // La línea europea se aplica al local; es un mercado de tres resultados sin devolución.
      const margin=diff+selection.line;
      return (selection.side==='home'?margin>0:selection.side==='away'?margin<0:margin===0)?'win':'loss';
    }
    case 'total_goals': case 'team_goals': {
      if(selection.line===null||!quarter(selection.line)||selection.line<0||selection.line>20||!['over','under'].includes(selection.side)||
        (selection.kind==='team_goals'&&!['home','away'].includes(selection.team??'')))throw new Error('Línea de goles inválida.');
      const goals=selection.kind==='total_goals'?homeGoals+awayGoals:selection.team==='home'?homeGoals:awayGoals;
      return selection.side==='over'?handicapOutcome(goals,-selection.line):handicapOutcome(-goals,selection.line);
    }
    case 'btts': {
      if(selection.line!==null||!['yes','no'].includes(selection.side))throw new Error('Ambos marcan inválido.');
      const yes=homeGoals>0&&awayGoals>0;
      return (selection.side==='yes'?yes:!yes)?'win':'loss';
    }
    default: throw new Error('Familia de mercado no implementada.');
  }
}
function returns(price:number):Record<Outcome,number>{return {win:price-1,halfWin:(price-1)/2,push:0,halfLoss:-.5,loss:-1};}
function kelly(p:SettlementProbabilities,price:number):number {
  const r=returns(price),keys=Object.keys(p) as Outcome[];
  const derivative=(fraction:number)=>keys.reduce((sum,key)=>sum+p[key]*r[key]/(1+fraction*r[key]),0);
  if(derivative(0)<=0)return 0;
  let low=0,high=.999999;
  if(derivative(high)>=0)return high;
  for(let i=0;i<60;i++){const middle=(low+high)/2;if(derivative(middle)>0)low=middle;else high=middle;}
  return (low+high)/2;
}
export function evaluateSelection(prediction:Pick<Prediction,'matrix'>,selection:MarketSelection,price:number):SelectionValue {
  const invalid=(reason:string):SelectionValue=>({valid:false,reason,probabilities:empty(),expectedValue:0,breakEvenOdds:null,probabilityWin:0,kellyFraction:0});
  if(!Number.isFinite(price)||price<=1||price>10000)return invalid('Precio decimal inválido.');
  if(!Array.isArray(prediction.matrix)||!prediction.matrix.length)return invalid('Distribución de marcadores ausente.');
  const p=empty();let mass=0;
  try{
    prediction.matrix.forEach((row,h)=>{
      if(!Array.isArray(row)||row.length!==prediction.matrix.length)throw new Error('Distribución no cuadrada.');
      row.forEach((prob,a)=>{
        if(!Number.isFinite(prob)||prob<0)throw new Error('Probabilidad inválida.');
        mass+=prob;p[settleScore(selection,h,a)]+=prob;
      });
    });
    if(Math.abs(mass-1)>1e-7)throw new Error('Distribución sin normalizar.');
  }catch(error){return invalid(error instanceof Error?error.message:'Selección inválida.');}
  const gain=p.win+.5*p.halfWin,loss=p.loss+.5*p.halfLoss;
  return {valid:true,probabilities:p,expectedValue:gain*(price-1)-loss,breakEvenOdds:gain>0?1+loss/gain:null,
    probabilityWin:p.win+p.halfWin,kellyFraction:kelly(p,price)};
}

export interface StakeCandidate { id:string; fixtureId:string; teams?:string[]; price:number; value:SelectionValue; actionable:boolean; reason?:string; }
export interface ExistingPosition { fixtureId:string; stakeEur:number; teams?:string[]; }
export interface BankrollState { balanceEur:number; committedEur:number; confirmedAt:number|null; positions?:ExistingPosition[]; }
export interface StakePolicy {
  minStakeEur:number|null; maxBetFraction:number; maxFixtureFraction:number; maxTeamFraction:number;
  maxTotalFraction:number; kellyFraction:number; edgeDiscount:number; minExpectedValue:number; maxBalanceAgeMs:number;
}
export const DEFAULT_STAKE_POLICY:StakePolicy={minStakeEur:null,maxBetFraction:.01,maxFixtureFraction:.02,maxTeamFraction:.03,maxTotalFraction:.05,
  kellyFraction:.25,edgeDiscount:.5,minExpectedValue:.03,maxBalanceAgeMs:24*3600000};
export function configuredStakeLimits(maxBetFraction?:number):Partial<StakePolicy> {
  if(maxBetFraction===undefined)return {};
  if(!Number.isFinite(maxBetFraction)||maxBetFraction<=0||maxBetFraction>1)throw new Error('Máximo por apuesta inválido.');
  return {maxBetFraction,maxFixtureFraction:Math.max(DEFAULT_STAKE_POLICY.maxFixtureFraction,maxBetFraction),
    maxTeamFraction:Math.max(DEFAULT_STAKE_POLICY.maxTeamFraction,maxBetFraction),maxTotalFraction:Math.max(DEFAULT_STAKE_POLICY.maxTotalFraction,maxBetFraction)};
}
export interface StakeAllocation { id:string; fixtureId:string; stakeEur:number; stakePct:number; reason:string; }
export interface StakeAllocationResult { allocations:StakeAllocation[];totalStakeEur:number;freeEur:number;policy:StakePolicy; }
const cents=(value:number)=>Math.round(value*100);
function money(value:number){return Number.isFinite(value)&&value>=0&&Math.abs(value*100-Math.round(value*100))<1e-6;}
export function allocateStakes(candidates:StakeCandidate[],bankroll:BankrollState,overrides:Partial<StakePolicy>={},now=Date.now()):StakeAllocationResult {
  const policy={...DEFAULT_STAKE_POLICY,...overrides};
  const zero=(reason:string):StakeAllocationResult=>({allocations:candidates.map(c=>({id:c.id,fixtureId:c.fixtureId,stakeEur:0,stakePct:0,reason})),totalStakeEur:0,
    freeEur:money(bankroll.balanceEur)&&money(bankroll.committedEur)?Math.max(0,cents(bankroll.balanceEur)-cents(bankroll.committedEur))/100:0,policy});
  if(!money(bankroll.balanceEur)||!money(bankroll.committedEur)||bankroll.committedEur>bankroll.balanceEur||!Number.isFinite(now))return zero('Saldo o exposición incoherentes.');
  if(!Number.isFinite(bankroll.confirmedAt)||bankroll.confirmedAt!>now||now-bankroll.confirmedAt!>policy.maxBalanceAgeMs)return zero('Confirma el saldo actual antes de calcular importes.');
  if(policy.minStakeEur===null)return zero('Falta indicar el importe mínimo que admite tu cuenta de Bet365.');
  if(!money(policy.minStakeEur)||policy.minStakeEur<=0||!['maxBetFraction','maxFixtureFraction','maxTeamFraction','maxTotalFraction','kellyFraction','edgeDiscount'].every(k=>typeof policy[k as keyof StakePolicy]==='number'&&Number(policy[k as keyof StakePolicy])>0&&Number(policy[k as keyof StakePolicy])<=1)||!Number.isFinite(policy.minExpectedValue)||policy.minExpectedValue<0||!Number.isFinite(policy.maxBalanceAgeMs)||policy.maxBalanceAgeMs<=0)throw new Error('Política de importes inválida.');
  const total=cents(bankroll.balanceEur),committed=cents(bankroll.committedEur),positions=bankroll.positions??[];
  if(positions.some(p=>!p.fixtureId||!money(p.stakeEur))||positions.reduce((sum,p)=>sum+cents(p.stakeEur),0)>committed)return zero('La exposición detallada no coincide con el saldo comprometido.');
  if(new Set(candidates.map(c=>c.id)).size!==candidates.length)return zero('Hay selecciones duplicadas en el informe.');
  const usedFixtures=new Set(positions.map(p=>p.fixtureId));const teamExposure=new Map<string,number>();
  positions.forEach(p=>new Set(p.teams??[]).forEach(team=>teamExposure.set(team,(teamExposure.get(team)??0)+cents(p.stakeEur))));
  let budget=Math.max(0,Math.min(total-committed,Math.floor(total*policy.maxTotalFraction)-committed)),spent=0;
  const results=new Map<string,StakeAllocation>();
  const ranked=[...candidates].sort((a,b)=>b.value.expectedValue-a.value.expectedValue||a.id.localeCompare(b.id));
  for(const candidate of ranked){
    const reject=(reason:string)=>results.set(candidate.id,{id:candidate.id,fixtureId:candidate.fixtureId,stakeEur:0,stakePct:0,reason});
    if(!candidate.actionable){reject(candidate.reason??'Precio o modelo sin condiciones verificadas.');continue;}
    if(!candidate.value.valid||!Number.isFinite(candidate.value.expectedValue)||!Number.isFinite(candidate.value.kellyFraction)||candidate.value.kellyFraction<0||candidate.value.kellyFraction>1||!Number.isFinite(candidate.price)||candidate.price<=1||!candidate.fixtureId){reject('Cálculo o identidad de mercado inválidos.');continue;}
    if(candidate.value.expectedValue<policy.minExpectedValue||candidate.value.kellyFraction<=0){reject('Valor esperado inferior al umbral experimental.');continue;}
    if(usedFixtures.has(candidate.fixtureId)){reject('Ya hay una apuesta o propuesta para este partido; se evita acumular mercados correlacionados.');continue;}
    const teams=[...new Set(candidate.teams??[])];
    const teamLimit=teams.length?Math.min(...teams.map(team=>Math.floor(total*policy.maxTeamFraction)-(teamExposure.get(team)??0))):Math.floor(total*policy.maxTeamFraction);
    const stake=Math.max(0,Math.min(Math.floor(total*candidate.value.kellyFraction*policy.kellyFraction*policy.edgeDiscount),Math.floor(total*policy.maxBetFraction),Math.floor(total*policy.maxFixtureFraction),teamLimit,budget));
    if(stake<cents(policy.minStakeEur)){reject('El importe prudente queda por debajo del mínimo o de los límites de exposición.');continue;}
    budget-=stake;spent+=stake;usedFixtures.add(candidate.fixtureId);teams.forEach(team=>teamExposure.set(team,(teamExposure.get(team)??0)+stake));
    results.set(candidate.id,{id:candidate.id,fixtureId:candidate.fixtureId,stakeEur:stake/100,stakePct:total?stake/total*100:0,
      reason:'Kelly fraccionado, ventaja reducida y límites conjuntos; importe experimental sobre el saldo confirmado.'});
  }
  return {allocations:candidates.map(c=>results.get(c.id)!),totalStakeEur:spent/100,freeEur:(total-committed-spent)/100,policy};
}
