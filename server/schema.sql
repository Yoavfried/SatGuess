PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS private_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS daily_challenges (
  day_key TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  state_json TEXT NOT NULL CHECK(json_valid(state_json))
) STRICT;

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  kind TEXT NOT NULL CHECK(kind IN ('practice','daily')),
  day_key TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  state_json TEXT NOT NULL CHECK(json_valid(state_json))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS one_daily_attempt ON runs(player_id,day_key) WHERE kind = 'daily';
CREATE INDEX IF NOT EXISTS runs_player_recent ON runs(player_id,created_at DESC);
CREATE INDEX IF NOT EXISTS runs_daily_board ON runs(kind,day_key,status);

CREATE TABLE IF NOT EXISTS place_exposures (
  player_id TEXT NOT NULL REFERENCES players(id),
  source_place_id TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  PRIMARY KEY(player_id,source_place_id)
) STRICT;

CREATE TABLE IF NOT EXISTS round_attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  round_index INTEGER NOT NULL CHECK(round_index BETWEEN 0 AND 4),
  source_place_id TEXT NOT NULL,
  place_revision_id TEXT NOT NULL,
  cohort_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  mode TEXT NOT NULL,
  collection TEXT NOT NULL,
  first_exposure INTEGER NOT NULL CHECK(first_exposure IN (0,1)),
  started_at INTEGER NOT NULL,
  deadline_at INTEGER,
  finalized_at INTEGER,
  guess_lng REAL,
  guess_lat REAL,
  center_distance_m REAL,
  edge_distance_m REAL,
  score INTEGER CHECK(score IS NULL OR score BETWEEN 0 AND 100),
  outcome TEXT,
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  UNIQUE(run_id,round_index)
) STRICT;
CREATE INDEX IF NOT EXISTS attempts_place_cohort ON round_attempts(place_revision_id,cohort_key,first_exposure,finalized_at);
CREATE INDEX IF NOT EXISTS attempts_player_history ON round_attempts(player_id,started_at);
CREATE INDEX IF NOT EXISTS attempts_source_place ON round_attempts(source_place_id,finalized_at);

PRAGMA user_version = 1;
