import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleScore,evaluateSelection,allocateStakes,configuredStakeLimits } from '../src/value/service.ts';
import type { StakeCandidate } from '../src/value/service.ts';

const matrix=[[.25,0,0],[.25,.25,0],[0,.25,0]];
const near=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);
test('Los cuartos asiáticos liquidan medias ganancias, medias pérdidas y devoluciones desde el lado elegido',()=>{
  assert.equal(settleScore({kind:'asian_handicap',side:'home',line:-.25},1,1),'halfLoss');
  assert.equal(settleScore({kind:'asian_handicap',side:'home',line:.25},1,1),'halfWin');
  assert.equal(settleScore({kind:'asian_handicap',side:'home',line:-.75},2,1),'halfWin');
  assert.equal(settleScore({kind:'asian_handicap',side:'away',line:.75},2,1),'halfLoss');
  assert.equal(settleScore({kind:'asian_handicap',side:'away',line:1},2,1),'push');
  assert.equal(settleScore({kind:'asian_handicap',side:'home',line:-1},2,1),'push');
});
test('El valor esperado y la cuota mínima incluyen la porción devuelta de una apuesta asiática',()=>{
  const value=evaluateSelection({matrix},{kind:'asian_handicap',side:'home',line:-.25},2);
  assert.equal(value.valid,true);assert.deepEqual(value.probabilities,{win:.5,halfWin:0,push:0,halfLoss:.5,loss:0});
  near(value.expectedValue,.25);near(value.breakEvenOdds!,1.5);
  const fair=evaluateSelection({matrix},{kind:'asian_handicap',side:'home',line:-.25},1.5);
  near(fair.expectedValue,0);near(fair.kellyFraction,0);
});
test('Goles y goles de equipo distinguen enteros, medias líneas y cuartos sin confundir una alta probabilidad con valor',()=>{
  const over=evaluateSelection({matrix},{kind:'total_goals',side:'over',line:2.25},2);
  near(over.expectedValue,-.375);assert.equal(over.kellyFraction,0);
  const under=evaluateSelection({matrix},{kind:'total_goals',side:'under',line:2.25},2);
  near(under.expectedValue,.375);
  assert.equal(settleScore({kind:'team_goals',side:'over',line:1,team:'home'},1,3),'push');
  assert.equal(settleScore({kind:'team_goals',side:'under',line:1.5,team:'away'},3,1),'win');
  assert.equal(settleScore({kind:'btts',side:'yes',line:null},1,1),'win');
  assert.equal(settleScore({kind:'btts',side:'no',line:null},0,1),'win');
});
test('DNB, doble oportunidad, 1X2 y hándicap europeo aplican reglas diferentes',()=>{
  assert.equal(settleScore({kind:'dnb',side:'home',line:null},0,0),'push');
  assert.equal(settleScore({kind:'double_chance',side:'home_draw',line:null},0,0),'win');
  assert.equal(settleScore({kind:'1x2',side:'home',line:null},0,0),'loss');
  assert.equal(settleScore({kind:'european_handicap',side:'draw',line:-1},2,1),'win');
  assert.equal(settleScore({kind:'european_handicap',side:'home',line:-1},2,1),'loss');
});
test('Identidades de mercado incompletas, cuotas inválidas o distribuciones corruptas no producen valor utilizable',()=>{
  assert.equal(evaluateSelection({matrix},{kind:'team_goals',side:'over',line:2},2).valid,false);
  assert.equal(evaluateSelection({matrix},{kind:'asian_handicap',side:'home',line:.3},2).valid,false);
  assert.equal(evaluateSelection({matrix},{kind:'1x2',side:'home',line:null},1).valid,false);
  assert.equal(evaluateSelection({matrix:[[2]]},{kind:'1x2',side:'home',line:null},2).valid,false);
  assert.equal(evaluateSelection({matrix:[[NaN]]},{kind:'1x2',side:'home',line:null},2).valid,false);
});
const now=Date.UTC(2026,10,15,12);
const strong=evaluateSelection({matrix},{kind:'asian_handicap',side:'home',line:.25},2);
const candidate=(id:string,fixtureId=id):StakeCandidate=>({id,fixtureId,teams:[`H${fixtureId}`,`A${fixtureId}`],price:2,value:strong,actionable:true});

test('El máximo configurado del 10 % permite hasta 5 € con 50 € y controla conjuntamente las propuestas',()=>{
 const first={...candidate('one'),value:{...strong,kellyFraction:1}},second={...candidate('two'),value:{...strong,kellyFraction:1}};
 const result=allocateStakes([first,second],{balanceEur:50,committedEur:0,confirmedAt:now},{...configuredStakeLimits(.1),minStakeEur:3},now);
 near(result.allocations[0].stakeEur,5);near(result.allocations[1].stakeEur,0);near(result.totalStakeEur,5);
 const smaller=allocateStakes([{...first,value:{...strong,kellyFraction:.1}}],{balanceEur:50,committedEur:0,confirmedAt:now},{...configuredStakeLimits(.1),minStakeEur:3},now);
 near(smaller.totalStakeEur,0);assert.deepEqual(configuredStakeLimits(),{});assert.throws(()=>configuredStakeLimits(NaN));
});
test('Los importes respetan el saldo y los límites globales, por partido y por equipo, en céntimos',()=>{
  const candidates=Array.from({length:10},(_,i)=>candidate(String(i)));
  const result=allocateStakes(candidates,{balanceEur:100,committedEur:0,confirmedAt:now},{minStakeEur:.1},now);
  near(result.totalStakeEur,5);near(result.freeEur,95);
  assert.ok(result.allocations.every(x=>x.stakeEur<=1&&Number.isInteger(Math.round(x.stakeEur*100))));
  near(result.allocations.reduce((a,b)=>a+b.stakeEur,0),result.totalStakeEur);
  const correlated=allocateStakes([candidate('first','same'),candidate('second','same')],{balanceEur:100,committedEur:0,confirmedAt:now},{minStakeEur:.1},now);
  assert.equal(correlated.allocations.filter(x=>x.stakeEur>0).length,1);
  const repeatedTeam=candidates.map(x=>({...x,teams:['Shared']}));
  const teamLimited=allocateStakes(repeatedTeam,{balanceEur:100,committedEur:0,confirmedAt:now},{minStakeEur:.1},now);
  assert.ok(teamLimited.totalStakeEur<=3);
});
test('La cuota sin verificar, el mínimo desconocido o un saldo antiguo producen importe cero',()=>{
  const unverified={...candidate('one'),actionable:false,reason:'Bet365 España no verificada'};
  const verified=candidate('two');
  assert.equal(allocateStakes([unverified],{balanceEur:100,committedEur:0,confirmedAt:now},{minStakeEur:.1},now).totalStakeEur,0);
  assert.equal(allocateStakes([verified],{balanceEur:100,committedEur:0,confirmedAt:now},{},now).totalStakeEur,0);
  assert.equal(allocateStakes([verified],{balanceEur:100,committedEur:0,confirmedAt:now-90000000},{minStakeEur:.1},now).totalStakeEur,0);
  assert.equal(allocateStakes([verified],{balanceEur:100,committedEur:0,confirmedAt:null},{minStakeEur:.1},now).totalStakeEur,0);
  assert.equal(allocateStakes([verified],{balanceEur:100,committedEur:101,confirmedAt:now},{minStakeEur:.1},now).totalStakeEur,0);
});
test('La exposición manual se descuenta una sola vez y no se repite el partido comprometido',()=>{
  const result=allocateStakes([candidate('one','taken'),candidate('two','new')],{balanceEur:100,committedEur:2,confirmedAt:now,positions:[{fixtureId:'taken',stakeEur:2}]},{minStakeEur:.1},now);
  assert.equal(result.allocations[0].stakeEur,0);near(result.totalStakeEur,1);near(result.freeEur,97);
  const invalid={...candidate('bad'),value:{...strong,kellyFraction:NaN}};
  assert.equal(allocateStakes([invalid],{balanceEur:100,committedEur:0,confirmedAt:now},{minStakeEur:.1},now).totalStakeEur,0);
});
