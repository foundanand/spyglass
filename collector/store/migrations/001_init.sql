CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY,
  ts          INTEGER NOT NULL,
  app         TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  type        TEXT NOT NULL,
  name        TEXT NOT NULL,
  url         TEXT,
  props       TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_user_ts  ON events(user_id, ts);
CREATE INDEX IF NOT EXISTS idx_events_type_ts  ON events(type, ts);
CREATE INDEX IF NOT EXISTS idx_events_session  ON events(session_id, ts);

CREATE TABLE IF NOT EXISTS sessions (
  session_id  TEXT PRIMARY KEY,
  app         TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  started_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  chunk_count INTEGER DEFAULT 0,
  meta        TEXT
);
