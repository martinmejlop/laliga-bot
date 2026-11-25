import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const APP_ID = 0x4c4c4d4c;
const VERSION = 1;
export type BetMode = 'manual' | 'simulation';
export type BetResult = 'won' | 'lost' | 'void' | 'half_won' | 'half_lost';
export interface LedgerBet {
  id: string; eventId: string; eventName: string; market: string; selection: string;
  price: number; stakeEur: number; stakeCents: number; mode: BetMode; recommendationId: string | null;
  status: 'open' | 'settled'; result: BetResult | null; payoutEur: number | null; profitEur: number | null;
  createdAt: number; updatedAt: number; settledAt: number | null; version: number;
}
export interface LedgerAccount {
  initialBudgetEur: number; bankrollEur: number; balanceEur: number; availableEur: number;
  committedEur: number; confirmed: boolean; confirmedAt: number | null; netProfitEur: number;
  reconciliationEur: number; bets: LedgerBet[];
}
export interface LedgerSnapshot extends LedgerAccount {
  manual: LedgerAccount; simulation: LedgerAccount; events: LedgerEvent[];
}
export interface LedgerEvent {
  id: string; seq: number; kind: string; createdAt: number; payload: Record<string, any>;
}
interface MutableAccount {
  bankrollCents: number; confirmed: boolean; confirmedAt: number | null; profitCents: number; reconciliationCents: number;
}
type RecordInput = {
  idempotencyKey: string; eventId: string; eventName: string; market: string; selection: string;
  price: number; stakeEur: number; mode: BetMode; recommendationId?: string | null;
};
type CorrectInput = { betId: string; idempotencyKey: string; price?: number; stakeEur?: number; market?: string; selection?: string; reason: string };
type SettleInput = {betId:string; result:BetResult; idempotencyKey:string; payoutEur?:number};

export class LedgerError extends Error {
  code: string;
  constructor(code:string,message:string) { super(message); this.name='LedgerError'; this.code=code; }
}
function fail(code:string,message:string): never { throw new LedgerError(code,message); }
function label(value:unknown,name:string,max=500):string {
  if (typeof value!=='string' || !value.trim() || value.length>max) fail('INVALID_INPUT',`${name}: valor inválido.`);
  return value.trim();
}
function cents(value:unknown,name:string,positive=false):number {
  if (typeof value!=='number' || !Number.isFinite(value) || value<0 || value>1_000_000 || (positive && value<=0)) fail('INVALID_MONEY',`${name}: indica un importe válido en euros.`);
  const n=Math.round(value*100);
  if (!Number.isSafeInteger(n) || Math.abs(value*100-n)>1e-7 || (positive && n<=0)) fail('INVALID_MONEY',`${name}: utiliza como máximo dos decimales.`);
  return n;
}
function decimal(value:unknown):number {
  if (typeof value!=='number' || !Number.isFinite(value) || value<=1 || value>1_000_000) fail('INVALID_PRICE','La cuota debe ser decimal y mayor que 1.');
  return value;
}
function mode(value:unknown):BetMode {
  if (value!=='manual' && value!=='simulation') fail('INVALID_MODE','Distingue registro manual y simulación.');
  return value;
}
function result(value:unknown):BetResult {
  if (!['won','lost','void','half_won','half_lost'].includes(String(value))) fail('INVALID_RESULT','Resultado de liquidación no válido.');
  return value as BetResult;
}
function euros(value:number):number { return value/100; }
function stable(value:unknown):string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value==='object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable((value as any)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export class Ledger {
  #db:DatabaseSync;
  constructor(path:string) {
    if (path!==':memory:') mkdirSync(dirname(path),{recursive:true});
    this.#db=new DatabaseSync(path,{timeout:5000});
    try {
      const version=Number(this.#db.prepare('PRAGMA user_version').get()!.user_version);
      const app=Number(this.#db.prepare('PRAGMA application_id').get()!.application_id);
      const count=Number(this.#db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get()!.n);
      if (!version && !app && !count) {
        this.#db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE ledger_events (
            seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, idempotency_key TEXT NOT NULL UNIQUE,
            kind TEXT NOT NULL, request_json TEXT NOT NULL CHECK(json_valid(request_json)),
            payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at INTEGER NOT NULL
          ) STRICT;
          CREATE TRIGGER immutable_ledger_update BEFORE UPDATE ON ledger_events BEGIN SELECT RAISE(ABORT,'Ledger is append-only'); END;
          CREATE TRIGGER immutable_ledger_delete BEFORE DELETE ON ledger_events BEGIN SELECT RAISE(ABORT,'Ledger is append-only'); END;
          PRAGMA application_id=${APP_ID}; PRAGMA user_version=${VERSION}; COMMIT;`);
      } else if (version!==VERSION || app!==APP_ID) fail('WRONG_DATABASE','Este archivo no es el registro de apuestas de LaLiga.');
      this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    } catch(error) { this.#db.close(); throw error; }
  }
  close() { this.#db.close(); }
  #readEvents():LedgerEvent[] {
    return this.#db.prepare('SELECT * FROM ledger_events ORDER BY seq').all().map(row=>({
      seq:Number(row.seq),id:String(row.id),kind:String(row.kind),createdAt:Number(row.created_at),payload:JSON.parse(String(row.payload_json))
    }));
  }
  snapshot():LedgerSnapshot {
    const events=this.#readEvents();
    const accounts:Record<BetMode,MutableAccount>={
      manual:{bankrollCents:10000,confirmed:false,confirmedAt:null,profitCents:0,reconciliationCents:0},
      simulation:{bankrollCents:10000,confirmed:true,confirmedAt:null,profitCents:0,reconciliationCents:0}
    };
    const bets=new Map<string,LedgerBet>();
    for (const event of events) {
      const p=event.payload;
      if (event.kind==='balance_confirmed') {
        const account=accounts.manual; account.bankrollCents+=p.deltaCents;
        account.reconciliationCents+=p.deltaCents; account.confirmed=true; account.confirmedAt=event.createdAt;
      } else if (event.kind==='bet_recorded') {
        bets.set(p.id,{...p,stakeEur:euros(p.stakeCents),status:'open',result:null,payoutEur:null,profitEur:null,
          createdAt:event.createdAt,updatedAt:event.createdAt,settledAt:null,version:1});
      } else if (event.kind==='bet_corrected') {
        const bet=bets.get(p.betId)!;
        Object.assign(bet,p.changes,{stakeEur:euros(p.changes.stakeCents??bet.stakeCents),updatedAt:event.createdAt,version:bet.version+1});
      } else if (event.kind==='bet_settled') {
        const bet=bets.get(p.betId)!;
        Object.assign(bet,{status:'settled',result:p.result,payoutEur:euros(p.payoutCents),profitEur:euros(p.profitCents),updatedAt:event.createdAt,settledAt:event.createdAt,version:bet.version+1});
        accounts[bet.mode].bankrollCents+=p.profitCents; accounts[bet.mode].profitCents+=p.profitCents;
      }
    }
    const all=[...bets.values()].sort((a,b)=>b.createdAt-a.createdAt || a.id.localeCompare(b.id));
    const account=(key:BetMode):LedgerAccount=>{
      const state=accounts[key],rows=all.filter(b=>b.mode===key);
      const committed=rows.filter(b=>b.status==='open').reduce((sum,b)=>sum+b.stakeCents,0);
      return {initialBudgetEur:100,bankrollEur:euros(state.bankrollCents),balanceEur:euros(state.bankrollCents-committed),
        availableEur:euros(state.bankrollCents-committed),committedEur:euros(committed),confirmed:state.confirmed,
        confirmedAt:state.confirmedAt,netProfitEur:euros(state.profitCents),reconciliationEur:euros(state.reconciliationCents),bets:rows};
    };
    const manual=account('manual'),simulation=account('simulation');
    return {...manual,bets:all,manual,simulation,events:events.slice(-200)};
  }
  #command<T>(kind:string,key:string,request:object,create:(state:LedgerSnapshot)=>object,resolve:(state:LedgerSnapshot,payload:any)=>T):T {
    key=label(key,'Identificador de operación',150);
    if (key.startsWith('system:')) fail('INVALID_KEY','Identificador de operación reservado.');
    const requestJson=stable({kind,...request});
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const previous=this.#db.prepare('SELECT request_json,payload_json FROM ledger_events WHERE idempotency_key=?').get(key);
      if (previous) {
        if (String(previous.request_json)!==requestJson) fail('IDEMPOTENCY_CONFLICT','Esta operación ya fue registrada con otros datos.');
        const state=this.snapshot(); this.#db.exec('COMMIT'); return resolve(state,JSON.parse(String(previous.payload_json)));
      }
      const payload=create(this.snapshot());
      this.#db.prepare('INSERT INTO ledger_events(id,idempotency_key,kind,request_json,payload_json,created_at) VALUES(?,?,?,?,?,?)')
        .run(randomUUID(),key,kind,requestJson,JSON.stringify(payload),Date.now());
      const state=this.snapshot(); this.#db.exec('COMMIT'); return resolve(state,payload);
    } catch(error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  confirmBalance(input:{balanceEur:number;idempotencyKey:string}):LedgerAccount {
    const cashCents=cents(input.balanceEur,'Saldo disponible');
    return this.#command('balance_confirmed',input.idempotencyKey,{cashCents},state=>({cashCents,
      previousCashCents:Math.round(state.manual.availableEur*100),deltaCents:cashCents-Math.round(state.manual.availableEur*100)}),state=>state.manual);
  }
  recordBet(input:RecordInput):LedgerBet {
    const request={eventId:label(input.eventId,'Partido'),eventName:label(input.eventName,'Nombre del partido'),
      market:label(input.market,'Mercado'),selection:label(input.selection,'Selección'),price:decimal(input.price),
      stakeCents:cents(input.stakeEur,'Importe',true),mode:mode(input.mode),recommendationId:input.recommendationId?label(input.recommendationId,'Recomendación'):null};
    return this.#command('bet_recorded',input.idempotencyKey,request,state=>{
      const account=state[request.mode];
      if (!account.confirmed) fail('BALANCE_UNCONFIRMED','Confirma primero el saldo disponible que ves en Bet365.');
      if (request.stakeCents>Math.round(account.availableEur*100)) fail('INSUFFICIENT_FUNDS','El importe supera el dinero libre de este registro.');
      return {id:randomUUID(),...request};
    },(state,payload)=>state.bets.find(b=>b.id===payload.id)!);
  }
  correctBet(input:CorrectInput):LedgerBet {
    const betId=label(input.betId,'Apuesta'),reason=label(input.reason,'Motivo de la corrección');
    const changes:Record<string,any>={};
    if (input.price!==undefined) changes.price=decimal(input.price);
    if (input.stakeEur!==undefined) changes.stakeCents=cents(input.stakeEur,'Importe',true);
    if (input.market!==undefined) changes.market=label(input.market,'Mercado');
    if (input.selection!==undefined) changes.selection=label(input.selection,'Selección');
    if (!Object.keys(changes).length) fail('EMPTY_CORRECTION','Indica qué dato deseas corregir.');
    return this.#command('bet_corrected',input.idempotencyKey,{betId,changes,reason},state=>{
      const bet=state.bets.find(b=>b.id===betId);
      if (!bet) fail('UNKNOWN_BET','No se encuentra esta apuesta.');
      if (bet.status!=='open') fail('ALREADY_SETTLED','Una apuesta liquidada conserva sus datos; concilia el saldo para reflejar ajustes posteriores.');
      const extra=(changes.stakeCents??bet.stakeCents)-bet.stakeCents;
      if (extra>Math.round(state[bet.mode].availableEur*100)) fail('INSUFFICIENT_FUNDS','La corrección supera el dinero libre del registro.');
      return {betId,changes,reason,previousVersion:bet.version};
    },state=>state.bets.find(b=>b.id===betId)!);
  }
  settleBet(input:SettleInput):LedgerBet {
    const betId=label(input.betId,'Apuesta'),outcome=result(input.result);
    const payoutOverride=input.payoutEur===undefined?null:cents(input.payoutEur,'Devolución cobrada');
    return this.#command('bet_settled',input.idempotencyKey,{betId,result:outcome,payoutOverride},state=>{
      const bet=state.bets.find(b=>b.id===betId);
      if (!bet) fail('UNKNOWN_BET','No se encuentra esta apuesta.');
      if (bet.status!=='open') fail('ALREADY_SETTLED','Esta apuesta ya está liquidada.');
      const factor={won:bet.price,lost:0,void:1,half_won:1+(bet.price-1)/2,half_lost:0.5}[outcome];
      const payoutCents=payoutOverride??Math.round(bet.stakeCents*factor);
      if (!Number.isSafeInteger(payoutCents)) fail('INVALID_MONEY','La devolución calculada supera el límite admitido.');
      return {betId,result:outcome,payoutCents,profitCents:payoutCents-bet.stakeCents,actualPayoutProvided:payoutOverride!==null};
    },state=>state.bets.find(b=>b.id===betId)!);
  }
  integrity() { return {integrity:this.#db.prepare('PRAGMA integrity_check').get()!.integrity_check,
    eventCount:Number(this.#db.prepare('SELECT count(*) n FROM ledger_events').get()!.n),schemaVersion:VERSION}; }
}
