PRAGMA foreign_keys = ON;

ALTER TABLE businesses ADD COLUMN setup_step TEXT NOT NULL DEFAULT 'business';
ALTER TABLE businesses ADD COLUMN setup_completed_at TEXT;
