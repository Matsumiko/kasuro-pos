PRAGMA foreign_keys = ON;

CREATE TABLE loyalty_accounts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  points_balance INTEGER NOT NULL DEFAULT 0 CHECK(points_balance >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(business_id,customer_id)
);
CREATE TABLE loyalty_ledger (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  points_delta INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  actor_member_id TEXT REFERENCES business_members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE(business_id,source_type,source_id)
);
CREATE TABLE credit_accounts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  credit_limit_minor INTEGER NOT NULL DEFAULT 0 CHECK(credit_limit_minor >= 0),
  balance_minor INTEGER NOT NULL DEFAULT 0 CHECK(balance_minor >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(business_id,customer_id)
);
CREATE TABLE credit_ledger (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount_delta_minor INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  actor_member_id TEXT REFERENCES business_members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE(business_id,source_type,source_id)
);
CREATE INDEX loyalty_ledger_customer ON loyalty_ledger(business_id,customer_id,created_at);
CREATE INDEX credit_ledger_customer ON credit_ledger(business_id,customer_id,created_at);
