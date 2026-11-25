import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkQuote, PriceTracker, type Quote } from '../src/odds/freshness.ts';

const now = 1800000000000;
const quote: Quote = { eventId: 'match-1', marketId: '1x2', selectionId: 'home', bookmaker: 'bet365', competition: 'LaLiga', period: 'full_time', line: null,
  price: 2, sourceUpdatedAt: now - 1000, sourceConfirmedAt: now - 1000, requestedAt: now - 500, receivedAt: now - 100, kickoffAt: now + 3600000, suspended: false, regionVerified: true };

test('Una lectura explícita admite cambio desconocido y rechaza observaciones posteriores a su confirmación',()=>{
 const observed:Quote={...quote,timestampKind:'observation',sourceUpdatedAt:null,sourceObservedAt:now-1000};
 assert.equal(checkQuote(observed,now).valid,true);
 assert.equal(checkQuote({...observed,sourceObservedAt:now-900},now).reason,'inconsistent-time');
 assert.equal(checkQuote({...observed,sourceStale:true},now).valid,false);
 const tracker=new PriceTracker('match-1');tracker.applySnapshot([observed],now,now);
 const next={...observed,price:2.1,sourceObservedAt:now,sourceConfirmedAt:now,receivedAt:now+1,requestedAt:now};
 assert.equal(tracker.applySnapshot([next],now+1,now+1)[0].kind,'price-changed');
});

test('Recibir una cuota antigua ahora no la convierte en actual', () => {
  assert.equal(checkQuote({ ...quote, sourceUpdatedAt: now - 120000, sourceConfirmedAt: now - 120000 }, now).reason, 'stale-source');
  assert.equal(checkQuote({ ...quote, sourceUpdatedAt: null }, now).reason, 'time-unverified');
  assert.equal(checkQuote({ ...quote, sourceUpdatedAt: now + 1 }, now).valid, false);
  assert.equal(checkQuote({ ...quote, regionVerified: false }, now).valid, false);
});
test('Una selección suspendida, fuera de plazo o con respuesta lenta no es utilizable', () => {
  assert.equal(checkQuote({ ...quote, suspended: true }, now).valid, false);
  assert.equal(checkQuote({ ...quote, kickoffAt: now }, now).valid, false);
  assert.equal(checkQuote({ ...quote, requestedAt: now - 11000 }, now).reason, 'slow-response');
  assert.equal(checkQuote(quote, now + 31000).reason, 'stale-receipt');
});
test('Detecta cambios, evita avisos duplicados y deja de mostrar cuotas vencidas', () => {
  const tracker = new PriceTracker('match-1');
  assert.equal(tracker.applySnapshot([quote], now, now)[0].kind, 'new-price');
  assert.deepEqual(tracker.applySnapshot([quote], now, now), []);
  const next = { ...quote, price: 2.1, sourceUpdatedAt: now, sourceConfirmedAt: now, requestedAt: now, receivedAt: now + 1 };
  assert.equal(tracker.applySnapshot([next], now + 1, now + 1)[0].kind, 'price-changed');
  assert.equal(tracker.current(now + 31000).length, 0);
});
test('Retira una cuota cuando se suspende, desaparece o falla la fuente', () => {
  for (const action of ['suspend', 'missing', 'failure']) {
    const tracker = new PriceTracker('match-1');
    tracker.applySnapshot([quote], now, now);
    const changes = action === 'failure' ? tracker.invalidate('provider-error') : tracker.applySnapshot(action === 'missing' ? [] : [{ ...quote, suspended: true }], now + 1, now + 1);
    assert.equal(changes[0].kind, 'withdrawn');
    assert.equal(tracker.current(now + 1).length, 0);
  }
});
test('No mezcla líneas ni acepta duplicados o respuestas fuera de orden', () => {
  const tracker = new PriceTracker('match-1');
  const otherLine = { ...quote, line: 0.5 };
  assert.equal(tracker.applySnapshot([quote, otherLine], now, now).length, 2);
  assert.ok(tracker.applySnapshot([quote, quote], now + 1, now + 1).every(c => c.kind === 'withdrawn'));
  tracker.applySnapshot([quote], now + 2, now + 2);
  assert.equal(tracker.applySnapshot([quote], now - 1, now + 3)[0].reason, 'out-of-order-snapshot');
});
test('No acepta un cambio de precio con la misma fecha de origen', () => {
  const tracker = new PriceTracker('match-1');
  tracker.applySnapshot([quote], now, now);
  assert.equal(tracker.applySnapshot([{ ...quote, price: 2.2 }], now + 1, now + 1)[0].reason, 'inconsistent-price-timestamp');
});
test('Un precio estable y reconfirmado sigue vigente aunque el último cambio sea antiguo', () => {
  assert.equal(checkQuote({ ...quote, sourceUpdatedAt: now - 86400000 }, now).valid, true);
  assert.equal(checkQuote({ ...quote, sourceConfirmedAt: null }, now).reason, 'time-unverified');
});
