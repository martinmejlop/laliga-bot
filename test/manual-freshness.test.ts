import {test} from 'node:test';
import assert from 'node:assert/strict';
import {manualPrematchPolicy,checkQuote,type Quote} from '../src/odds/freshness.ts';
test('La vigencia manual se acorta al acercarse el inicio y mantiene bloqueo por recepción antigua, suspensión y stale',()=>{
 const now=Date.UTC(2026,10,23),policy=manualPrematchPolicy(now+5*86400000,now);
 assert.equal(policy.maxSourceAgeMs,900000);assert.equal(manualPrematchPolicy(now+36*3600000,now).maxSourceAgeMs,300000);assert.equal(manualPrematchPolicy(now+24*3600000,now).maxSourceAgeMs,60000);
 const q:Quote={eventId:'e',marketId:'40:40',selectionId:'s',bookmaker:'bet365',competition:'LaLiga',period:'full_time_regulation',line:null,price:2,sourceUpdatedAt:now-10*60000,sourceConfirmedAt:now-8*60000,requestedAt:now-100,receivedAt:now-10,kickoffAt:now+5*86400000,suspended:false,regionVerified:true};
 assert.equal(checkQuote(q,now,policy).valid,true);
 assert.equal(checkQuote({...q,sourceStale:true},now,policy).valid,false);assert.equal(checkQuote({...q,suspended:true},now,policy).valid,false);
 assert.equal(checkQuote({...q,requestedAt:now-32000,receivedAt:now-31000},now,policy).valid,false);
 assert.equal(checkQuote(q,now,manualPrematchPolicy(now+86400000,now)).valid,false);
 assert.equal(checkQuote({...q,sourceConfirmedAt:now-16*60000,sourceUpdatedAt:now-17*60000},now,policy).valid,false);
});
