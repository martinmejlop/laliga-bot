import { readFileSync } from 'node:fs';
import { Store, StoreError } from './store.ts';
import { FREE_ODDS_URL, type OddsBoard } from '../odds/moviodds.ts';

export const MOVIODDS_SOURCE = 'moviodds:com';
export const NEWS_SOURCE = 'mundodeportivo:rss';

export function registerObservedSources(store: Store) {
  store.atomic(() => {
    store.registerSource(MOVIODDS_SOURCE,'MoviOdds — variante .com', 'https://moviodds.com/doc',
      'Acceso público gratuito para aplicación propia; sin SLA. No revender el feed. Equivalencia Bet365 España pendiente.');
    store.registerSource(NEWS_SOURCE,'Mundo Deportivo — metadatos RSS','https://www.mundodeportivo.com/rss/futbol/laliga.xml',
      'Derechos reservados. Solo metadatos de investigación; no implica permiso para redistribuir artículos.');
    const catalog = JSON.parse(readFileSync(new URL('../../config/team-aliases.json',import.meta.url),'utf8'));
    if (catalog.version !== 1 || !Array.isArray(catalog.teams)) throw new StoreError('INVALID_ALIASES','Catálogo de nombres incompatible.');
    for (const team of catalog.teams) {
      const id = store.ensureTeam(team.name);
      for (const [field,sourceId] of [['moviodds',MOVIODDS_SOURCE],['mundodeportivo',NEWS_SOURCE]]) {
        if (team[field] !== undefined && (!Array.isArray(team[field]) || !team[field].length)) throw new StoreError('INVALID_ALIASES','Lista de nombres inválida.');
        for (const alias of team[field] ?? []) store.bindTeam(sourceId,alias,id);
      }
    }
  });
}

// Importa el formato normalizado archivado por odds:check, conservando sus tiempos originales.
// No consulta Internet, no renueva cuotas ni verifica precios de España.
export function importArchivedBoard(store: Store, raw: string, season: string): string {
  return store.atomic(() => {
    if (typeof raw !== 'string' || Buffer.byteLength(raw)>8000000) throw new StoreError('INVALID_BOARD','Tamaño de muestra inválido.');
    const board: OddsBoard = JSON.parse(raw);
    if (!board || board.site !== 'com' || board.regionVerified !== false || !Number.isSafeInteger(board.serverTime) || board.serverTime<=0 || !Array.isArray(board.matches)) throw new StoreError('INVALID_BOARD','Muestra normalizada incompatible.');
    const captureId = store.capture({ sourceId:MOVIODDS_SOURCE, ingestionKey:`board:${board.receivedAt}`,
      url:FREE_ODDS_URL, format:'normalized-moviodds-board-v1', rawText:raw,
      requestedAt:board.requestedAt, receivedAt:board.receivedAt, sourceAsOf:board.serverTime });
    const seen = new Set<string>();
    for (const match of board.matches) {
      if (typeof match.id !== 'string' || seen.has(match.id) || !Array.isArray(match.quotes)) throw new StoreError('DUPLICATE_FIXTURE','Identidad de partido ausente o duplicada.');
      seen.add(match.id);
      const date = new Date(match.kickoffAt);
      const firstYear = date.getUTCFullYear() - (date.getUTCMonth() < 6 ? 1 : 0);
      const expectedSeason = `${firstYear}-${String((firstYear+1)%100).padStart(2,'0')}`;
      if (!Number.isSafeInteger(match.kickoffAt) || expectedSeason !== season) throw new StoreError('INVALID_SEASON','El inicio del partido no corresponde a la temporada declarada.');
      if (match.kickoffAt<=board.receivedAt) throw new StoreError('INVALID_BOARD','Esta captura de cuotas previas contiene un partido ya iniciado.');
      const homeId = store.resolveTeam(MOVIODDS_SOURCE,match.home);
      const awayId = store.resolveTeam(MOVIODDS_SOURCE,match.away);
      const fixtureId = store.ensureFixture(MOVIODDS_SOURCE,match.id,season,homeId,awayId);
      store.observeFixture({captureId,fixtureId,kickoffAt:match.kickoffAt,status:'scheduled',details:{
        suppliedBy:'moviodds:com', officialKickoffVerified:false, refreshSeconds:match.refreshSeconds }});
      const selections = new Set<string>();
      for (const quote of match.quotes) {
        const key = JSON.stringify([quote.marketId,quote.period,quote.selectionId,quote.line]);
        if (selections.has(key)) throw new StoreError('DUPLICATE_QUOTE','Selección duplicada en la captura.');
        selections.add(key);
        if (quote.regionVerified !== false || quote.marketId !== '40:40' || quote.period !== 'full_time_regulation' || quote.line !== null || quote.eventId !== match.id) throw new StoreError('INVALID_BOARD','La selección no corresponde al formato archivado de T02.');
        store.observeQuote(captureId,fixtureId,quote);
      }
    }
    return captureId;
  });
}
