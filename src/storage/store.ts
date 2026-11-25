import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { APPLICATION_ID, SCHEMA_VERSION, SCHEMA, IMMUTABLE_TABLES } from './schema.ts';
import type { Quote } from '../odds/freshness.ts';

type Row = Record<string, string | number | null>;
export class StoreError extends Error {
  code: string; context: object;
  constructor(code: string, message: string, context: object = {}) { super(message); this.code = code; this.context = context; }
}
export function nameKey(name: string): string {
  return text(name, 'nombre').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es').replace(/\s+/g, ' ').trim();
}
function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw new StoreError('INVALID_INPUT', `${name} inválido.`);
  return value.trim();
}
function epoch(value: unknown, name: string, nullable = true): number | null {
  if (value === undefined || value === null) { if (nullable) return null; throw new StoreError('INVALID_TIME', `Falta ${name}.`); }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new StoreError('INVALID_TIME', `${name} inválido.`);
  return value;
}
function json(value: unknown): string {
  const result = JSON.stringify(value, (_key, v) => {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new StoreError('INVALID_JSON', 'Número no finito en los datos.');
    return v;
  });
  if (result === undefined) throw new StoreError('INVALID_JSON', 'Datos vacíos.');
  return result;
}
export interface CaptureInput {
  sourceId: string; ingestionKey: string; url: string; format: string; rawText: string;
  requestedAt?: number | null; receivedAt: number; publishedAt?: number | null; sourceAsOf?: number | null;
}
export interface StoreSummary {
  schemaVersion: number; integrity: string; foreignKeyErrors: number; counts: Record<string, number>;
}

export class Store {
  #db: DatabaseSync;
  #inTransaction = false;
  #readOnly: boolean;
  constructor(path: string, options: { readOnly?: boolean } = {}) {
    this.#readOnly = options.readOnly === true;
    if (path !== ':memory:' && !this.#readOnly) mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path, { timeout: 5000, readOnly: this.#readOnly });
    try {
      const version = Number(this.#db.prepare('PRAGMA user_version').get()!['user_version']);
      const app = Number(this.#db.prepare('PRAGMA application_id').get()!['application_id']);
      const count = Number(this.#db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get()!['n']);
      if (version === 0 && count === 0 && app === 0 && !this.#readOnly) {
        this.#db.exec('BEGIN IMMEDIATE');
        try {
          this.#db.exec(SCHEMA);
          for (const table of IMMUTABLE_TABLES) {
            for (const operation of ['UPDATE', 'DELETE']) {
              this.#db.exec(`CREATE TRIGGER immutable_${table}_${operation.toLowerCase()} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'Evidence is immutable'); END`);
            }
          }
          this.#db.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${SCHEMA_VERSION}; COMMIT`);
        } catch (e) { this.#db.exec('ROLLBACK'); throw e; }
      } else if (version !== SCHEMA_VERSION || app !== APPLICATION_ID) {
        throw new Error('La base no pertenece a LaLiga o su versión no está admitida.');
      }
      this.#db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      if (!this.#readOnly) this.#db.exec('PRAGMA journal_mode=WAL;');
    } catch (e) { this.#db.close(); throw e; }
  }
  close() { this.#db.close(); }
  #get(sql: string, ...params: (string | number | null)[]): Row | undefined { return this.#db.prepare(sql).get(...params) as Row | undefined; }
  #raise(code: string, message: string, context: object = {}): never {
    const error = new StoreError(code, message, context);
    if (!this.#inTransaction) this.issue(error);
    throw error;
  }
  issue(error: StoreError) {
    if (this.#readOnly) return;
    this.#db.prepare('INSERT INTO issues(code,message,context_json,recorded_at) VALUES(?,?,?,?)').run(error.code,error.message,json(error.context),Date.now());
  }
  atomic<T>(fn: () => T): T {
    if (this.#inTransaction) return fn();
    this.#db.exec('BEGIN IMMEDIATE'); this.#inTransaction = true;
    try { const result = fn(); this.#db.exec('COMMIT'); return result; }
    catch (error) {
      this.#db.exec('ROLLBACK');
      this.issue(error instanceof StoreError ? error : new StoreError('IMPORT_FAILED', 'No se pudo guardar el lote; se ha revertido.', {}));
      throw error;
    } finally { this.#inTransaction = false; }
  }
  #put(table: string, keyColumns: string[], data: Row): string {
    const where = keyColumns.map(k => `${k} IS ?`).join(' AND ');
    const previous = this.#get(`SELECT * FROM ${table} WHERE ${where}`, ...keyColumns.map(k => data[k]));
    if (previous) {
      if (Object.keys(data).some(k => !['id','recorded_at'].includes(k) && previous[k] !== data[k])) {
        this.#raise('EVIDENCE_CONFLICT', `El registro de ${table} ya existe con otro contenido.`, { table, keys: Object.fromEntries(keyColumns.map(k => [k,data[k]])) });
      }
      return String(previous.id ?? '');
    }
    const columns = Object.keys(data);
    this.#db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...columns.map(k => data[k]));
    return String(data.id ?? '');
  }
  registerSource(id: string, name: string, url: string, rights: string): string {
    return this.#put('sources',['id'],{id:text(id,'fuente'),name:text(name,'fuente'),url:text(url,'URL'),rights:text(rights,'derechos'),recorded_at:Date.now()});
  }
  capture(input: CaptureInput): string {
    return this.atomic(() => {
      const sourceId = text(input.sourceId,'fuente');
      if (!this.#get('SELECT id FROM sources WHERE id=?',sourceId)) this.#raise('UNKNOWN_SOURCE','Fuente no registrada.',{sourceId});
      const received = epoch(input.receivedAt,'recepción',false)!;
      const requested = epoch(input.requestedAt,'solicitud');
      const published = epoch(input.publishedAt,'publicación');
      const sourceAsOf = epoch(input.sourceAsOf,'marca de origen');
      if ((requested !== null && requested > received) || (published !== null && published > received) || (sourceAsOf !== null && sourceAsOf > received)) this.#raise('INVALID_TIME','Las marcas de tiempo no son coherentes.');
      if (typeof input.rawText !== 'string' || !input.rawText.length || Buffer.byteLength(input.rawText) > 8000000) this.#raise('INVALID_PAYLOAD','Muestra vacía o demasiado grande.');
      const hash = createHash('sha256').update(input.rawText).digest('hex');
      const payload = this.#put('payloads',['source_id','source_url','format','sha256'],{
        id:randomUUID(),source_id:sourceId,source_url:text(input.url,'URL'),format:text(input.format,'formato'),sha256:hash,raw_text:input.rawText,recorded_at:Date.now()});
      return this.#put('captures',['source_id','ingestion_key'],{id:randomUUID(),source_id:sourceId,ingestion_key:text(input.ingestionKey,'clave de importación'),payload_id:payload,
        requested_at:requested,received_at:received,published_at:published,source_as_of:sourceAsOf,recorded_at:Date.now()});
    });
  }
  ensureTeam(name: string): string {
    const key = nameKey(name);
    const previous = this.#get('SELECT id FROM teams WHERE name_key=?',key);
    if (previous) return String(previous.id);
    return this.#put('teams',['name_key'],{id:randomUUID(),name_key:key,canonical_name:text(name,'equipo'),recorded_at:Date.now()});
  }
  bindTeam(sourceId: string, alias: string, teamId: string) {
    if (!this.#get('SELECT id FROM sources WHERE id=?',sourceId) || !this.#get('SELECT id FROM teams WHERE id=?',teamId)) this.#raise('UNKNOWN_ID','Fuente o equipo no registrado.');
    const key = nameKey(alias);
    const previous = this.#get('SELECT team_id FROM team_aliases WHERE source_id=? AND alias_key=?',sourceId,key);
    if (previous && previous.team_id !== teamId) this.#raise('AMBIGUOUS_TEAM','El nombre ya está vinculado a otro equipo.',{sourceId,alias});
    if (previous) return;
    this.#put('team_aliases',['source_id','alias_key'],{source_id:sourceId,alias_key:key,alias_label:text(alias,'alias'),team_id:teamId,recorded_at:Date.now()});
  }
  resolveTeam(sourceId: string, alias: string): string {
    const row = this.#get('SELECT team_id FROM team_aliases WHERE source_id=? AND alias_key=?',sourceId,nameKey(alias));
    if (!row) this.#raise('UNMAPPED_TEAM','Equipo sin correspondencia explícita.',{sourceId,alias});
    return String(row.team_id);
  }
  ensureFixture(sourceId: string, externalId: string, season: string, homeId: string, awayId: string): string {
    return this.atomic(() => {
      if (!this.#get('SELECT id FROM sources WHERE id=?',sourceId)) this.#raise('UNKNOWN_SOURCE','Fuente no registrada.');
      if (!/^\d{4}-\d{2}$/.test(season) || Number(season.slice(-2)) !== (Number(season.slice(0,4))+1)%100) this.#raise('INVALID_SEASON','Temporada no admitida.');
      if (homeId === awayId || !this.#get('SELECT id FROM teams WHERE id=?',homeId) || !this.#get('SELECT id FROM teams WHERE id=?',awayId)) this.#raise('INVALID_TEAMS','Participantes inválidos.');
      const id = this.#put('fixtures',['competition','season','home_id','away_id'],{id:randomUUID(),competition:'LaLiga',season,home_id:homeId,away_id:awayId,recorded_at:Date.now()});
      this.#put('fixture_aliases',['source_id','external_id'],{source_id:sourceId,external_id:text(externalId,'partido externo'),fixture_id:id,recorded_at:Date.now()});
      return id;
    });
  }
  #capture(id: string): Row {
    const row = this.#get('SELECT * FROM captures WHERE id=?',id);
    if (!row) this.#raise('UNKNOWN_CAPTURE','Captura no registrada.');
    return row;
  }
  #fixture(id: string): Row {
    const row = this.#get('SELECT * FROM fixtures WHERE id=?',id);
    if (!row) this.#raise('UNKNOWN_FIXTURE','Partido no registrado.');
    return row;
  }
  observeFixture(input: {captureId:string; fixtureId:string; kickoffAt?:number|null; dateLabel?:string|null; status:'scheduled'|'finished'|'postponed'|'unknown'; score?:[number,number]|null; details?:unknown}): string {
    const capture = this.#capture(input.captureId); this.#fixture(input.fixtureId);
    if (!this.#get('SELECT fixture_id FROM fixture_aliases WHERE source_id=? AND fixture_id=?',String(capture.source_id),input.fixtureId)) this.#raise('FIXTURE_MAPPING_CONFLICT','El partido no está vinculado a la fuente de la captura.');
    const kickoff = epoch(input.kickoffAt,'inicio');
    if (input.dateLabel) {
      const date = new Date(`${input.dateLabel}T12:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateLabel) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== input.dateLabel) this.#raise('INVALID_DATE','Fecha de calendario inválida.');
    }
    if (input.score && (input.score.length !== 2 || input.score.some(n => !Number.isSafeInteger(n) || n < 0))) this.#raise('INVALID_SCORE','Marcador inválido.');
    if ((input.status === 'finished' && !input.score) || (input.status === 'scheduled' && input.score)) this.#raise('INVALID_SCORE','El estado y el marcador no son coherentes.');
    if (input.status === 'finished' && kickoff !== null && kickoff > Number(capture.received_at)) this.#raise('FUTURE_RESULT','Un partido futuro no puede figurar terminado.');
    return this.#put('fixture_observations',['capture_id','fixture_id'],{id:randomUUID(),capture_id:input.captureId,fixture_id:input.fixtureId,kickoff_at:kickoff,date_label:input.dateLabel??null,status:input.status,
      home_score:input.score?.[0]??null,away_score:input.score?.[1]??null,details_json:json(input.details??{}),recorded_at:Date.now()});
  }
  observeQuote(captureId: string, fixtureId: string, quote: Quote): string {
    const capture = this.#capture(captureId); this.#fixture(fixtureId);
    const alias = this.#get('SELECT fixture_id FROM fixture_aliases WHERE source_id=? AND external_id=?',String(capture.source_id),quote.eventId);
    if (!alias || alias.fixture_id !== fixtureId) this.#raise('QUOTE_MAPPING_CONFLICT','La cuota pertenece a otro partido o fuente.');
    const observation = this.#get('SELECT kickoff_at FROM fixture_observations WHERE capture_id=? AND fixture_id=?',captureId,fixtureId);
    if (!observation || quote.kickoffAt !== observation.kickoff_at) this.#raise('QUOTE_MAPPING_CONFLICT','La hora del partido no coincide con la observación de esta captura.');
    if (quote.bookmaker !== 'bet365' || quote.competition !== 'LaLiga' || !Number.isFinite(quote.price) || quote.price <= 1 || (quote.line !== null && !Number.isFinite(quote.line))) this.#raise('INVALID_QUOTE','Cuota o mercado inválidos.');
    if (typeof quote.suspended !== 'boolean' || typeof quote.regionVerified !== 'boolean' || quote.receivedAt !== capture.received_at || quote.requestedAt !== capture.requested_at) this.#raise('INVALID_QUOTE','Estado o tiempos de la cuota incompatibles con su captura.');
    const updated = epoch(quote.sourceUpdatedAt,'cambio'); const confirmed = epoch(quote.sourceConfirmedAt,'confirmación');
    if ((updated !== null && updated > Number(capture.received_at)) || (updated !== null && confirmed !== null && updated > confirmed) || (confirmed !== null && confirmed > Number(capture.received_at))) this.#raise('INVALID_TIME','Fechas de la cuota inconsistentes.');
    return this.#put('odds_observations',['capture_id','fixture_id','market_id','period','selection_id','line_key'],{
      id:randomUUID(),capture_id:captureId,fixture_id:fixtureId,market_id:text(quote.marketId,'mercado'),period:text(quote.period,'periodo'),selection_id:text(quote.selectionId,'selección'),
      line_key:quote.line===null?'none':String(quote.line),price:quote.price,source_updated_at:updated,source_confirmed_at:confirmed,
      suspended:quote.suspended?1:0,region_verified:quote.regionVerified?1:0,quote_json:json(quote),recorded_at:Date.now()});
  }
  article(input: {captureId:string; url:string; title:string; excerpt?:string; publishedAt?:number|null; teamIds:string[]}): string {
    return this.atomic(() => {
      const capture = this.#capture(input.captureId);
      const url = new URL(input.url); if (!['http:','https:'].includes(url.protocol) || url.username || url.password) this.#raise('INVALID_URL','URL de noticia inválida.');
      url.hash = '';
      const published = epoch(input.publishedAt,'publicación');
      if (published !== null && published > Number(capture.received_at)) this.#raise('FUTURE_NEWS','La noticia figura publicada después de recibirse.');
      const article = this.#put('articles',['source_id','canonical_url'],{id:randomUUID(),source_id:capture.source_id,canonical_url:url.href,recorded_at:Date.now()});
      const teams = [...new Set(input.teamIds)].sort();
      const id = this.#put('article_versions',['article_id','capture_id'],{id:randomUUID(),article_id:article,capture_id:input.captureId,title:text(input.title,'titular'),excerpt:input.excerpt??'',published_at:published,team_ids_json:json(teams),recorded_at:Date.now()});
      for (const teamId of teams) {
        if (!this.#get('SELECT id FROM teams WHERE id=?',teamId)) this.#raise('UNKNOWN_TEAM','Equipo de noticia no registrado.');
        this.#put('article_teams',['version_id','team_id'],{version_id:id,team_id:teamId});
      }
      return id;
    });
  }
  artifact(input: {kind:'statistics'|'model'|'prediction'|'report'; key:string; data:unknown; captureIds:string[]; fixtureId?:string; teamId?:string}): string {
    return this.atomic(() => {
      if (!input.captureIds.length) this.#raise('MISSING_PROVENANCE','El dato necesita capturas de origen.');
      const inputs = [...new Set(input.captureIds)].sort(); inputs.forEach(id => this.#capture(id));
      if (input.fixtureId) {
        const fixture = this.#fixture(input.fixtureId);
        if (input.teamId && ![fixture.home_id,fixture.away_id].includes(input.teamId)) this.#raise('INVALID_TEAM','La estadística no corresponde a un participante.');
      }
      const id = this.#put('artifacts',['kind','version_key'],{id:randomUUID(),kind:input.kind,version_key:text(input.key,'versión'),fixture_id:input.fixtureId??null,team_id:input.teamId??null,data_json:json(input.data),inputs_json:json(inputs),recorded_at:Date.now()});
      for (const captureId of inputs) this.#put('artifact_inputs',['artifact_id','capture_id'],{artifact_id:id,capture_id:captureId});
      return id;
    });
  }
  quoteHistory(fixtureId: string, knownAt = Date.now()): Row[] {
    epoch(knownAt,'consulta histórica',false);
    return this.#db.prepare('SELECT o.*,c.received_at,c.source_id,p.sha256 FROM odds_observations o JOIN captures c ON c.id=o.capture_id JOIN payloads p ON p.id=c.payload_id WHERE o.fixture_id=? AND c.received_at<=? AND o.recorded_at<=? ORDER BY c.received_at,o.recorded_at,o.id').all(fixtureId,knownAt,knownAt) as Row[];
  }
  fixtureByExternal(sourceId: string, externalId: string): string | null {
    const row = this.#get('SELECT fixture_id FROM fixture_aliases WHERE source_id=? AND external_id=?',sourceId,externalId);
    return row ? String(row.fixture_id) : null;
  }
  fixtureHistory(fixtureId: string, knownAt = Date.now()): Row[] {
    epoch(knownAt,'consulta histórica',false);
    return this.#db.prepare('SELECT o.*,c.received_at FROM fixture_observations o JOIN captures c ON c.id=o.capture_id WHERE o.fixture_id=? AND c.received_at<=? AND o.recorded_at<=? ORDER BY c.received_at,o.id').all(fixtureId,knownAt,knownAt) as Row[];
  }
  articleTeams(versionId: string): Row[] {
    return this.#db.prepare('SELECT t.id,t.canonical_name FROM teams t JOIN article_teams a ON a.team_id=t.id WHERE a.version_id=? ORDER BY t.canonical_name').all(versionId) as Row[];
  }
  articleHistory(sourceId: string, url: string, knownAt = Date.now()): Row[] {
    epoch(knownAt,'consulta histórica',false);
    const normalized = new URL(url); normalized.hash = '';
    return this.#db.prepare('SELECT v.*,a.canonical_url,c.received_at FROM article_versions v JOIN articles a ON a.id=v.article_id JOIN captures c ON c.id=v.capture_id WHERE a.source_id=? AND a.canonical_url=? AND c.received_at<=? AND v.recorded_at<=? ORDER BY c.received_at,v.id').all(sourceId,normalized.href,knownAt,knownAt) as Row[];
  }
  artifactByKey(kind: string, key: string): Row | null {
    return this.#get('SELECT * FROM artifacts WHERE kind=? AND version_key=?',kind,key) ?? null;
  }
  evidence(captureId: string): Row {
    this.#capture(captureId);
    return this.#get('SELECT c.*,p.source_url,p.format,p.sha256,p.raw_text FROM captures c JOIN payloads p ON p.id=c.payload_id WHERE c.id=?',captureId)!;
  }
  issues(): Row[] { return this.#db.prepare('SELECT * FROM issues ORDER BY id').all() as Row[]; }
  summary(): StoreSummary {
    return { schemaVersion:SCHEMA_VERSION, integrity:String(this.#get('PRAGMA integrity_check')!['integrity_check']), foreignKeyErrors:this.#db.prepare('PRAGMA foreign_key_check').all().length,
      counts:Object.fromEntries([...IMMUTABLE_TABLES,'issues'].map(table => [table,Number(this.#get(`SELECT count(*) n FROM ${table}`)!.n)])) };
  }
}
