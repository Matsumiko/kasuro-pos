PRAGMA foreign_keys = ON;

CREATE TABLE businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'IDR',
  timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE outlets (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,
  address TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_outlets_business ON outlets(business_id);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  outlet_id TEXT REFERENCES outlets(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','manager','cashier','inventory_staff')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(business_id, email)
);
CREATE INDEX idx_users_business_email ON users(business_id, email);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_token ON sessions(token_hash);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(business_id, name)
);
CREATE INDEX idx_categories_business ON categories(business_id);
CREATE TABLE products (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  category_id TEXT REFERENCES categories(id),
  sku TEXT NOT NULL,
  barcode TEXT,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'pcs',
  price INTEGER NOT NULL CHECK(price >= 0),
  cost INTEGER NOT NULL DEFAULT 0 CHECK(cost >= 0),
  reorder_point INTEGER NOT NULL DEFAULT 0 CHECK(reorder_point >= 0),
  image_url TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(business_id, sku),
  UNIQUE(business_id, barcode)
);
CREATE INDEX idx_products_business_name ON products(business_id, name, id);
CREATE INDEX idx_products_business_barcode ON products(business_id, barcode);
CREATE TABLE inventory_levels (
  product_id TEXT NOT NULL REFERENCES products(id),
  outlet_id TEXT NOT NULL REFERENCES outlets(id),
  quantity INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(product_id, outlet_id)
);
CREATE INDEX idx_inventory_outlet_quantity ON inventory_levels(outlet_id, quantity);
CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  outlet_id TEXT NOT NULL REFERENCES outlets(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity_delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reference_id TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_stock_movements_outlet_product_date ON stock_movements(outlet_id, product_id, created_at);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_customers_business_name ON customers(business_id, name, id);

CREATE TABLE sales (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  outlet_id TEXT NOT NULL REFERENCES outlets(id),
  cashier_id TEXT NOT NULL REFERENCES users(id),
  customer_id TEXT REFERENCES customers(id),
  client_transaction_id TEXT NOT NULL,
  receipt_number TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  tax INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('completed','void','refunded','partial_refund')),
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(business_id, client_transaction_id),
  UNIQUE(business_id, receipt_number)
);
CREATE INDEX idx_sales_business_date ON sales(business_id, created_at, id);
CREATE INDEX idx_sales_outlet_date ON sales(outlet_id, created_at, id);
CREATE TABLE sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  name_snapshot TEXT NOT NULL,
  sku_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  unit_price INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  line_total INTEGER NOT NULL
);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  method TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount > 0),
  reference TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_payments_sale ON payments(sale_id);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  old_value TEXT,
  new_value TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_business_date ON audit_logs(business_id, created_at, id);

CREATE TABLE sync_records (
  client_transaction_id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  sale_id TEXT NOT NULL REFERENCES sales(id),
  created_at TEXT NOT NULL
);
