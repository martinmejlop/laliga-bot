// Auditoría puntual de fuentes públicas. No es el recolector de producción de T04/T09.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const output = new URL(`../data/source-audits/${new Date().toISOString().replaceAll(':', '-')}/`, import.meta.url);
await mkdir(output, { recursive: true });
const sources = [
  ...['2021-22', '2022-23', '2023-24', '2024-25', '2025-26', '2026-27'].map(season => ({
    id: `openfootball-${season}`, kind: 'matches', url: `https://raw.githubusercontent.com/openfootball/football.json/master/${season}/es.1.json`
  })),
  { id: 'openfootball-license', kind: 'license', url: 'https://raw.githubusercontent.com/openfootball/football.json/master/LICENSE.md' },
  { id: 'marca-rss', kind: 'rss', url: 'https://e00-marca.uecdn.es/rss/futbol/primera-division.xml' },
  { id: 'mundodeportivo-rss', kind: 'rss', url: 'https://www.mundodeportivo.com/rss/futbol/laliga.xml' },
  { id: 'espn-calendar', kind: 'calendar', url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/scoreboard?dates=20261122' },
  { id: 'espn-current-results', kind: 'calendar', url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/scoreboard?dates=20261108' }
];
const only = process.argv.slice(2);
if (only.length > 1 || (only.length && !sources.some(s => only[0] === `--only=${s.id}`))) throw new Error('Filtro de fuente inválido');
const selectedSources = only.length ? sources.filter(s => only[0] === `--only=${s.id}`) : sources;

const decode = text => text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
const field = (xml, name) => decode(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1]?.trim() ?? '');
const validScore = score => Array.isArray(score) && score.length === 2 && score.every(n => Number.isInteger(n) && n >= 0);
const results = [];
for (let i = 0; i < selectedSources.length; i += 3) {
  const group = await Promise.all(selectedSources.slice(i, i + 3).map(async source => {
    const checkedAt = new Date().toISOString();
    try {
      const response = await fetch(source.url, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'LaLigaAdvisor-SourceAudit/0.1 (personal prototype)' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = await response.text();
      if (Buffer.byteLength(raw) > 3_000_000) throw new Error('Muestra demasiado grande');
      const result = { ...source, checkedAt, finalUrl: response.url, status: 'sample-obtained', sha256: createHash('sha256').update(raw).digest('hex'), bytes: Buffer.byteLength(raw), lastModified: response.headers.get('last-modified') };
      if (source.kind === 'matches') {
        const data = JSON.parse(raw);
        if (!Array.isArray(data.matches) || !data.matches.length) throw new Error('Sin partidos');
        const matches = data.matches;
        const cutoff = checkedAt.slice(0, 10);
        const scored = matches.filter(m => validScore(m.score?.ft));
        result.summary = {
          name: data.name, matches: matches.length, scored: scored.length,
          pastUnscored: matches.filter(m => m.date < cutoff && !validScore(m.score?.ft)).length,
          futureScored: scored.filter(m => m.date > cutoff).length,
          missingKickoffTime: matches.filter(m => !m.time).length,
          explicitTimezone: false,
          teams: new Set(matches.flatMap(m => [m.team1, m.team2])).size,
          latestScoredDate: scored.map(m => m.date).sort().at(-1) ?? null,
          examples: matches.slice(0, 2),
          nextExamples: matches.filter(m => m.date >= cutoff).slice(0, 2)
        };
        // El conjunto declara CC0; conservar el original permite auditar la muestra.
        await writeFile(new URL(`${source.id}.json`, output), raw);
      } else if (source.kind === 'license') {
        if (!raw.startsWith('CC0 1.0 Universal')) throw new Error('Licencia inesperada');
        result.summary = { license: 'CC0-1.0' };
        await writeFile(new URL('LICENSE-openfootball.txt', output), raw);
      } else if (source.kind === 'rss') {
        const items = [...raw.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)];
        if (!items.length) throw new Error('No se encontraron elementos RSS');
        const first = items[0][1];
        const dates = items.map(item => Date.parse(field(item[1], 'pubDate'))).filter(Number.isFinite).sort((a, b) => a - b);
        result.summary = { items: items.length, newestPublishedAt: dates.length ? new Date(dates.at(-1)).toISOString() : null,
          oldestPublishedAt: dates.length ? new Date(dates[0]).toISOString() : null, invalidPublicationDates: items.length - dates.length, sample: {
          title: field(first, 'title').split(/\s+/).slice(0, 18).join(' '),
          url: field(first, 'link'), publishedAt: field(first, 'pubDate'),
          scope: 'Metadatos RSS; no se ha leído el artículo completo ni verificado su contenido.'
        } };
      } else {
        const data = JSON.parse(raw);
        if (!Array.isArray(data.events)) throw new Error('Sin campo events');
        result.summary = { events: data.events.length, completed: data.events.filter(e => e.status?.type?.completed === true).length,
          examples: data.events.slice(0, 2).map(e => ({ id: e.id, date: e.date, name: e.name, status: e.status?.type?.name, competitors: e.competitions?.[0]?.competitors?.map(c => ({ id: c.team?.id, name: c.team?.displayName, homeAway: c.homeAway, score: c.score })) })) };
      }
      return result;
    } catch (error) {
      return { ...source, checkedAt, status: 'unavailable', error: error.message, cause: error.cause?.code ?? null };
    }
  }));
  results.push(...group);
}
const audit = { version: 1, generatedAt: new Date().toISOString(), purpose: 'T02: comprobar muestras; no demuestra cobertura, licencia ni actualización de campos no observados.', results };
await writeFile(new URL('audit.json', output), JSON.stringify(audit, null, 2));
console.log(JSON.stringify({ directory: fileURLToPath(output), ...audit }, null, 2));
if (!results.some(r => r.status === 'sample-obtained')) process.exitCode = 2;
