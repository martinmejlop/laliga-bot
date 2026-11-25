export const APPLICATION_ID = 0x4c4c424f;
export const SCHEMA_VERSION = 1;

export const SCHEMA = `
CREATE TABLE sources (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, rights TEXT NOT NULL,
  recorded_at INTEGER NOT NULL
) STRICT;
CREATE TABLE payloads (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id),
  source_url TEXT NOT NULL, format TEXT NOT NULL, sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  raw_text TEXT NOT NULL, recorded_at INTEGER NOT NULL,
  UNIQUE(source_id, source_url, format, sha256)
) STRICT;
CREATE TABLE captures (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id),
  ingestion_key TEXT NOT NULL, payload_id TEXT NOT NULL REFERENCES payloads(id),
  requested_at INTEGER, received_at INTEGER NOT NULL, published_at INTEGER, source_as_of INTEGER,
  recorded_at INTEGER NOT NULL, UNIQUE(source_id, ingestion_key)
) STRICT;
CREATE TABLE teams (
  id TEXT PRIMARY KEY, name_key TEXT NOT NULL UNIQUE, canonical_name TEXT NOT NULL,
  recorded_at INTEGER NOT NULL
) STRICT;
CREATE TABLE team_aliases (
  source_id TEXT NOT NULL REFERENCES sources(id), alias_key TEXT NOT NULL,
  alias_label TEXT NOT NULL, team_id TEXT NOT NULL REFERENCES teams(id),
  recorded_at INTEGER NOT NULL, PRIMARY KEY(source_id, alias_key)
) STRICT;
CREATE TABLE fixtures (
  id TEXT PRIMARY KEY, competition TEXT NOT NULL CHECK(competition='LaLiga'), season TEXT NOT NULL,
  home_id TEXT NOT NULL REFERENCES teams(id), away_id TEXT NOT NULL REFERENCES teams(id),
  recorded_at INTEGER NOT NULL, CHECK(home_id<>away_id), UNIQUE(competition, season, home_id, away_id)
) STRICT;
CREATE TABLE fixture_aliases (
  source_id TEXT NOT NULL REFERENCES sources(id), external_id TEXT NOT NULL,
  fixture_id TEXT NOT NULL REFERENCES fixtures(id), recorded_at INTEGER NOT NULL,
  PRIMARY KEY(source_id, external_id)
) STRICT;
CREATE TABLE fixture_observations (
  id TEXT PRIMARY KEY, capture_id TEXT NOT NULL REFERENCES captures(id), fixture_id TEXT NOT NULL REFERENCES fixtures(id),
  kickoff_at INTEGER, date_label TEXT, status TEXT NOT NULL CHECK(status IN ('scheduled','finished','postponed','unknown')),
  home_score INTEGER, away_score INTEGER, details_json TEXT NOT NULL CHECK(json_valid(details_json)),
  recorded_at INTEGER NOT NULL, UNIQUE(capture_id,fixture_id),
  CHECK((home_score IS NULL AND away_score IS NULL) OR (home_score>=0 AND away_score>=0 AND home_score IS NOT NULL AND away_score IS NOT NULL)),
  CHECK(status<>'finished' OR home_score IS NOT NULL)
) STRICT;
CREATE TABLE odds_observations (
  id TEXT PRIMARY KEY, capture_id TEXT NOT NULL REFERENCES captures(id), fixture_id TEXT NOT NULL REFERENCES fixtures(id),
  market_id TEXT NOT NULL, period TEXT NOT NULL, selection_id TEXT NOT NULL, line_key TEXT NOT NULL,
  price REAL NOT NULL CHECK(price>1), source_updated_at INTEGER, source_confirmed_at INTEGER,
  suspended INTEGER NOT NULL CHECK(suspended IN (0,1)), region_verified INTEGER NOT NULL CHECK(region_verified IN (0,1)),
  quote_json TEXT NOT NULL CHECK(json_valid(quote_json)), recorded_at INTEGER NOT NULL,
  UNIQUE(capture_id,fixture_id,market_id,period,selection_id,line_key)
) STRICT;
CREATE INDEX odds_fixture_history ON odds_observations(fixture_id,market_id,selection_id);
CREATE INDEX captures_received ON captures(received_at);
CREATE TABLE articles (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), canonical_url TEXT NOT NULL,
  recorded_at INTEGER NOT NULL, UNIQUE(source_id,canonical_url)
) STRICT;
CREATE TABLE article_versions (
  id TEXT PRIMARY KEY, article_id TEXT NOT NULL REFERENCES articles(id), capture_id TEXT NOT NULL REFERENCES captures(id),
  title TEXT NOT NULL, excerpt TEXT NOT NULL, published_at INTEGER,
  team_ids_json TEXT NOT NULL CHECK(json_valid(team_ids_json)),
  recorded_at INTEGER NOT NULL, UNIQUE(article_id,capture_id)
) STRICT;
CREATE TABLE article_teams (
  version_id TEXT NOT NULL REFERENCES article_versions(id), team_id TEXT NOT NULL REFERENCES teams(id),
  PRIMARY KEY(version_id,team_id)
) STRICT;
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('statistics','model','prediction','report')),
  version_key TEXT NOT NULL, fixture_id TEXT REFERENCES fixtures(id), team_id TEXT REFERENCES teams(id),
  data_json TEXT NOT NULL CHECK(json_valid(data_json)), inputs_json TEXT NOT NULL CHECK(json_valid(inputs_json)),
  recorded_at INTEGER NOT NULL, UNIQUE(kind,version_key)
) STRICT;
CREATE TABLE artifact_inputs (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id), capture_id TEXT NOT NULL REFERENCES captures(id),
  PRIMARY KEY(artifact_id,capture_id)
) STRICT;
CREATE TABLE issues (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL, message TEXT NOT NULL,
  context_json TEXT NOT NULL CHECK(json_valid(context_json)), recorded_at INTEGER NOT NULL
) STRICT;
`;

// Correcciones e importaciones nuevas crean observaciones, no reescriben evidencia.
export const IMMUTABLE_TABLES = ['sources','payloads','captures','teams','team_aliases','fixtures','fixture_aliases',
  'fixture_observations','odds_observations','articles','article_versions','article_teams','artifacts','artifact_inputs'];
