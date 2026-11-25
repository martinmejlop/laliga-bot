import { createHash } from 'node:crypto';
import type { HistoricalMatch, MarketKind, MarketSelection } from '../domain.ts';
import { evaluateSelection,settleScore } from '../value/service.ts';

const DAY=86400000;
const clip=(x:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,x));
export interface ModelOptions { halfLifeDays:number; ridge:number; iterations:number; trainingWindowDays:number; availability:'observed'|'reconstructed'; }
const DEFAULTS:ModelOptions={halfLifeDays:365,ridge:8,iterations:220,trainingWindowDays:1095,availability:'observed'};
interface TeamFit { attack:number; defence:number; matches:number; weightedMatches:number; lastPlayedAt:number|null; formPoints:number|null; goalsFor:number|null; goalsAgainst:number|null; opponentAdjustedForm:number|null; }
export interface Model {
  version:string; status:'trained'|'insufficient'; cutoff:number; trainingMatches:number; lastResultAt:number|null;
  league:{awayGoals:number;homeAdvantage:number}; rho:number; options:ModelOptions;
  teams:Record<string,TeamFit>; trainingCaptureIds:string[]; warnings:string[];
}
export interface TeamFeatures {
  matches:number; weightedMatches:number; attackStrength:number; defensiveVulnerability:number;
  formPointsPerGame:number|null; goalsForPerGame:number|null; goalsAgainstPerGame:number|null;
  opponentAdjustedForm:number|null; restDays:number|null; sparseHistory:boolean;
  injuries:null; xG:null; lineup:null;
}
export interface Prediction {
  home:string; away:string; kickoffAt:number; modelVersion:string; modelCutoff:number;
  expectedGoals:{home:number;away:number}; matrix:number[][];
  probabilities:{home:number;draw:number;away:number}; features:{home:TeamFeatures;away:TeamFeatures};
  rho:number; omittedTailMass:number; experimental:true; ready:boolean; warnings:string[];
}
export interface Metrics {
  sampleSize:number; logLoss:number; brier:number; accuracy:number;
  calibration:{lower:number;upper:number;count:number;meanPrediction:number;actualFrequency:number}[];
  expectedCalibrationError:number;
}
export interface Evaluation {
  version:string; status:'evaluated'|'insufficient'; sampleSize:number;
  validation:Metrics|null; test:Metrics|null; benchmark:{validation:Metrics|null;test:Metrics|null};
  selectedOptions:Partial<ModelOptions>; chronology:{trainEnd:string|null;validationStart:string|null;validationEnd:string|null;testStart:string|null;testEnd:string|null;trainingCount:number;validationCount:number;testCount:number};
  limitations:string[]; roi:null; modelGate:{passed:boolean;reasons:string[]}; marketGates:Partial<Record<MarketKind,FamilyGate>>;
}
export interface MarketGateSelection extends MarketSelection {
  passed:boolean;reasons:string[];metrics:Metrics|null;benchmark:Metrics|null;
  settlement:{predictedMean:number|null;observedMean:number|null};
  brierImprovement:{mean:number;standardError:number;lowerBound:number}|null;
}
export interface FamilyGate {passed:boolean;reasons:string[];testedLines:(number|null)[];sampleSize:number;selections:MarketGateSelection[];}
export function marketGateFor(evaluation:Evaluation,selection:MarketSelection):MarketGateSelection|null {
  return evaluation.marketGates[selection.kind]?.selections.find(item=>item.side===selection.side&&item.line===selection.line&&(item.team??null)===(selection.team??null))??null;
}

/** Unknown kickoff times only become eligible on the following calendar day. */
export function resultKnownAfter(match:HistoricalMatch):number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(match.date)) return Infinity;
  const day=Date.parse(`${match.date}T00:00:00Z`);
  if(!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==match.date)return Infinity;
  return match.kickoffAt===null?day+DAY:match.kickoffAt+2*3600000;
}
function finished(match:HistoricalMatch):boolean {
  return match.status==='finished'&&Number.isSafeInteger(match.homeGoals)&&Number.isSafeInteger(match.awayGoals)&&match.homeGoals!>=0&&match.awayGoals!>=0&&match.home!==match.away;
}
function eligible(matches:HistoricalMatch[],cutoff:number,options:ModelOptions):HistoricalMatch[] {
  const result:HistoricalMatch[]=[];const seen=new Map<string,string>();
  for(const match of matches){
    const at=resultKnownAfter(match);
    if(!finished(match)||match.neutral===true||at>=cutoff||at<cutoff-options.trainingWindowDays*DAY)continue;
    if(options.availability==='observed'&&(!Number.isFinite(match.availableAt)||match.availableAt>cutoff))continue;
    const key=JSON.stringify(match.competition==='Champions'?['Champions',match.season,match.date,match.home,match.away]:[match.season,match.home,match.away]);
    const score=`${match.homeGoals}:${match.awayGoals}`;
    if(seen.has(key)){if(seen.get(key)!==score)throw new Error('Resultados contradictorios para el mismo partido; revisar datos.');continue;}
    seen.set(key,score);result.push(match);
  }
  return result.sort((a,b)=>resultKnownAfter(a)-resultKnownAfter(b)||a.id.localeCompare(b.id));
}
function optionsOf(input:Partial<ModelOptions>={}):ModelOptions {
  const result={...DEFAULTS,...input};
  if(!Number.isFinite(result.halfLifeDays)||result.halfLifeDays<30||!Number.isFinite(result.ridge)||result.ridge<1||!Number.isSafeInteger(result.iterations)||result.iterations<20||result.iterations>1000||!Number.isFinite(result.trainingWindowDays)||result.trainingWindowDays<180||!['observed','reconstructed'].includes(result.availability))throw new Error('Opciones del modelo inválidas.');
  return result;
}
function lambda(base:number,homeAdv:number,a:number,d:number,isHome:boolean){return Math.exp(clip(base+(isHome?homeAdv:0)+a+d,Math.log(.12),Math.log(5)));}
function tau(h:number,a:number,l:number,m:number,r:number):number {
  if(h===0&&a===0)return 1-l*m*r;
  if(h===0&&a===1)return 1+l*r;
  if(h===1&&a===0)return 1+m*r;
  if(h===1&&a===1)return 1-r;
  return 1;
}
export function fitModel(matches:HistoricalMatch[],cutoff:number,input:Partial<ModelOptions>={}):Model {
  if(!Number.isFinite(cutoff)||cutoff<=0)throw new Error('Fecha límite inválida.');
  const options=optionsOf(input),rows=eligible(matches,cutoff,options);
  const names=[...new Set(rows.flatMap(r=>[r.home,r.away]))].sort();
  const index=new Map(names.map((name,i)=>[name,i]));
  const attack=names.map(()=>0),defence=names.map(()=>0),exposure=names.map(()=>0);
  const weights=rows.map(r=>Math.exp(-Math.LN2*(cutoff-resultKnownAfter(r))/(DAY*options.halfLifeDays)));
  const totalWeight=weights.reduce((a,b)=>a+b,0);
  let weightedHome=0,weightedAway=0;
  rows.forEach((r,i)=>{weightedHome+=weights[i]*r.homeGoals!;weightedAway+=weights[i]*r.awayGoals!;exposure[index.get(r.home)!]+=weights[i];exposure[index.get(r.away)!]+=weights[i];});
  const awayMean=(weightedAway+1.1*options.ridge)/(totalWeight+options.ridge);
  const homeMean=(weightedHome+1.45*options.ridge)/(totalWeight+options.ridge);
  let base=Math.log(clip(awayMean,.4,2.5)),adv=Math.log(clip(homeMean/awayMean,.7,1.8));
  for(let iteration=0;iteration<options.iterations&&rows.length;iteration++){
    const ga=names.map((_,i)=>-options.ridge*attack[i]),gd=names.map((_,i)=>-options.ridge*defence[i]);
    let gb=0,gh=0;
    rows.forEach((r,k)=>{
      const hi=index.get(r.home)!,ai=index.get(r.away)!;
      const eh=lambda(base,adv,attack[hi],defence[ai],true),ea=lambda(base,adv,attack[ai],defence[hi],false);
      const rh=weights[k]*(r.homeGoals!-eh),ra=weights[k]*(r.awayGoals!-ea);
      ga[hi]+=rh;gd[ai]+=rh;ga[ai]+=ra;gd[hi]+=ra;gb+=rh+ra;gh+=rh;
    });
    const step=.16/(1+iteration/150);
    names.forEach((_,i)=>{attack[i]=clip(attack[i]+step*ga[i]/(exposure[i]+options.ridge),-.9,.9);defence[i]=clip(defence[i]+step*gd[i]/(exposure[i]+options.ridge),-.9,.9);});
    base=clip(base+step*gb/(2*totalWeight+options.ridge),Math.log(.4),Math.log(2.5));
    adv=clip(adv+step*gh/(totalWeight+options.ridge),Math.log(.7),Math.log(1.8));
    // Centre team effects without changing the fitted log intensities.
    const ma=attack.reduce((a,b)=>a+b,0)/names.length,md=defence.reduce((a,b)=>a+b,0)/names.length;
    names.forEach((_,i)=>{attack[i]-=ma;defence[i]-=md;});base+=ma+md;
  }
  let bestRho=0,best=-Infinity;
  for(let step=-18;step<=12;step++){
    const rho=step/100;let ll=-5*rho*rho;let valid=true;
    rows.forEach((r,k)=>{
      if(!valid)return;
      const hi=index.get(r.home)!,ai=index.get(r.away)!;
      const l=lambda(base,adv,attack[hi],defence[ai],true),m=lambda(base,adv,attack[ai],defence[hi],false);
      if(Math.min(tau(0,0,l,m,rho),tau(0,1,l,m,rho),tau(1,0,l,m,rho),tau(1,1,l,m,rho))<=0){valid=false;return;}
      ll+=weights[k]*Math.log(tau(r.homeGoals!,r.awayGoals!,l,m,rho));
    });
    if(valid&&ll>best){best=ll;bestRho=rho;}
  }
  const teams:Record<string,TeamFit>={};
  names.forEach((name,i)=>{
    const recent=rows.filter(r=>r.home===name||r.away===name).slice(-5);
    let points=0,gf=0,against=0,residual=0;
    recent.forEach(r=>{
      const home=r.home===name,goals=home?r.homeGoals!:r.awayGoals!,conceded=home?r.awayGoals!:r.homeGoals!;
      const hi=index.get(r.home)!,ai=index.get(r.away)!;
      const eh=lambda(base,adv,attack[hi],defence[ai],true),ea=lambda(base,adv,attack[ai],defence[hi],false);
      gf+=goals;against+=conceded;points+=goals>conceded?3:goals===conceded?1:0;
      residual+=(goals-conceded)-(home?eh-ea:ea-eh);
    });
    teams[name]={attack:attack[i],defence:defence[i],matches:rows.filter(r=>r.home===name||r.away===name).length,weightedMatches:exposure[i],lastPlayedAt:recent.length?resultKnownAfter(recent.at(-1)!):null,
      formPoints:recent.length?points/recent.length:null,goalsFor:recent.length?gf/recent.length:null,goalsAgainst:recent.length?against/recent.length:null,opponentAdjustedForm:recent.length?residual/recent.length:null};
  });
  const fingerprint=createHash('sha256').update(JSON.stringify({rows:rows.map(r=>[r.id,r.homeGoals,r.awayGoals]),cutoff,options})).digest('hex').slice(0,16);
  const warnings=['Modelo experimental de goles; sin lesiones, alineaciones ni xG verificados. Las noticias no alteran sus probabilidades.'];
  if(rows.length<60)warnings.push('Histórico insuficiente: menos de 60 partidos de entrenamiento.');
  if(options.availability==='reconstructed')warnings.push('Reconstrucción por fecha de resultados: no acredita disponibilidad histórica del archivo ni de sus correcciones.');
  return {version:`dc-poisson-v1-${fingerprint}`,status:rows.length>=60?'trained':'insufficient',cutoff,trainingMatches:rows.length,lastResultAt:rows.length?resultKnownAfter(rows.at(-1)!):null,
    league:{awayGoals:Math.exp(base),homeAdvantage:Math.exp(adv)},rho:bestRho,options,teams,trainingCaptureIds:[...new Set(rows.map(r=>r.captureId).filter(Boolean))],warnings};
}

function poisson(mean:number,max:number):number[]{const p=[Math.exp(-mean)];for(let i=1;i<=max;i++)p.push(p[i-1]*mean/i);return p;}
export function scoreDistribution(homeGoals:number,awayGoals:number,rho=0,maxGoals=16):{matrix:number[][];rho:number;omittedTailMass:number} {
  if(![homeGoals,awayGoals].every(x=>Number.isFinite(x)&&x>0&&x<=5)||!Number.isFinite(rho)||!Number.isSafeInteger(maxGoals)||maxGoals<5||maxGoals>40)throw new Error('Parámetros de distribución inválidos.');
  const safeRho=clip(rho,-.95/Math.max(homeGoals,awayGoals),.95/(homeGoals*awayGoals));
  const h=poisson(homeGoals,maxGoals),a=poisson(awayGoals,maxGoals);
  const matrix=h.map((p,i)=>a.map((q,j)=>p*q*tau(i,j,homeGoals,awayGoals,safeRho)));
  const mass=matrix.flat().reduce((x,y)=>x+y,0);
  matrix.forEach(row=>row.forEach((_,j)=>{row[j]/=mass;}));
  return {matrix,rho:safeRho,omittedTailMass:Math.max(0,1-mass)};
}
function features(team:TeamFit|undefined,at:number):TeamFeatures {
  return {matches:team?.matches??0,weightedMatches:team?.weightedMatches??0,attackStrength:Math.exp(team?.attack??0),defensiveVulnerability:Math.exp(team?.defence??0),
    formPointsPerGame:team?.formPoints??null,goalsForPerGame:team?.goalsFor??null,goalsAgainstPerGame:team?.goalsAgainst??null,opponentAdjustedForm:team?.opponentAdjustedForm??null,
    restDays:team?.lastPlayedAt?Math.max(0,(at-team.lastPlayedAt)/DAY):null,sparseHistory:!team||team.weightedMatches<8,injuries:null,xG:null,lineup:null};
}
export function predictMatch(model:Model,home:string,away:string,kickoffAt:number):Prediction {
  if(!home||!away||home===away||!Number.isFinite(kickoffAt)||kickoffAt<=model.cutoff)throw new Error('El pronóstico necesita un partido posterior al límite del modelo.');
  const h=model.teams[home],a=model.teams[away];
  const meanH=lambda(Math.log(model.league.awayGoals),Math.log(model.league.homeAdvantage),h?.attack??0,a?.defence??0,true);
  const meanA=lambda(Math.log(model.league.awayGoals),Math.log(model.league.homeAdvantage),a?.attack??0,h?.defence??0,false);
  const dist=scoreDistribution(meanH,meanA,model.rho),probabilities={home:0,draw:0,away:0};
  dist.matrix.forEach((row,i)=>row.forEach((p,j)=>{probabilities[i>j?'home':i===j?'draw':'away']+=p;}));
  const f={home:features(h,kickoffAt),away:features(a,kickoffAt)};
  const warnings=[...model.warnings];
  if(f.home.sparseHistory||f.away.sparseHistory)warnings.push('Algún equipo tiene pocas observaciones efectivas; su fuerza se aproxima a la media de la liga.');
  const stale=model.lastResultAt===null||(model.cutoff-model.lastResultAt)>45*DAY;
  if(stale)warnings.push('El último resultado del entrenamiento tiene más de 45 días o no existe.');
  if(dist.rho!==model.rho)warnings.push('Corrección de marcadores bajos acotada para conservar probabilidades positivas.');
  return {home,away,kickoffAt,modelVersion:model.version,modelCutoff:model.cutoff,expectedGoals:{home:meanH,away:meanA},matrix:dist.matrix,probabilities,features:f,rho:dist.rho,omittedTailMass:dist.omittedTailMass,
    experimental:true,ready:model.status==='trained'&&!f.home.sparseHistory&&!f.away.sparseHistory&&!stale,warnings};
}

interface Forecast { p:number[]; result:number; }
function metrics(rows:Forecast[]):Metrics|null {
  if(!rows.length)return null;
  let loss=0,brier=0,correct=0;
  const bins=Array.from({length:10},(_,i)=>({lower:i/10,upper:(i+1)/10,count:0,meanPrediction:0,actualFrequency:0}));
  rows.forEach(({p,result})=>{
    loss-=Math.log(Math.max(1e-12,p[result]));brier+=p.reduce((sum,x,i)=>sum+(x-(i===result?1:0))**2,0);correct+=p.indexOf(Math.max(...p))===result?1:0;
    p.forEach((x,i)=>{const bin=bins[Math.min(9,Math.floor(x*10))];bin.count++;bin.meanPrediction+=x;bin.actualFrequency+=i===result?1:0;});
  });
  bins.forEach(b=>{if(b.count){b.meanPrediction/=b.count;b.actualFrequency/=b.count;}});
  return {sampleSize:rows.length,logLoss:loss/rows.length,brier:brier/rows.length,accuracy:correct/rows.length,calibration:bins,
    expectedCalibrationError:bins.reduce((s,b)=>s+b.count/(rows.length*rows[0].p.length)*Math.abs(b.meanPrediction-b.actualFrequency),0)};
}
interface PeriodDetail {prediction:Prediction;match:HistoricalMatch;prior:HistoricalMatch[];}
function period(all:HistoricalMatch[],target:HistoricalMatch[],options:Partial<ModelOptions>):{model:Metrics|null;baseline:Metrics|null;details:PeriodDetail[]} {
  const forecasts:Forecast[]=[],baseline:Forecast[]=[];
  const details:PeriodDetail[]=[];
  let model:Model|null=null,lastRefit=-Infinity,base=[1/3,1/3,1/3],prior:HistoricalMatch[]=[];
  for(const match of target){
    const cutoff=Date.parse(`${match.date}T00:00:00Z`);
    if(!model||cutoff-lastRefit>=45*DAY){
      model=fitModel(all,cutoff,{...options,availability:'reconstructed',iterations:150});lastRefit=cutoff;
      prior=eligible(all,cutoff,model.options);const counts=[1,1,1];prior.forEach(r=>counts[r.homeGoals!>r.awayGoals!?0:r.homeGoals===r.awayGoals?1:2]++);const total=counts.reduce((a,b)=>a+b,0);base=counts.map(x=>x/total);
    }
    if(model.status!=='trained')continue;
    const prediction=predictMatch(model,match.home,match.away,Math.max(cutoff+1,match.kickoffAt??cutoff+12*3600000));
    const result=match.homeGoals!>match.awayGoals!?0:match.homeGoals===match.awayGoals?1:2;
    forecasts.push({p:[prediction.probabilities.home,prediction.probabilities.draw,prediction.probabilities.away],result});baseline.push({p:base,result});
    details.push({prediction,match,prior});
  }
  return {model:metrics(forecasts),baseline:metrics(baseline),details};
}
/** Predeclared checks; a passing family never authorises an untested side or line. */
export function evaluatedSelections():MarketSelection[]{
  const result:MarketSelection[]=[];
  for(const side of ['home','draw','away'] as const)result.push({kind:'1x2',side,line:null});
  for(const side of ['home_draw','home_away','draw_away'] as const)result.push({kind:'double_chance',side,line:null});
  for(const side of ['home','away'] as const){result.push({kind:'dnb',side,line:null});for(const line of [-1,-.75,-.5,-.25,0,.25,.5,.75,1])result.push({kind:'asian_handicap',side,line});}
  for(const side of ['home','draw','away'] as const)for(const line of [-1,0,1])result.push({kind:'european_handicap',side,line});
  for(const side of ['over','under'] as const){
    for(const line of [1.5,2,2.25,2.5,2.75,3,3.5])result.push({kind:'total_goals',side,line});
    for(const team of ['home','away'] as const)for(const line of [.5,1.5,2.5])result.push({kind:'team_goals',side,line,team});
  }
  for(const side of ['yes','no'] as const)result.push({kind:'btts',side,line:null});
  return result;
}
function scoreMarket(details:PeriodDetail[],selection:MarketSelection){
  const outcomes=['win','halfWin','push','halfLoss','loss'] as const;
  const values=details.map(row=>evaluateSelection(row.prediction,selection,2));
  const actual=details.map(row=>settleScore(selection,row.match.homeGoals!,row.match.awayGoals!));
  const support=outcomes.filter(key=>values.some(v=>v.probabilities[key]>1e-12)||actual.includes(key));
  const forecasts:Forecast[]=[],baselines:Forecast[]=[],differences:number[]=[];
  const cache=new Map<string,number[]>();let predictedMean=0,observedMean=0;
  const returns={win:1,halfWin:.5,push:0,halfLoss:-.5,loss:-1};
  details.forEach((row,i)=>{
    const p=support.map(key=>values[i].probabilities[key]),result=support.indexOf(actual[i]);
    let base=cache.get(row.prediction.modelVersion);
    if(!base){
      const counts=support.map(()=>1);
      row.prior.forEach(r=>{const index=support.indexOf(settleScore(selection,r.homeGoals!,r.awayGoals!));if(index>=0)counts[index]++;});
      const total=counts.reduce((a,b)=>a+b,0);base=counts.map(x=>x/total);cache.set(row.prediction.modelVersion,base);
    }
    forecasts.push({p,result});baselines.push({p:base,result});
    const modelBrier=p.reduce((sum,x,j)=>sum+(x-(j===result?1:0))**2,0),baseBrier=base.reduce((sum,x,j)=>sum+(x-(j===result?1:0))**2,0);
    differences.push(baseBrier-modelBrier);
    predictedMean+=outcomes.reduce((sum,key)=>sum+values[i].probabilities[key]*returns[key],0);observedMean+=returns[actual[i]];
  });
  const mean=differences.length?differences.reduce((a,b)=>a+b,0)/differences.length:0;
  const variance=differences.length>1?differences.reduce((sum,x)=>sum+(x-mean)**2,0)/(differences.length-1):0;
  const standardError=Math.sqrt(variance/Math.max(1,differences.length));
  return {metrics:metrics(forecasts),benchmark:metrics(baselines),settlement:{predictedMean:details.length?predictedMean/details.length:null,observedMean:details.length?observedMean/details.length:null},
    brierImprovement:details.length?{mean,standardError,lowerBound:mean-3.5*standardError}:null};
}
function familyGates(validation:PeriodDetail[],test:PeriodDetail[]):Partial<Record<MarketKind,FamilyGate>>{
  const result:Partial<Record<MarketKind,FamilyGate>>={};
  for(const selection of evaluatedSelections()){
    const valid=scoreMarket(validation,selection),final=scoreMarket(test,selection),reasons:string[]=[];
    if(!final.metrics||final.metrics.sampleSize<100)reasons.push('Menos de 100 partidos en la prueba final.');
    if(!valid.metrics||!valid.benchmark||valid.metrics.logLoss>=valid.benchmark.logLoss)reasons.push('No supera la referencia durante validación.');
    if(!final.metrics||!final.benchmark||final.metrics.logLoss>=final.benchmark.logLoss)reasons.push('No supera el log-loss de referencia en prueba.');
    if(!final.metrics||final.metrics.expectedCalibrationError>.10)reasons.push('Calibración de la selección fuera del umbral experimental.');
    if(!final.brierImprovement||final.brierImprovement.lowerBound<=0)reasons.push('Mejora Brier insuficiente bajo el umbral prudente de comparaciones múltiples.');
    const item:MarketGateSelection={...selection,passed:reasons.length===0,reasons,...final};
    if(!result[selection.kind])result[selection.kind]={passed:false,reasons:[],testedLines:[],sampleSize:test.length,selections:[]};
    const gate=result[selection.kind]!;gate.selections.push(item);if(!gate.testedLines.includes(selection.line))gate.testedLines.push(selection.line);
  }
  for(const gate of Object.values(result)){
    gate.passed=gate.selections.some(x=>x.passed);
    gate.reasons=gate.passed?['Solo se habilitan los lados y líneas aprobados individualmente; el resto permanece en investigación.']:['Ninguna selección supera todos los controles experimentales de esta familia.'];
  }
  return result;
}
export function evaluateModel(matches:HistoricalMatch[],input:{now?:number;minTraining?:number}={}):Evaluation {
  const now=input.now??Date.now(),minTraining=input.minTraining??300;
  const all=eligible(matches,now,{...DEFAULTS,trainingWindowDays:36500,availability:'reconstructed'});
  const limitations=['Evaluación reconstruida por fecha del resultado, no auditoría de disponibilidad histórica del proveedor.','Sin cuotas históricas verificadas: no se calcula beneficio, ROI ni ventaja rentable.','Los mercados derivados se comprueban solo en los lados y líneas predefinidos; no se extrapola a otros periodos, reglas o líneas.','El filtro por comparaciones múltiples usa una aproximación prudente de 3,5 errores estándar; partidos relacionados y datos incompletos limitan su interpretación.','Modelo experimental; superar una referencia no acredita valor apostable.'];
  const version=`chrono-v2-${createHash('sha256').update(JSON.stringify({rows:all.map(r=>[r.id,r.homeGoals,r.awayGoals]),minTraining})).digest('hex').slice(0,16)}`;
  const empty:Evaluation={version,status:'insufficient',sampleSize:all.length,validation:null,test:null,benchmark:{validation:null,test:null},selectedOptions:{},chronology:{trainEnd:null,validationStart:null,validationEnd:null,testStart:null,testEnd:null,trainingCount:0,validationCount:0,testCount:0},limitations,roi:null,modelGate:{passed:false,reasons:['Muestra insuficiente para separar entrenamiento, validación y prueba.']},marketGates:{}};
  if(all.length<minTraining+100)return empty;
  const trainDay=all[Math.max(minTraining,Math.floor(all.length*.6))]?.date,testDay=all[Math.floor(all.length*.8)]?.date;
  if(!trainDay||!testDay||trainDay===testDay)return empty;
  const train=all.filter(r=>r.date<trainDay),validation=all.filter(r=>r.date>=trainDay&&r.date<testDay),test=all.filter(r=>r.date>=testDay);
  if(train.length<60||validation.length<30||test.length<30)return empty;
  const candidates=[{halfLifeDays:180,ridge:8},{halfLifeDays:365,ridge:8},{halfLifeDays:365,ridge:16}];
  let chosen=candidates[0],best=Infinity,validResult:ReturnType<typeof period>|null=null;
  for(const option of candidates){const scored=period(all,validation,option);if(scored.model&&scored.model.logLoss<best){chosen=option;best=scored.model.logLoss;validResult=scored;}}
  const tested=period(all,test,chosen);const reasons:string[]=[];
  if(!tested.model||tested.model.sampleSize<100)reasons.push('Menos de 100 partidos en la prueba final.');
  if(!tested.model||!tested.baseline||tested.model.logLoss>=tested.baseline.logLoss)reasons.push('El modelo no supera el log-loss de la referencia en la prueba final.');
  if(!tested.model||tested.model.expectedCalibrationError>.10)reasons.push('La calibración final no alcanza el umbral experimental.');
  return {version,status:'evaluated',sampleSize:all.length,validation:validResult?.model??null,test:tested.model,benchmark:{validation:validResult?.baseline??null,test:tested.baseline},selectedOptions:{...chosen,availability:'observed'},
    chronology:{trainEnd:train.at(-1)?.date??null,validationStart:validation[0]?.date??null,validationEnd:validation.at(-1)?.date??null,testStart:test[0]?.date??null,testEnd:test.at(-1)?.date??null,trainingCount:train.length,validationCount:validation.length,testCount:test.length},
    limitations,roi:null,modelGate:{passed:reasons.length===0,reasons},marketGates:familyGates(validResult?.details??[],tested.details)};
}
