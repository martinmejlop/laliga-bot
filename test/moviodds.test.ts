import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBoard, fetchFreeBoard, FREE_ODDS_URL, FeedError } from '../src/odds/moviodds.ts';
const now = Date.now();
const date = (offset: number) => new Date(now + offset).toISOString();
const match = { id: '1', sport: 'soccer', league: 'Spain La Liga', home: 'A', away: 'B', in_play: false,
  kickoff_utc: date(86400000), group_status: { '40': { polled_at: date(-1000) } },
  quotes: [{ fixture_id: '1', group_id: '40', market_id: '40', sel_id: 's1', odds_dec: 2, ts: date(-3600000) }] };
const envelope = (matches: unknown[] = [match]) => ({ site: 'com', server_time: date(-100), matches });
test('Mantiene último cambio y reconfirmación separados, sin dar por verificada España', () => {
  const board = parseBoard(envelope(), now - 50, now);
  assert.equal(board.matches.length, 1);
  const q = board.matches[0].quotes[0];
  assert.equal(q.sourceUpdatedAt, now - 3600000);
  assert.equal(q.sourceConfirmedAt, now - 1000);
  assert.equal(q.regionVerified, false);
  assert.equal(q.suspended, false);
});
test('No admite variante australiana o respuesta antigua/calientando', () => {
  assert.throws(() => parseBoard({ ...envelope(), site: 'com.au' }, now - 50, now));
  assert.throws(() => parseBoard({ ...envelope(), warming: true }, now - 50, now));
  assert.throws(() => parseBoard({ ...envelope(), server_time: date(-40000) }, now - 50, now));
});
test('Excluye otras competiciones, fútbol virtual y partidos ya iniciados', () => {
  const b = parseBoard(envelope([{ ...match, league: 'Spain Segunda' }, { ...match, sport: 'esoccer' }, { ...match, in_play: true }]), now - 50, now);
  assert.equal(b.matches.length, 0);
});
test('Usa confirmación por mercado; no sustituye campos ausentes por la hora actual', () => {
  const b = parseBoard(envelope([{ ...match, group_status: undefined, polled_at: date(-10) }]), now - 50, now);
  assert.equal(b.matches[0].quotes[0].sourceConfirmedAt, null);
  const stale = parseBoard(envelope([{ ...match, group_status: { '40': { stale: true, polled_at: date(-100) } } }]), now - 50, now);
  assert.equal(stale.matches[0].quotes[0].suspended, false);
  assert.equal(stale.matches[0].quotes[0].sourceStale, true);
});
test('La consulta solo usa el endpoint público gratuito y respeta Retry-After', async () => {
  await assert.rejects(fetchFreeBoard(async (url, init) => {
    assert.equal(url, FREE_ODDS_URL);
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.headers?.['authorization'], undefined);
    return new Response('', { status: 429, headers: { 'retry-after': '120' } });
  }), (e: unknown) => e instanceof FeedError && e.retryAfterMs === 120000);
});
