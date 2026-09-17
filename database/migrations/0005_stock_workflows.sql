PRAGMA foreign_keys = ON;

CREATE TABLE stock_counts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','counting','review','approved','posted','cancelled')),
  created_by_member_id TEXT REFERENCES business_members(id) ON DELETE SET NULL,
  approved_by_member_id TEXT REFERENCES business_members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE stock_count_lines (
  id TEXT PRIMARY KEY,
  stock_count_id TEXT NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  expected_quantity INTEGER NOT NULL,
  physical_quantity INTEGER,
  difference_quantity INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE(stock_count_id,variant_id)
);
CREATE TABLE stock_transfers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  source_outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  destination_outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','requested','approved','sent','partially_received','received','cancelled')),
  created_by_member_id TEXT REFERENCES business_members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(source_outlet_id <> destination_outlet_id)
);
CREATE TABLE stock_transfer_lines (
  id TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity_requested INTEGER NOT NULL CHECK(quantity_requested > 0),
  quantity_sent INTEGER NOT NULL DEFAULT 0 CHECK(quantity_sent >= 0),
  quantity_received INTEGER NOT NULL DEFAULT 0 CHECK(quantity_received >= 0),
  unit_cost_minor INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  CHECK(quantity_sent <= quantity_requested),
  CHECK(quantity_received <= quantity_sent),
  UNIQUE(transfer_id,variant_id)
);
CREATE INDEX stock_counts_scope ON stock_counts(business_id,outlet_id,status,created_at);
CREATE INDEX stock_transfers_scope ON stock_transfers(business_id,source_outlet_id,status,created_at);
