PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_algorithm TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE platform_admins (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','disabled','pending_deletion')),
  country_code TEXT NOT NULL DEFAULT 'ID',
  currency_code TEXT NOT NULL DEFAULT 'IDR',
  currency_exponent INTEGER NOT NULL DEFAULT 0 CHECK (currency_exponent BETWEEN 0 AND 4),
  timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  logo_url TEXT,
  deletion_requested_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE business_members (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','disabled','removed')),
  all_outlets INTEGER NOT NULL DEFAULT 0 CHECK (all_outlets IN (0,1)),
  joined_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (business_id, user_id)
);

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX roles_system_key ON roles(key) WHERE business_id IS NULL;
CREATE UNIQUE INDEX roles_business_key ON roles(business_id, key) WHERE business_id IS NOT NULL;

CREATE TABLE permissions (
  key TEXT PRIMARY KEY,
  description TEXT NOT NULL
);
CREATE TABLE role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY(role_id, permission_key)
);
CREATE TABLE member_roles (
  member_id TEXT NOT NULL REFERENCES business_members(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY(member_id, role_id)
);

CREATE TABLE outlets (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  timezone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (business_id, code)
);
CREATE TABLE member_outlets (
  member_id TEXT NOT NULL REFERENCES business_members(id) ON DELETE CASCADE,
  outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  PRIMARY KEY(member_id, outlet_id)
);
CREATE TABLE registers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(outlet_id, name)
);
CREATE TABLE business_settings (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  stock_policy TEXT NOT NULL DEFAULT 'prevent_negative' CHECK (stock_policy IN ('prevent_negative','allow_negative')),
  tax_mode TEXT NOT NULL DEFAULT 'exclusive' CHECK (tax_mode IN ('exclusive','inclusive')),
  default_tax_rate_bp INTEGER NOT NULL DEFAULT 0 CHECK (default_tax_rate_bp BETWEEN 0 AND 10000),
  rounding_mode TEXT NOT NULL DEFAULT 'half_up',
  enabled_payment_methods TEXT NOT NULL DEFAULT '["cash"]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  accepted_at TEXT,
  invited_by_member_id TEXT NOT NULL REFERENCES business_members(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  created_ip_hash TEXT,
  user_agent_summary TEXT
);
CREATE INDEX sessions_user_active ON sessions(user_id, revoked_at, expires_at);
CREATE TABLE password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX business_members_user_status ON business_members(user_id, status);
CREATE INDEX business_members_business_status ON business_members(business_id, status);
CREATE INDEX outlets_business_status ON outlets(business_id, status);
CREATE INDEX member_outlets_outlet ON member_outlets(outlet_id);

INSERT INTO permissions(key, description) VALUES
 ('dashboard.view','View dashboard'), ('pos.use','Use point of sale'), ('sales.view','View sales'),
 ('sales.create','Create sales'), ('sales.discount','Apply discounts'), ('sales.void','Void sales'),
 ('sales.refund','Refund sales'), ('sales.reprint_receipt','Reprint receipts'), ('products.view','View products'),
 ('products.create_update','Create and update products'), ('products.archive','Archive products'), ('products.view_cost','View product cost'),
 ('inventory.view','View inventory'), ('inventory.adjust','Adjust inventory'), ('inventory.transfer','Transfer inventory'),
 ('inventory.stock_opname','Perform stock counts'), ('purchases.view_create','View and create purchases'), ('purchases.receive','Receive purchases'),
 ('customers.view_manage','View and manage customers'), ('customers.credit_manage','Manage credit'), ('loyalty.manage','Manage loyalty'),
 ('suppliers.manage','Manage suppliers'), ('expenses.view_manage','View and manage expenses'), ('reports.sales','View sales reports'),
 ('reports.profit','View profit reports'), ('reports.inventory','View inventory reports'), ('reports.export','Export reports'),
 ('staff.view','View staff'), ('staff.invite','Invite staff'), ('staff.manage_roles','Manage roles'), ('outlets.view','View outlets'),
 ('outlets.manage','Manage outlets'), ('settings.view','View settings'), ('settings.manage','Manage settings');

INSERT INTO roles(id,business_id,key,name,is_system,created_at,updated_at) VALUES
 ('role-owner',NULL,'owner','Owner',1,datetime('now'),datetime('now')),
 ('role-admin',NULL,'admin','Admin',1,datetime('now'),datetime('now')),
 ('role-manager',NULL,'manager','Manager',1,datetime('now'),datetime('now')),
 ('role-cashier',NULL,'cashier','Cashier',1,datetime('now'),datetime('now')),
 ('role-inventory',NULL,'inventory_staff','Inventory Staff',1,datetime('now'),datetime('now'));

INSERT INTO role_permissions(role_id,permission_key)
SELECT 'role-owner', key FROM permissions;
INSERT INTO role_permissions(role_id,permission_key)
SELECT 'role-admin', key FROM permissions WHERE key NOT IN ('settings.manage');
INSERT INTO role_permissions(role_id,permission_key)
SELECT 'role-manager', key FROM permissions WHERE key IN ('dashboard.view','pos.use','sales.view','sales.create','sales.discount','sales.void','sales.refund','sales.reprint_receipt','products.view','products.create_update','products.view_cost','inventory.view','inventory.adjust','inventory.transfer','inventory.stock_opname','purchases.view_create','purchases.receive','customers.view_manage','customers.credit_manage','loyalty.manage','suppliers.manage','expenses.view_manage','reports.sales','reports.profit','reports.inventory','reports.export','staff.view','outlets.view','settings.view');
INSERT INTO role_permissions(role_id,permission_key)
SELECT 'role-cashier', key FROM permissions WHERE key IN ('pos.use','sales.view','sales.create','sales.reprint_receipt','products.view','customers.view_manage','outlets.view');
INSERT INTO role_permissions(role_id,permission_key)
SELECT 'role-inventory', key FROM permissions WHERE key IN ('products.view','products.create_update','products.view_cost','inventory.view','inventory.adjust','inventory.transfer','inventory.stock_opname','purchases.view_create','purchases.receive','suppliers.manage','reports.inventory','reports.export','outlets.view');
