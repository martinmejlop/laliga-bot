// Prueba acotada, pública y gratuita. No crea cuentas ni llama servicios de pago.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const dir = new URL(`../data/free-odds-probes/${new Date().toISOString().replaceAll(':', '-')}/`, import.meta.url);
await mkdir(dir, { recursive: true });

async function get(path) {
  const requestedAt = new Date().toISOString();
  const response = await fetch(`https://moviodds.com${path}`, {
    signal: AbortSignal.timeout(30000), redirect: 'error', headers: { 'accept-encoding': 'gzip', 'user-agent': 'LaLigaAdvisor/0.1 personal-source-check' }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}, Retry-After=${response.headers.get('retry-after') ?? 'none'}`);
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 8000000) throw new Error('Muestra excede 8 MB');
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const raw = Buffer.concat(chunks);
  return { requestedAt, receivedAt: new Date().toISOString(), url: `https://moviodds.com${path}`, bytes: size,
    sha256: createHash('sha256').update(raw).digest('hex'), data: JSON.parse(raw.toString('utf8')) };
}
const catalog = await get('/catalog?site=com');
const fixtures = catalog.data.fixtures ?? [];
const spanishLeagues = [...new Set(fixtures.map(f => f.league).filter(l => /spain|liga|primera/i.test(l)))].sort();
const laliga = f => ['Spain Primera Liga', 'Spain La Liga', 'Spain Primera Division', 'La Liga', 'LaLiga'].includes(f.league) && (!f.sport || f.sport === 'soccer');
const odds = await get('/odds?sport=soccer&groups=40&site=com');
const matches = (odds.data.matches ?? []).filter(laliga);
const summary = { checkedAt: new Date().toISOString(), service: 'MoviOdds public no-key', site: 'com', paidCalls: false,
  catalog: { ...catalog, data: undefined, total: fixtures.length, spanishLeagues, laliga: fixtures.filter(laliga) },
  odds: { ...odds, data: undefined, envelopeKeys: Object.keys(odds.data), serverTime: odds.data.server_time ?? null,
    warming: odds.data.warming ?? false, total: odds.data.matches?.length ?? null, laliga: matches,
    sampleOther: (odds.data.matches ?? []).filter(m => !laliga(m)).slice(0, 1) },
  limitations: ['Sin contraste contra la cuenta regional de Bet365.', 'Una consulta no demuestra actualización continua ni disponibilidad sostenida.', 'ts es último cambio; vigencia por group_status.polled_at.'] };
await writeFile(new URL('probe.json', dir), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ directory: fileURLToPath(dir), checkedAt: summary.checkedAt, totalFixtures: fixtures.length, spanishLeagues,
  laligaFixtures: summary.catalog.laliga.length, laligaOddsMatches: matches.length, envelopeKeys: summary.odds.envelopeKeys, serverTime: summary.odds.serverTime,
  laligaSample: matches.slice(0, 2), otherSample: summary.odds.sampleOther }, null, 2));
