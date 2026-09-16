CREATE TABLE IF NOT EXISTS registers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  outlet_id TEXT NOT NULL REFERENCES outlets(id),
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(outlet_id, name)
);
CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  register_id TEXT NOT NULL REFERENCES registers(id),
  cashier_id TEXT NOT NULL REFERENCES users(id),
  opening_cash INTEGER NOT NULL CHECK(opening_cash >= 0),
  closing_cash INTEGER,
  expected_cash INTEGER,
  note TEXT,
  status TEXT NOT NULL CHECK(status IN ('open','closed')),
  opened_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_shifts_register_status ON shifts(register_id, status, opened_at);
CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL REFERENCES shifts(id),
  type TEXT NOT NULL CHECK(type IN ('cash_in','cash_out','expense','refund')),
  amount INTEGER NOT NULL CHECK(amount > 0),
  note TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cash_movements_shift_date ON cash_movements(shift_id, created_at);
CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  business_id TEXT NOT NULL REFERENCES businesses(id),
  outlet_id TEXT NOT NULL REFERENCES outlets(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK(amount > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refunds_business_date ON refunds(business_id, created_at, id);
CREATE TABLE IF NOT EXISTS refund_items (
  id TEXT PRIMARY KEY,
  refund_id TEXT NOT NULL REFERENCES refunds(id),
  sale_item_id TEXT NOT NULL REFERENCES sale_items(id),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  amount INTEGER NOT NULL CHECK(amount > 0)
);
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_suppliers_business_name ON suppliers(business_id, name, id);
CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  outlet_id TEXT NOT NULL REFERENCES outlets(id),
  supplier_id TEXT REFERENCES suppliers(id),
  order_number TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','ordered','received','cancelled')),
  total INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(business_id, order_number)
);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_business_date ON purchase_orders(business_id, created_at, id);
