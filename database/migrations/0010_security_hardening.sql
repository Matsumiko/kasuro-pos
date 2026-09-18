PRAGMA foreign_keys = ON;

CREATE TABLE auth_rate_limits (
  key_hash TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  updated_at TEXT NOT NULL
);
CREATE INDEX auth_rate_limits_updated ON auth_rate_limits(updated_at);
