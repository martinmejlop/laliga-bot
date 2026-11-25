import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ledger, LedgerError } from '../src/ledger/service.ts';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const code=(value:string)=>(e:unknown)=>e instanceof LedgerError && e.code===value;
const input=(key='bet',mode:'manual'|'simulation'='manual')=>({idempotencyKey:key,eventId:'controlled-fixture',eventName:'Ejemplo A — Ejemplo B',market:'Resultado',selection:'Local',price:2.5,stakeEur:10,mode});
test('No presume saldo real y simulación y registro manual conservan saldos separados',t=>{
  const ledger=new Ledger(':memory:'); t.after(()=>ledger.close());
  assert.equal(ledger.snapshot().manual.confirmed,false);
  assert.throws(()=>ledger.recordBet(input()),code('BALANCE_UNCONFIRMED'));
  ledger.recordBet(input('sim','simulation'));
  assert.equal(ledger.snapshot().simulation.availableEur,90); assert.equal(ledger.snapshot().manual.availableEur,100);
  ledger.confirmBalance({balanceEur:100,idempotencyKey:'balance'});
  const bet=ledger.recordBet(input());
  assert.equal(ledger.snapshot().manual.bankrollEur,100); assert.equal(ledger.snapshot().manual.availableEur,90);
  assert.equal(ledger.snapshot().manual.committedEur,10); assert.equal(bet.status,'open');
});
test('Repetir un registro o liquidación no duplica dinero y una clave con otros datos se rechaza',t=>{
  const ledger=new Ledger(':memory:'); t.after(()=>ledger.close()); ledger.confirmBalance({balanceEur:100,idempotencyKey:'balance'});
  const first=ledger.recordBet(input()); assert.equal(ledger.recordBet(input()).id,first.id);
  assert.throws(()=>ledger.recordBet({...input(),stakeEur:20}),code('IDEMPOTENCY_CONFLICT'));
  const settle={betId:first.id,result:'won' as const,idempotencyKey:'settlement'};
  ledger.settleBet(settle); ledger.settleBet(settle);
  assert.equal(ledger.snapshot().manual.bankrollEur,115); assert.equal(ledger.snapshot().manual.availableEur,115);
  assert.throws(()=>ledger.settleBet({...settle,idempotencyKey:'other'}),code('ALREADY_SETTLED'));
  assert.throws(()=>ledger.settleBet({...settle,result:'lost'}),code('IDEMPOTENCY_CONFLICT'));
});
test('Las medias ganancias, pérdidas y devoluciones liberan exposición y suman céntimos exactos',t=>{
  const ledger=new Ledger(':memory:'); t.after(()=>ledger.close());
  for (const [n,result,expected] of [[1,'half_won',107.5],[2,'half_lost',102.5],[3,'void',102.5],[4,'lost',92.5]] as const) {
    const bet=ledger.recordBet(input(`bet-${n}`,'simulation'));
    ledger.settleBet({betId:bet.id,result,idempotencyKey:`settle-${n}`});
    assert.equal(ledger.snapshot().simulation.bankrollEur,expected); assert.equal(ledger.snapshot().simulation.committedEur,0);
  }
  assert.equal(ledger.snapshot().manual.netProfitEur,0);
});
test('Conciliar significa saldo libre observado más apuestas pendientes, sin inventar ganancias',t=>{
  const ledger=new Ledger(':memory:'); t.after(()=>ledger.close());
  ledger.confirmBalance({balanceEur:100,idempotencyKey:'initial'}); ledger.recordBet(input());
  ledger.confirmBalance({balanceEur:80,idempotencyKey:'reconcile'});
  assert.equal(ledger.snapshot().manual.availableEur,80); assert.equal(ledger.snapshot().manual.bankrollEur,90);
  assert.equal(ledger.snapshot().manual.reconciliationEur,-10); assert.equal(ledger.snapshot().manual.netProfitEur,0);
  ledger.confirmBalance({balanceEur:80,idempotencyKey:'reconcile'});
  assert.equal(ledger.snapshot().manual.bankrollEur,90);
});
test('Corregir un dato conserva el historial y verifica el dinero libre antes de aumentar el importe',t=>{
  const ledger=new Ledger(':memory:'); t.after(()=>ledger.close());
  const bet=ledger.recordBet(input('sim','simulation'));
  const correction={betId:bet.id,idempotencyKey:'correct',stakeEur:20,price:3,reason:'Error de transcripción'};
  ledger.correctBet(correction); ledger.correctBet(correction);
  const state=ledger.snapshot(); assert.equal(state.simulation.availableEur,80); assert.equal(state.bets[0].version,2);
  assert.equal(state.events.find(e=>e.kind==='bet_recorded')?.payload.stakeCents,1000);
  assert.throws(()=>ledger.correctBet({...correction,idempotencyKey:'overspend',stakeEur:101}),code('INSUFFICIENT_FUNDS'));
  ledger.settleBet({betId:bet.id,result:'won',idempotencyKey:'settled'});
  assert.equal(ledger.snapshot().simulation.bankrollEur,140);
  assert.throws(()=>ledger.correctBet({...correction,idempotencyKey:'late'}),code('ALREADY_SETTLED'));
});
test('Importes, cuotas y exposición inválidos se rechazan antes de guardar eventos',t=>{
  const ledger=new Ledger(':memory:'); t.after(()=>ledger.close());
  for (const stakeEur of [-1,NaN,Infinity,0,0.001]) assert.throws(()=>ledger.recordBet({...input('bad','simulation'),stakeEur}),code('INVALID_MONEY'));
  for (const price of [0,1,NaN,Infinity]) assert.throws(()=>ledger.recordBet({...input('bad','simulation'),price}),code('INVALID_PRICE'));
  assert.throws(()=>ledger.recordBet({...input('over','simulation'),stakeEur:101}),code('INSUFFICIENT_FUNDS'));
  assert.equal(ledger.snapshot().events.length,0);
});
test('Los céntimos de liquidación pueden conciliar la devolución realmente cobrada',t=>{
  const ledger=new Ledger(':memory:'); t.after(()=>ledger.close());
  const bet=ledger.recordBet({...input('small','simulation'),stakeEur:0.03,price:1.7});
  const settled=ledger.settleBet({betId:bet.id,result:'won',payoutEur:0.05,idempotencyKey:'actual'});
  assert.equal(settled.profitEur,0.02); assert.equal(ledger.snapshot().simulation.bankrollEur,100.02);
});
test('El registro persiste al reabrir y no permite borrar o modificar sus eventos',t=>{
  const folder=mkdtempSync(join(tmpdir(),'laliga-ledger-')); t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const path=join(folder,'ledger.sqlite');
  const first=new Ledger(path); const bet=first.recordBet(input('persist','simulation')); first.close();
  const second=new Ledger(path);
  assert.equal(second.snapshot().bets[0].id,bet.id); assert.equal(second.integrity().integrity,'ok'); second.close();
  const raw=new DatabaseSync(path);
  try { assert.throws(()=>raw.exec('DELETE FROM ledger_events'),/append-only/); assert.throws(()=>raw.exec('UPDATE ledger_events SET created_at=1'),/append-only/); }
  finally {raw.close();}
});
