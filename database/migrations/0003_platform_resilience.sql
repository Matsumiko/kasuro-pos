PRAGMA foreign_keys = ON;

CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  features_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE business_subscriptions (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('trial','active','past_due','cancelled')),
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE feature_flags (
  key TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  updated_at TEXT NOT NULL
);
CREATE TABLE import_jobs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  actor_member_id TEXT REFERENCES business_members(id) ON DELETE SET NULL,
  import_type TEXT NOT NULL CHECK(import_type IN ('products','customers','suppliers','opening_stock')),
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK(status IN ('uploaded','parsed','validated','confirmed','imported','failed','cancelled')),
  filename TEXT NOT NULL,
  total_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  error_rows INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE import_rows (
  id TEXT PRIMARY KEY,
  import_job_id TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  raw_json TEXT NOT NULL,
  normalized_json TEXT,
  error_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','valid','invalid','imported')),
  UNIQUE(import_job_id,row_number)
);
CREATE INDEX import_jobs_scope ON import_jobs(business_id,created_at,status);
CREATE TABLE daily_sales_summaries (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  business_date TEXT NOT NULL,
  transaction_count INTEGER NOT NULL DEFAULT 0,
  net_sales_minor INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  cogs_minor INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(business_id,outlet_id,business_date)
);
CREATE TABLE platform_audit_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX platform_audit_history ON platform_audit_events(created_at,entity_type);
