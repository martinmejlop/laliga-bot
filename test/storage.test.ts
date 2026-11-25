import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { Store, StoreError } from '../src/storage/store.ts';
import { importArchivedBoard, registerObservedSources, MOVIODDS_SOURCE } from '../src/storage/import-board.ts';
import type { Quote } from '../src/odds/freshness.ts';

const received = Date.UTC(2026,10,11,0,0,0);
function memory(t: TestContext) {
  const store = new Store(':memory:'); t.after(() => store.close());
  store.registerSource('test','Fuente controlada','https://example.org/data','Datos de prueba');
  const home = store.ensureTeam('Equipo A'), away = store.ensureTeam('Equipo B');
  store.bindTeam('test','A',home); store.bindTeam('test','B',away);
  const fixture = store.ensureFixture('test','event-1','2026-27',home,away);
  return {store,home,away,fixture};
}
const captureInput = (key = 'one', at = received, rawText = '{"test":true}') => ({
  sourceId:'test',ingestionKey:key,url:'https://example.org/data',format:'test-json',rawText,
  requestedAt:at-10,receivedAt:at,sourceAsOf:at-20
});
const quote = (at = received, price = 2): Quote => ({
  eventId:'event-1',marketId:'40:40',selectionId:'selection-1',bookmaker:'bet365',competition:'LaLiga',period:'full_time_regulation',line:null,
  price,sourceUpdatedAt:at-200,sourceConfirmedAt:at-20,receivedAt:at,requestedAt:at-10,kickoffAt:received+86400000,suspended:false,regionVerified:false
});
function observation(store: Store, captureId: string, fixtureId: string, at = received, price = 2, suspended = false) {
  store.observeFixture({captureId,fixtureId,kickoffAt:received+86400000,status:'scheduled'});
  return store.observeQuote(captureId,fixtureId,{...quote(at,price),suspended});
}
const code = (expected: string) => (error: unknown) => error instanceof StoreError && error.code === expected;

test('La misma muestra, equipos, partido y cuota se guardan una sola vez con el original y su hash', t => {
  const {store,fixture,home,away} = memory(t);
  const cap = store.capture(captureInput());
  const row = observation(store,cap,fixture);
  assert.equal(store.capture(captureInput()),cap);
  assert.equal(store.ensureFixture('test','event-1','2026-27',home,away),fixture);
  assert.equal(observation(store,cap,fixture),row);
  const summary = store.summary();
  assert.equal(summary.counts.captures,1); assert.equal(summary.counts.fixtures,1); assert.equal(summary.counts.odds_observations,1);
  const evidence = store.evidence(cap);
  assert.equal(evidence.raw_text,captureInput().rawText);
  assert.equal(evidence.sha256,createHash('sha256').update(captureInput().rawText).digest('hex'));
  assert.equal(evidence.received_at,received); assert.equal(evidence.source_as_of,received-20);
  assert.equal(summary.integrity,'ok'); assert.equal(summary.foreignKeyErrors,0);
});

test('Una cuota nueva conserva la anterior, sus horas, suspensión y verificación regional', t => {
  const {store,fixture} = memory(t);
  const first = store.capture(captureInput()); observation(store,first,fixture);
  const second = store.capture(captureInput('two',received+1000,'{"test":"second"}'));
  observation(store,second,fixture,received+1000,1.8,true);
  const history = store.quoteHistory(fixture);
  assert.deepEqual(history.map(x => x.price),[2,1.8]);
  assert.deepEqual(history.map(x => x.region_verified),[0,0]);
  assert.deepEqual(history.map(x => x.suspended),[0,1]);
  assert.deepEqual(history.map(x => x.source_confirmed_at),[received-20,received+980]);
  assert.throws(() => store.observeQuote(first,fixture,quote(received,3)),code('EVIDENCE_CONFLICT'));
  assert.deepEqual(store.quoteHistory(fixture).map(x => x.price),[2,1.8]);
});

test('La consulta histórica excluye observaciones incorporadas después del instante consultado', async t => {
  const {store,fixture} = memory(t);
  const first = store.capture(captureInput()); observation(store,first,fixture);
  const cutoff = Date.now();
  await new Promise(resolve => setTimeout(resolve,5));
  // Una importación tardía conserva su hora original, pero no existía en el archivo a cutoff.
  const late = store.capture(captureInput('late',received+1000,'{"late":true}'));
  observation(store,late,fixture,received+1000,1.5);
  assert.deepEqual(store.quoteHistory(fixture,cutoff).map(x => x.price),[2]);
  assert.equal(store.fixtureHistory(fixture,cutoff).length,1);
  assert.deepEqual(store.quoteHistory(fixture).map(x => x.price),[2,1.5]);
  assert.equal(store.quoteHistory(fixture,received-1).length,0);
});

test('Reutilizar una clave de captura con contenido diferente revierte el lote y deja una incidencia', t => {
  const {store} = memory(t);
  store.capture(captureInput());
  assert.throws(() => store.capture(captureInput('one',received,'{"changed":true}')),code('EVIDENCE_CONFLICT'));
  assert.equal(store.summary().counts.captures,1); assert.equal(store.summary().counts.payloads,1);
  assert.equal(store.issues().at(-1)?.code,'EVIDENCE_CONFLICT');
});

test('Los nombres ambiguos y los identificadores de otro partido no se unen por aproximación', t => {
  const {store,fixture,home,away} = memory(t);
  assert.equal(store.resolveTeam('test','  á  '),home);
  assert.throws(() => store.resolveTeam('test','Equipo parecido'),code('UNMAPPED_TEAM'));
  assert.throws(() => store.bindTeam('test','A',away),code('AMBIGUOUS_TEAM'));
  const other = store.ensureTeam('Equipo C');
  assert.throws(() => store.ensureFixture('test','event-1','2026-27',home,other),code('EVIDENCE_CONFLICT'));
  assert.equal(store.summary().counts.fixtures,1); assert.equal(store.fixtureByExternal('test','event-1'),fixture);
  const cap = store.capture(captureInput()); observation(store,cap,fixture);
  assert.throws(() => store.observeQuote(cap,fixture,{...quote(),eventId:'other'}),code('QUOTE_MAPPING_CONFLICT'));
  assert.throws(() => store.observeQuote(cap,fixture,{...quote(),kickoffAt:received+100}),code('QUOTE_MAPPING_CONFLICT'));
  assert.equal(store.summary().counts.odds_observations,1);
  assert.ok(store.issues().length>=4);
});

test('Las fechas desconocidas son nulas y los resultados y calendarios incoherentes se rechazan', t => {
  const {store,fixture} = memory(t); const cap = store.capture(captureInput());
  store.observeFixture({captureId:cap,fixtureId:fixture,dateLabel:'2026-11-22',status:'unknown'});
  assert.equal(store.fixtureHistory(fixture)[0].kickoff_at,null);
  assert.throws(() => store.observeFixture({captureId:cap,fixtureId:fixture,dateLabel:'2026-02-30',status:'unknown'}),code('INVALID_DATE'));
  assert.throws(() => store.observeFixture({captureId:cap,fixtureId:fixture,dateLabel:'2026-99-99',status:'unknown'}),code('INVALID_DATE'));
  assert.throws(() => store.observeFixture({captureId:cap,fixtureId:fixture,status:'finished'}),code('INVALID_SCORE'));
  assert.throws(() => store.observeFixture({captureId:cap,fixtureId:fixture,status:'scheduled',score:[1,0]}),code('INVALID_SCORE'));
  assert.throws(() => store.observeFixture({captureId:cap,fixtureId:fixture,kickoffAt:received+1000,status:'finished',score:[1,0]}),code('FUTURE_RESULT'));
  assert.throws(() => store.capture({...captureInput('bad'),requestedAt:received+1}),code('INVALID_TIME'));
  assert.throws(() => store.capture({...captureInput('future-news'),publishedAt:received+1}),code('INVALID_TIME'));
});

test('Las noticias se vinculan a equipos explícitos, mantienen versiones y no cambian una asociación anterior', t => {
  const {store,home,away} = memory(t); const cap = store.capture(captureInput());
  const input = {captureId:cap,url:'https://example.org/news#fragment',title:'Titular de prueba',publishedAt:received-1000,teamIds:[home]};
  const news = store.article(input);
  assert.equal(store.article({...input,url:'https://example.org/news'}),news);
  assert.deepEqual(store.articleTeams(news).map(x => x.id),[home]);
  assert.throws(() => store.article({...input,teamIds:[away]}),code('EVIDENCE_CONFLICT'));
  const second = store.capture(captureInput('two',received+1000));
  const updated = store.article({...input,captureId:second,title:'Titular corregido',teamIds:[home,away]});
  assert.notEqual(updated,news); assert.equal(store.summary().counts.articles,1); assert.equal(store.summary().counts.article_versions,2);
  assert.deepEqual(store.articleHistory('test',input.url).map(x => x.title),['Titular de prueba','Titular corregido']);
  assert.deepEqual(store.articleTeams(news).map(x => x.id),[home]);
  assert.throws(() => store.article({...input,url:'https://example.org/unknown',teamIds:['missing']}),code('UNKNOWN_TEAM'));
  assert.equal(store.summary().counts.articles,1);
  assert.throws(() => store.article({...input,url:'https://example.org/future',publishedAt:received+1}),code('FUTURE_NEWS'));
});

test('Estadísticas, versiones de modelos, predicciones e informes exigen procedencia y conservan sus versiones', t => {
  const {store,fixture,home} = memory(t); const cap = store.capture(captureInput());
  for (const kind of ['statistics','model','prediction','report'] as const) {
    const input = {kind,key:`test-${kind}-v1`,data:{example:true},captureIds:[cap],fixtureId:fixture,teamId:home};
    assert.equal(store.artifact(input),store.artifact(input));
    assert.deepEqual(JSON.parse(String(store.artifactByKey(kind,input.key)?.inputs_json)),[cap]);
    assert.throws(() => store.artifact({...input,data:{example:false}}),code('EVIDENCE_CONFLICT'));
  }
  assert.equal(store.summary().counts.artifacts,4); assert.equal(store.summary().counts.artifact_inputs,4);
  assert.throws(() => store.artifact({kind:'prediction',key:'without-evidence',data:{},captureIds:[]}),code('MISSING_PROVENANCE'));
  assert.throws(() => store.artifact({kind:'prediction',key:'unknown-evidence',data:{},captureIds:['missing']}),code('UNKNOWN_CAPTURE'));
  const third = store.ensureTeam('Equipo C');
  assert.throws(() => store.artifact({kind:'statistics',key:'wrong-team',data:{},captureIds:[cap],fixtureId:fixture,teamId:third}),code('INVALID_TEAM'));
});

test('Dos fuentes se unen al mismo partido y un aplazamiento no crea un segundo encuentro', t => {
  const {store,home,away,fixture} = memory(t);
  store.registerSource('calendar','Calendario controlado','https://example.org/calendar','Datos de prueba');
  assert.equal(store.ensureFixture('calendar','another-event-id','2026-27',home,away),fixture);
  const one = store.capture({...captureInput(),sourceId:'calendar'});
  store.observeFixture({captureId:one,fixtureId:fixture,kickoffAt:received+86400000,status:'scheduled'});
  const two = store.capture({...captureInput('postponed',received+1000),sourceId:'calendar'});
  store.observeFixture({captureId:two,fixtureId:fixture,status:'postponed'});
  const three = store.capture({...captureInput('rescheduled',received+2000),sourceId:'calendar'});
  store.observeFixture({captureId:three,fixtureId:fixture,kickoffAt:received+172800000,status:'scheduled'});
  const history = store.fixtureHistory(fixture);
  assert.equal(store.summary().counts.fixtures,1);
  assert.deepEqual(history.map(x => x.status),['scheduled','postponed','scheduled']);
  assert.deepEqual(history.map(x => x.kickoff_at),[received+86400000,null,received+172800000]);
});

test('La base se recupera al abrir de nuevo, permite lectura y protege el original de modificaciones', t => {
  const folder = mkdtempSync(join(tmpdir(),'laliga-storage-'));
  t.after(() => rmSync(folder,{recursive:true,force:true}));
  const path = join(folder,'test.sqlite');
  const store = new Store(path);
  store.registerSource('test','Fuente controlada','https://example.org/data','Datos de prueba');
  const cap = store.capture(captureInput()); store.close();
  const reopened = new Store(path,{readOnly:true});
  try { assert.equal(reopened.evidence(cap).raw_text,captureInput().rawText); assert.equal(reopened.summary().foreignKeyErrors,0); }
  finally { reopened.close(); }
  const raw = new DatabaseSync(path);
  try {
    raw.exec('PRAGMA foreign_keys=ON');
    assert.throws(() => raw.exec('UPDATE payloads SET raw_text=\'changed\''),/immutable/);
    assert.throws(() => raw.exec('DELETE FROM captures'),/immutable/);
    assert.throws(() => raw.prepare('INSERT INTO article_teams(version_id,team_id) VALUES(?,?)').run('missing','missing'),/FOREIGN KEY/);
  } finally { raw.close(); }
});

test('Una base ajena al proyecto se rechaza sin cambiar sus tablas', t => {
  const folder = mkdtempSync(join(tmpdir(),'laliga-foreign-'));
  t.after(() => rmSync(folder,{recursive:true,force:true}));
  const path = join(folder,'foreign.sqlite'); const db = new DatabaseSync(path);
  db.exec('CREATE TABLE unrelated(id INTEGER)'); db.close();
  assert.throws(() => new Store(path),/no pertenece/);
  const check = new DatabaseSync(path,{readOnly:true});
  try { assert.equal(check.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get()?.n,1); }
  finally { check.close(); }
});

function archivedBoard() {
  const q = {...quote(),eventId:'test-board-1'};
  return {requestedAt:q.requestedAt,receivedAt:q.receivedAt,serverTime:q.receivedAt-20,site:'com',regionVerified:false,
    matches:[{id:q.eventId,home:'Barcelona',away:'Real Madrid',kickoffAt:q.kickoffAt,refreshSeconds:1800,quotes:[q]}]};
}
test('El importador de capturas normalizadas es repetible y mantiene la advertencia regional', t => {
  const store = new Store(':memory:'); t.after(() => store.close()); registerObservedSources(store);
  const board = archivedBoard(), raw = JSON.stringify(board);
  const cap = importArchivedBoard(store,raw,'2026-27');
  assert.equal(importArchivedBoard(store,raw,'2026-27'),cap);
  const fixture = store.fixtureByExternal(MOVIODDS_SOURCE,'test-board-1')!;
  assert.equal(store.summary().counts.fixtures,1); assert.equal(store.summary().counts.odds_observations,1);
  assert.equal(store.quoteHistory(fixture)[0].region_verified,0);
  assert.equal(store.evidence(cap).format,'normalized-moviodds-board-v1');
  assert.equal(store.evidence(cap).raw_text,raw);
});

test('Un equipo sin correspondencia, selección duplicada o región alterada revierte toda la importación', t => {
  const store = new Store(':memory:'); t.after(() => store.close()); registerObservedSources(store);
  const wrong = archivedBoard(); wrong.matches[0].away = 'Equipo desconocido';
  assert.throws(() => importArchivedBoard(store,JSON.stringify(wrong),'2026-27'),code('UNMAPPED_TEAM'));
  const duplicate = archivedBoard(); duplicate.matches[0].quotes.push(duplicate.matches[0].quotes[0]);
  assert.throws(() => importArchivedBoard(store,JSON.stringify(duplicate),'2026-27'),code('DUPLICATE_QUOTE'));
  const regional = archivedBoard(); regional.matches[0].quotes[0].regionVerified = true;
  assert.throws(() => importArchivedBoard(store,JSON.stringify(regional),'2026-27'),code('INVALID_BOARD'));
  assert.equal(store.summary().counts.captures,0); assert.equal(store.summary().counts.fixtures,0); assert.equal(store.summary().counts.odds_observations,0);
  assert.equal(store.summary().counts.issues,3);
});
