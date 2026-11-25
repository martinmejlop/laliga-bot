// Comprueba almacenamiento con muestras reales ya archivadas. No hace peticiones ni genera apuestas.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../src/storage/store.ts';
import { registerObservedSources, importArchivedBoard, NEWS_SOURCE, MOVIODDS_SOURCE } from '../src/storage/import-board.ts';
import { ROOT, assertRuntime } from '../src/config.ts';

assertRuntime();
if (process.argv.length !== 2) throw new Error('Uso: npm.cmd run storage:check (sin argumentos).');
const directory = 'data/free-odds-checks/2026-11-11T18-47-36.518Z';
const paths = [1,2,3].map(n => `${directory}/sample-${n}.json`);
const rawBoards = paths.map(path => readFileSync(join(ROOT,path),'utf8'));
const audit = JSON.parse(readFileSync(join(ROOT,'docs/source-audit-t02.json'),'utf8'));
const rss = audit.results.find((row: any) => row.id === 'mundodeportivo-rss');
if (rss?.status !== 'sample-obtained' || rss.summary.sample.title !== 'Locura por ver al Barça') throw new Error('No se encuentra el metadato RSS revisado.');

const path = join(ROOT,'data/storage-validation.sqlite');
const store = new Store(path);
try {
  registerObservedSources(store);
  const importNews = () => store.atomic(() => {
    const captureId = store.capture({sourceId:NEWS_SOURCE,ingestionKey:`audit:${audit.collectedAt}`,
      url:rss.url,format:'rss-audit-record-v1',rawText:JSON.stringify(rss,null,2),
      requestedAt:Date.parse(rss.checkedAt),receivedAt:Date.parse(audit.collectedAt),publishedAt:Date.parse(rss.summary.sample.publishedAt)});
    const teamId = store.resolveTeam(NEWS_SOURCE,'Barça');
    const versionId = store.article({captureId,url:rss.summary.sample.url,title:rss.summary.sample.title,
      publishedAt:Date.parse(rss.summary.sample.publishedAt),teamIds:[teamId]});
    assert.deepEqual(store.articleTeams(versionId).map(row => row.canonical_name),['FC Barcelona']);
    return {captureId,versionId};
  });
  const captures = rawBoards.map(raw => importArchivedBoard(store,raw,'2026-27'));
  const news = importNews();
  const initial = store.summary();
  rawBoards.forEach((raw,i) => assert.equal(importArchivedBoard(store,raw,'2026-27'),captures[i]));
  assert.deepEqual(importNews(),news);
  assert.deepEqual(store.summary(),initial);
  assert.equal(initial.counts.fixtures,20); assert.equal(initial.counts.odds_observations,180);
  assert.equal(initial.counts.fixture_observations,60); assert.equal(initial.counts.article_versions,1);
  assert.equal(initial.integrity,'ok'); assert.equal(initial.foreignKeyErrors,0);
  const fixtureId = store.fixtureByExternal(MOVIODDS_SOURCE,'203186591')!;
  const history = store.quoteHistory(fixtureId);
  assert.equal(history.length,9); assert.ok(history.every(row => row.region_verified === 0));
  captures.forEach((id,i) => assert.equal(store.evidence(id).raw_text,rawBoards[i]));
  const result = {
    task:'T03',checkedAt:new Date().toISOString(),database:'data/storage-validation.sqlite',
    productionDatabase:'data/laliga.sqlite (sin cuotas de prueba)',summary:initial,
    assertions:{duplicateImportUnchanged:true,rawNormalizedSamplesPreserved:true,newsTeam:'FC Barcelona',
      unverifiedRegionPreserved:true,bet365SpainVerified:false,realPriceChangesObserved:false},
    oddsCaptures:captures.map((id,i) => ({id,file:paths[i],sha256:store.evidence(id).sha256,
      receivedAt:new Date(Number(store.evidence(id).received_at)).toISOString(),format:store.evidence(id).format})),
    news:{...news,format:'rss-audit-record-v1',scope:'Metadatos de la auditoría de T02; no XML original ni artículo completo.'},
    note:'Datos archivados: no confirman precios actuales, equivalencia con Bet365 España ni oportunidades. Cambios de precio y conflictos se comprueban con ejemplos controlados en tests aislados.'
  };
  writeFileSync(join(ROOT,'docs/storage-evidence.json'),JSON.stringify(result,null,2)+'\n','utf8');
  console.log(JSON.stringify(result,null,2));
} finally { store.close(); }
