PRAGMA foreign_keys = ON;

CREATE TABLE categories (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(business_id,name)
);
CREATE TABLE brands (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(business_id,name)
);
CREATE TABLE products (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL, brand_id TEXT REFERENCES brands(id) ON DELETE SET NULL,
  name TEXT NOT NULL, sku TEXT NOT NULL, barcode TEXT, description TEXT, unit_key TEXT NOT NULL DEFAULT 'pcs',
  price_minor INTEGER NOT NULL CHECK(price_minor >= 0), cost_minor INTEGER NOT NULL DEFAULT 0 CHECK(cost_minor >= 0),
  tax_rate_bp INTEGER NOT NULL DEFAULT 0 CHECK(tax_rate_bp BETWEEN 0 AND 10000), reorder_level INTEGER NOT NULL DEFAULT 0 CHECK(reorder_level >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(business_id,sku)
);
CREATE UNIQUE INDEX products_business_barcode ON products(business_id,barcode) WHERE barcode IS NOT NULL;
CREATE INDEX products_search ON products(business_id,status,name,sku);
CREATE TABLE product_variants (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE, label TEXT NOT NULL, sku TEXT NOT NULL,
  barcode TEXT, price_minor INTEGER, cost_minor INTEGER, options_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(business_id,sku)
);
CREATE UNIQUE INDEX variants_business_barcode ON product_variants(business_id,barcode) WHERE barcode IS NOT NULL;
CREATE INDEX variants_product_status ON product_variants(product_id,status);

CREATE TABLE inventory_balances (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT, quantity_on_hand INTEGER NOT NULL DEFAULT 0,
  average_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK(average_cost_minor >= 0), updated_at TEXT NOT NULL,
  PRIMARY KEY(business_id,outlet_id,variant_id)
);
CREATE INDEX inventory_low_stock ON inventory_balances(business_id,outlet_id,quantity_on_hand);
CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT, movement_type TEXT NOT NULL,
  quantity_delta INTEGER NOT NULL, unit_cost_minor INTEGER NOT NULL DEFAULT 0, source_type TEXT NOT NULL, source_id TEXT NOT NULL,
  actor_member_id TEXT REFERENCES business_members(id) ON DELETE SET NULL, client_transaction_id TEXT, created_at TEXT NOT NULL,
  UNIQUE(business_id,source_type,source_id,variant_id,movement_type)
);
CREATE INDEX stock_movements_history ON stock_movements(business_id,outlet_id,variant_id,created_at,id);

CREATE TABLE shifts (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  register_id TEXT NOT NULL REFERENCES registers(id) ON DELETE RESTRICT, cashier_member_id TEXT NOT NULL REFERENCES business_members(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closing','closed','voided')), opening_cash_minor INTEGER NOT NULL CHECK(opening_cash_minor >= 0),
  expected_cash_minor INTEGER, actual_cash_minor INTEGER, difference_minor INTEGER, opened_at TEXT NOT NULL, closed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX active_cashier_register_shift ON shifts(register_id,cashier_member_id) WHERE status IN ('open','closing');
CREATE TABLE cash_movements (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  shift_id TEXT NOT NULL REFERENCES shifts(id) ON DELETE RESTRICT, movement_type TEXT NOT NULL CHECK(movement_type IN ('cash_in','cash_out')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0), reason TEXT NOT NULL, actor_member_id TEXT REFERENCES business_members(id) ON DELETE SET NULL, created_at TEXT NOT NULL
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, customer_code TEXT NOT NULL, name TEXT NOT NULL,
  phone TEXT, email TEXT, notes TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  total_spend_minor INTEGER NOT NULL DEFAULT 0, transaction_count INTEGER NOT NULL DEFAULT 0, last_transaction_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(business_id,customer_code)
);
CREATE INDEX customers_search ON customers(business_id,status,name,phone);
CREATE TABLE suppliers (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, supplier_code TEXT NOT NULL, name TEXT NOT NULL,
  phone TEXT, email TEXT, notes TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(business_id,supplier_code)
);
CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, supplier_id TEXT REFERENCES suppliers(id) ON DELETE RESTRICT,
  outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ordered','partially_received','received','cancelled')),
  subtotal_minor INTEGER NOT NULL DEFAULT 0, tax_minor INTEGER NOT NULL DEFAULT 0, total_minor INTEGER NOT NULL DEFAULT 0,
  expected_at TEXT, created_by_member_id TEXT REFERENCES business_members(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE purchase_order_lines (
  id TEXT PRIMARY KEY, purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE, variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity_ordered INTEGER NOT NULL CHECK(quantity_ordered > 0), quantity_received INTEGER NOT NULL DEFAULT 0 CHECK(quantity_received >= 0), unit_cost_minor INTEGER NOT NULL CHECK(unit_cost_minor >= 0), created_at TEXT NOT NULL,
  CHECK(quantity_received <= quantity_ordered)
);
CREATE INDEX purchase_orders_scope ON purchase_orders(business_id,outlet_id,status,created_at);

CREATE TABLE sales (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  register_id TEXT NOT NULL REFERENCES registers(id) ON DELETE RESTRICT, shift_id TEXT REFERENCES shifts(id) ON DELETE RESTRICT,
  cashier_member_id TEXT NOT NULL REFERENCES business_members(id) ON DELETE RESTRICT, customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  receipt_number TEXT, client_transaction_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('draft','held','completed','void','partially_refunded','refunded','sync_conflict')),
  currency_code TEXT NOT NULL DEFAULT 'IDR', subtotal_minor INTEGER NOT NULL, discount_minor INTEGER NOT NULL DEFAULT 0, tax_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL, cogs_minor INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(business_id,client_transaction_id), UNIQUE(business_id,outlet_id,receipt_number)
);
CREATE INDEX sales_history ON sales(business_id,outlet_id,created_at,id);
CREATE TABLE sale_lines (
  id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE RESTRICT, variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL, sku TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0), unit_price_minor INTEGER NOT NULL CHECK(unit_price_minor >= 0),
  item_discount_minor INTEGER NOT NULL DEFAULT 0, tax_rate_bp INTEGER NOT NULL DEFAULT 0, tax_minor INTEGER NOT NULL DEFAULT 0, line_net_minor INTEGER NOT NULL,
  unit_cost_minor INTEGER NOT NULL DEFAULT 0, cogs_minor INTEGER NOT NULL DEFAULT 0, refundable_quantity INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE sale_payments (
  id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE RESTRICT, method TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  received_minor INTEGER, change_minor INTEGER NOT NULL DEFAULT 0, reference TEXT, created_at TEXT NOT NULL
);
CREATE TABLE refunds (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('requested','approved','completed','voided')), reason TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  payment_method TEXT NOT NULL, actor_member_id TEXT REFERENCES business_members(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE refund_lines (
  id TEXT PRIMARY KEY, refund_id TEXT NOT NULL REFERENCES refunds(id) ON DELETE CASCADE, sale_line_id TEXT NOT NULL REFERENCES sale_lines(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK(quantity > 0), amount_minor INTEGER NOT NULL CHECK(amount_minor > 0), created_at TEXT NOT NULL
);
CREATE TABLE idempotency_keys (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, actor_member_id TEXT REFERENCES business_members(id) ON DELETE SET NULL,
  endpoint_key TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  PRIMARY KEY(business_id,endpoint_key)
);

CREATE TABLE expenses (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, outlet_id TEXT REFERENCES outlets(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0), category TEXT NOT NULL, description TEXT NOT NULL, expense_date TEXT NOT NULL, payment_method TEXT NOT NULL,
  actor_member_id TEXT REFERENCES business_members(id) ON DELETE SET NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX expenses_scope ON expenses(business_id,outlet_id,expense_date);
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY, business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE, actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_member_id TEXT REFERENCES business_members(id) ON DELETE SET NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  summary_json TEXT NOT NULL DEFAULT '{}', request_id TEXT, created_at TEXT NOT NULL
);
CREATE INDEX audit_scope ON audit_events(business_id,created_at);
