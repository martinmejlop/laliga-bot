import type { Quote } from './freshness.ts';
import type {ChampionsBoard} from './champions.ts';

export const FREE_ODDS_URL = 'https://moviodds.com/odds?sport=soccer&groups=40&site=com';
export class FeedError extends Error {
  retryAfterMs: number;
  constructor(message: string, retryAfterMs = 0) { super(message); this.retryAfterMs = retryAfterMs; }
}
export interface OddsBoard {
  champions?:ChampionsBoard;
  requestedAt: number; receivedAt: number; serverTime: number;
  site: 'com'; regionVerified: false;
  matches: { id: string; home: string; away: string; kickoffAt: number; refreshSeconds: number | null; quotes: Quote[];competition?:'LaLiga'|'Champions' }[];
}
export function allMatches(board:OddsBoard|null|undefined):OddsBoard['matches'] {
  return [...(board?.matches??[]),...(board?.champions?.matches??[]).map(m=>({id:m.id,home:m.home,away:m.away,kickoffAt:m.kickoffAt,refreshSeconds:null,competition:'Champions' as const,quotes:m.quotes.map(q=>q.quote).filter(Boolean)}))];
}
const timestamp = (value: unknown): number | null => {
  if (typeof value !== 'string') return null;
  const date = Date.parse(value);
  return Number.isFinite(date) && date > 0 ? date : null;
};

export function parseBoard(data: any, requestedAt: number, receivedAt: number): OddsBoard {
  if (data?.site !== 'com') throw new FeedError('La fuente no confirma la variante Bet365.com.');
  if (data.warming === true) throw new FeedError('El proveedor está cargando el catálogo.', 30000);
  const serverTime = timestamp(data.server_time);
  if (serverTime === null || !Array.isArray(data.matches)) throw new FeedError('Respuesta del proveedor incompleta.');
  if (serverTime > receivedAt + 5000 || receivedAt - serverTime > 30000) throw new FeedError('Respuesta almacenada antigua o relojes incompatibles.');
  const matches: OddsBoard['matches'] = [];
  const ids = new Set<string>();
  for (const match of data.matches) {
    // Lista exacta: excluye Segunda, fútbol femenino, RFEF y e-soccer.
    if (match.league !== 'Spain La Liga' || match.sport !== 'soccer') continue;
    if (typeof match.id !== 'string' || ids.has(match.id) || !match.home || !match.away || !Array.isArray(match.quotes)) throw new FeedError('Identidad de partido ambigua.');
    ids.add(match.id);
    if (match.in_play !== false) continue;
    const kickoffAt = timestamp(match.kickoff_utc);
    if (kickoffAt === null || kickoffAt <= receivedAt) continue;
    const group = match.group_status?.['40'];
    const confirmed = timestamp(group?.polled_at);
    const seen = new Set<string>();
    const quotes: Quote[] = [];
    for (const quote of match.quotes) {
      if (quote.group_id !== '40') continue;
      if (quote.fixture_id !== match.id || typeof quote.sel_id !== 'string' || !quote.sel_id || !Number.isFinite(quote.odds_dec) || quote.odds_dec <= 1) throw new FeedError('Selección inválida en la respuesta.');
      const id = JSON.stringify([quote.market_id ?? '', quote.sel_id]);
      if (seen.has(id)) throw new FeedError('Selección duplicada en la respuesta.');
      seen.add(id);
      quotes.push({ eventId: match.id, marketId: `40:${quote.market_id ?? ''}`, selectionId: quote.sel_id,
        bookmaker: 'bet365', competition: 'LaLiga', period: 'full_time_regulation', line: null, price: quote.odds_dec,
        sourceUpdatedAt: timestamp(quote.ts), sourceConfirmedAt: confirmed,
        receivedAt, requestedAt, kickoffAt,
        suspended: quote.suspended !== undefined && quote.suspended !== false,
        sourceStale: group?.stale === true,
        ...(quote.phase !== undefined && quote.phase !== 'prematch'?{validationError:'La fase de origen no es previa al partido.'}:{}),
        // .com no demuestra automáticamente igualdad con la cuenta de España.
        regionVerified: false });
    }
    matches.push({ id: match.id, home: match.home, away: match.away, kickoffAt,
      refreshSeconds: Number.isFinite(match.refresh_s) && match.refresh_s > 0 ? match.refresh_s : null, quotes });
  }
  return { requestedAt, receivedAt, serverTime, site: 'com', regionVerified: false, matches };
}

export async function fetchFreeBoard(request: typeof fetch = fetch): Promise<OddsBoard> {
  const requestedAt = Date.now();
  let response: Response;
  try { response = await request(FREE_ODDS_URL, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'accept-encoding': 'gzip', 'accept': 'application/json' } }); }
  catch { throw new FeedError('No se pudo conectar al proveedor gratuito.'); }
  if (!response.ok) {
    const retry = response.headers.get('retry-after');
    const seconds = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry ?? '') - Date.now());
    throw new FeedError(`Proveedor gratuito: HTTP ${response.status}.`, Number.isFinite(seconds) && seconds > 0 ? seconds : 30000);
  }
  const chunks: Uint8Array[] = []; let size = 0;
  const reader = response.body?.getReader();
  if (!reader) throw new FeedError('Respuesta vacía.');
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 8000000) throw new FeedError('La respuesta supera el límite de tamaño.');
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new FeedError('El proveedor no devolvió JSON válido.'); }
  return parseBoard(data, requestedAt, Date.now());
}
