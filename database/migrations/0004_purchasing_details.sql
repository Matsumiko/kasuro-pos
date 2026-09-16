CREATE TABLE IF NOT EXISTS purchase_order_items (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  unit_cost INTEGER NOT NULL CHECK(unit_cost >= 0),
  line_total INTEGER NOT NULL CHECK(line_total >= 0)
);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_order ON purchase_order_items(purchase_order_id);
CREATE TABLE IF NOT EXISTS goods_receipts (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
  business_id TEXT NOT NULL REFERENCES businesses(id),
  outlet_id TEXT NOT NULL REFERENCES outlets(id),
  received_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(purchase_order_id)
);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_business_date ON goods_receipts(business_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_customers_business_phone ON customers(business_id, phone);
