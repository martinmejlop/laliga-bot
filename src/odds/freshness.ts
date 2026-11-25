// Reglas comunes de vigencia. No consulta proveedores ni genera pronósticos.
import type { MarketSelection } from '../domain.ts';
export interface Quote {
  captureId?:string;
  eventId: string;
  marketId: string;
  selectionId: string;
  bookmaker: 'bet365';
  competition: 'LaLiga'|'Champions';
  period: string;
  line: number | null;
  price: number;
  sourceUpdatedAt: number | null;
  // Último cambio de precio y última confirmación del mercado son distintos.
  sourceConfirmedAt: number | null;
  sourceObservedAt?: number | null;
  timestampKind?: 'observation' | 'last-price-change';
  sourceStale?: boolean;
  receivedAt: number;
  requestedAt: number;
  kickoffAt: number;
  suspended: boolean;
  regionVerified: boolean;
  regionVerificationMode?: 'point' | 'sampled-coverage' | 'unverified';
  regionalCheckedAt?: number | null;
  priceForCalculation?: number;
  selection?: MarketSelection;
  label?: string;
  groupName?: string;
  groupId?: string;
  validationError?: string;
}

export interface FreshnessPolicy {
  maxSourceAgeMs: number;
  maxReceiveAgeMs: number;
  maxRequestDurationMs: number;
}

// Umbrales de ensayo para apuestas previas; deben contrastarse con datos reales.
export const PREMATCH_POLICY: FreshnessPolicy = {
  maxSourceAgeMs: 60_000,
  maxReceiveAgeMs: 30_000,
  maxRequestDurationMs: 10_000,
};

// La fuente reconfirma con menos frecuencia los encuentros lejanos. La recepción
// sigue caducando a los 30 s y una marca explícita stale nunca se acepta.
export function manualPrematchPolicy(kickoffAt:number,now:number):FreshnessPolicy {
  const remaining=kickoffAt-now;
  return {...PREMATCH_POLICY,maxSourceAgeMs:remaining>48*3600000?15*60000:remaining>24*3600000?5*60000:60000};
}

export type QuoteDecision = { valid: true; reason: 'fresh' } | { valid: false; reason: string };

function validatePolicy(policy: FreshnessPolicy) {
  if (Object.values(policy).some(value => !Number.isFinite(value) || value <= 0)) throw new Error('Política de vigencia inválida.');
}

export function checkQuote(quote: Quote, now: number, policy = PREMATCH_POLICY): QuoteDecision {
  validatePolicy(policy);
  if (!Number.isFinite(now)) throw new Error('Reloj inválido.');
  if (quote.validationError) return {valid:false,reason:'invalid-source-metadata'};
  if (quote.bookmaker !== 'bet365' || !['LaLiga','Champions'].includes(quote.competition) || !quote.regionVerified) return { valid: false, reason: 'coverage-unverified' };
  if (![quote.eventId, quote.marketId, quote.selectionId, quote.period].every(x => typeof x === 'string' && x.trim())) return { valid: false, reason: 'identity-missing' };
  if (quote.line !== null && !Number.isFinite(quote.line)) return { valid: false, reason: 'invalid-line' };
  if (!Number.isFinite(quote.price) || quote.price <= 1) return { valid: false, reason: 'invalid-price' };
  if (quote.suspended !== false) return { valid: false, reason: 'suspended-or-unknown' };
  if (quote.sourceStale === true) return { valid: false, reason: 'stale-source' };
  if (!Number.isFinite(quote.kickoffAt) || quote.kickoffAt <= now) return { valid: false, reason: 'not-prematch' };
  if (quote.timestampKind !== undefined && !['observation','last-price-change'].includes(quote.timestampKind)) return {valid:false,reason:'time-unverified'};
  const sourceTime = quote.timestampKind === 'observation' ? quote.sourceObservedAt : quote.sourceUpdatedAt;
  const times = [sourceTime, quote.sourceConfirmedAt, quote.receivedAt, quote.requestedAt];
  if (times.some(t => typeof t !== 'number' || !Number.isFinite(t) || t <= 0)) return { valid: false, reason: 'time-unverified' };
  if (quote.receivedAt > now || quote.requestedAt > quote.receivedAt || sourceTime! > quote.sourceConfirmedAt! || quote.sourceConfirmedAt! > quote.receivedAt || quote.sourceUpdatedAt !== null && (!Number.isFinite(quote.sourceUpdatedAt) || quote.sourceUpdatedAt <= 0 || quote.sourceUpdatedAt > quote.sourceConfirmedAt!)) return { valid: false, reason: 'inconsistent-time' };
  if (quote.receivedAt - quote.requestedAt > policy.maxRequestDurationMs) return { valid: false, reason: 'slow-response' };
  if (now - quote.sourceConfirmedAt! > policy.maxSourceAgeMs) return { valid: false, reason: 'stale-source' };
  if (now - quote.receivedAt > policy.maxReceiveAgeMs) return { valid: false, reason: 'stale-receipt' };
  return { valid: true, reason: 'fresh' };
}

function identity(quote: Quote): string {
  return JSON.stringify([quote.eventId, quote.marketId, quote.period, quote.selectionId, quote.line]);
}

export interface PriceChange {
  kind: 'new-price' | 'price-changed' | 'withdrawn';
  key: string;
  previousPrice?: number;
  price?: number;
  reason?: string;
}

// Una instancia por partido. Un cambio de precio es una entrada para el modelo,
// no una recomendación de apuesta. Los cálculos de valor/importes siguen pendientes.
export class PriceTracker {
  #previous = new Map<string, Quote>();
  #eventId: string;
  #lastReceivedAt = -Infinity;
  #lastSnapshotAsOf = -Infinity;
  constructor(eventId: string) { if (!eventId) throw new Error('Partido requerido.'); this.#eventId = eventId; }

  invalidate(reason: string): PriceChange[] {
    const withdrawn = [...this.#previous].map(([key, quote]) => ({ kind: 'withdrawn' as const, key, previousPrice: quote.price, reason }));
    this.#previous.clear();
    return withdrawn;
  }

  applySnapshot(quotes: Quote[], snapshotAsOf: number, now: number, policy = PREMATCH_POLICY): PriceChange[] {
    validatePolicy(policy);
    if (!Number.isFinite(snapshotAsOf) || snapshotAsOf > now || snapshotAsOf < this.#lastSnapshotAsOf) return this.invalidate('out-of-order-snapshot');
    const seen = new Set<string>();
    for (const quote of quotes) {
      const key = identity(quote);
      if (quote.eventId !== this.#eventId || seen.has(key)) return this.invalidate('ambiguous-snapshot');
      seen.add(key);
    }
    const receivedAt = Math.max(-Infinity, ...quotes.map(q => q.receivedAt));
    if (quotes.length && (!Number.isFinite(receivedAt) || receivedAt < this.#lastReceivedAt)) return this.invalidate('out-of-order-response');
    const next = new Map<string, Quote>();
    const reasons = new Map<string, string>();
    const changes: PriceChange[] = [];
    for (const quote of quotes) {
      const key = identity(quote);
      const decision = checkQuote(quote, now, policy);
      if (!decision.valid) { reasons.set(key, decision.reason); continue; }
      const previous = this.#previous.get(key);
      const sourceTime = quote.timestampKind === 'observation' ? quote.sourceObservedAt : quote.sourceUpdatedAt;
      const oldTime = previous?.timestampKind === 'observation' ? previous.sourceObservedAt : previous?.sourceUpdatedAt;
      const sameMode = (quote.timestampKind ?? 'last-price-change') === (previous?.timestampKind ?? 'last-price-change');
      if (previous && (quote.sourceConfirmedAt! < previous.sourceConfirmedAt! || sameMode && sourceTime! < oldTime!)) { reasons.set(key, 'out-of-order-price'); continue; }
      // Si cambia el precio con la misma marca de origen, exigir aclaración del proveedor.
      if (previous && quote.price !== previous.price && (sameMode ? sourceTime === oldTime : quote.sourceConfirmedAt === previous.sourceConfirmedAt)) { reasons.set(key, 'inconsistent-price-timestamp'); continue; }
      next.set(key, structuredClone(quote));
      if (!previous) changes.push({ kind: 'new-price', key, price: quote.price });
      else if (previous.price !== quote.price) changes.push({ kind: 'price-changed', key, previousPrice: previous.price, price: quote.price });
    }
    for (const [key, previous] of this.#previous) {
      if (!next.has(key)) changes.push({ kind: 'withdrawn', key, previousPrice: previous.price, reason: reasons.get(key) ?? 'missing-from-complete-snapshot' });
    }
    this.#previous = next;
    this.#lastSnapshotAsOf = snapshotAsOf;
    this.#lastReceivedAt = Math.max(this.#lastReceivedAt, receivedAt);
    return changes;
  }

  // Comprobar de nuevo cuando se muestra el informe o antes de emitir un aviso.
  current(now: number, policy = PREMATCH_POLICY): Quote[] {
    return [...this.#previous.values()].filter(q => checkQuote(q, now, policy).valid).map(q => structuredClone(q));
  }
}
