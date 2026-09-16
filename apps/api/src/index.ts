import { calculateSaleTotals, type CheckoutPayload, type Product } from '@kasuro/shared';

interface Env {
  DB: D1Database;
  APP_ORIGIN: string;
}

type AuthContext = { userId: string; businessId: string; outletId: string; role: string };
type LoginInput = { businessId: string; email: string; password: string };
type LoginUser = { id: string; businessId: string; outletId: string | null; passwordHash: string; name: string; role: string };

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...jsonHeaders, ...headers } });
}

function fail(code: string, message: string, status: number) {
  return json({ error: { code, message } }, status);
}

function requestId() {
  return crypto.randomUUID();
}
function bytesToHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value: string) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

async function hashPassword(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: 600_000, hash: 'SHA-256' }, key, 256);
  return bytesToHex(bits);
}

async function verifyPassword(password: string, encoded: string) {
  const [saltHex, expected] = encoded.split('$');
  if (!saltHex || !expected) return false;
  const actual = await hashPassword(password, hexToBytes(saltHex));
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

async function login(request: Request, env: Env) {
  let input: LoginInput;
  try { input = await request.json<LoginInput>(); } catch { return fail('INVALID_JSON', 'Request body must be valid JSON', 400); }
  const email = input.email?.trim().toLowerCase();
  const businessId = input.businessId?.trim();
  if (!businessId || !email || !input.password) return fail('INVALID_CREDENTIALS', 'Business, email, and password are required', 422);
  const recentAttempts = await env.DB.prepare(`SELECT COUNT(*) as count FROM login_attempts WHERE email = ? AND created_at > datetime('now', '-15 minutes')`).bind(email).first<{ count: number }>();
  if ((recentAttempts?.count ?? 0) >= 8) return fail('RATE_LIMITED', 'Too many login attempts. Try again later.', 429);
  const user = await env.DB.prepare(`SELECT id, business_id as businessId, outlet_id as outletId, password_hash as passwordHash, name, role FROM users WHERE business_id = ? AND lower(email) = ? AND active = 1 LIMIT 1`).bind(businessId, email).first<LoginUser>();
  const valid = user ? await verifyPassword(input.password, user.passwordHash) : false;
  await env.DB.prepare(`INSERT INTO login_attempts (id,business_id,email,success,created_at) VALUES (?,?,?,?,?)`).bind(requestId(), businessId, email, valid ? 1 : 0, new Date().toISOString()).run();
  if (!valid || !user) return fail('INVALID_CREDENTIALS', 'Email or password is incorrect', 401);
  const rawToken = bytesToHex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const tokenHash = bytesToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawToken)));
  const sessionId = requestId();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();
  const outlet = user.outletId ?? (await env.DB.prepare(`SELECT id FROM outlets WHERE business_id = ? ORDER BY id LIMIT 1`).bind(user.businessId).first<{ id: string }>())?.id;
  if (!outlet) return fail('OUTLET_NOT_CONFIGURED', 'User has no outlet assigned', 409);
  await env.DB.prepare(`INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)`).bind(sessionId, user.id, tokenHash, expiresAt, new Date().toISOString()).run();
  return json({ data: { token: rawToken, expiresAt, user: { id: user.id, name: user.name, role: user.role, businessId: user.businessId, outletId: outlet } } });
}

async function logout(request: Request, env: Env) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (token) {
    const tokenHash = bytesToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
    await env.DB.prepare(`UPDATE sessions SET revoked_at = ? WHERE token_hash = ?`).bind(new Date().toISOString(), tokenHash).run();
  }
  return new Response(null, { status: 204 });
}

async function requireAuth(request: Request, env: Env): Promise<AuthContext | Response> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token) return fail('UNAUTHENTICATED', 'Authentication required', 401);
  const tokenHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const encoded = [...new Uint8Array(tokenHash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const session = await env.DB.prepare(`
    SELECT u.id as userId, u.business_id as businessId, COALESCE(u.outlet_id, (SELECT o.id FROM outlets o WHERE o.business_id = u.business_id ORDER BY o.id LIMIT 1)) as outletId, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > datetime('now') AND u.active = 1
    LIMIT 1
  `).bind(encoded).first<AuthContext>();
  if (!session?.userId || !session.businessId || !session.outletId) return fail('UNAUTHENTICATED', 'Session expired', 401);
  return session;
}

function isAuthContext(value: AuthContext | Response): value is AuthContext {
  return !(value instanceof Response);
}

const rolePermissions: Record<string, string[]> = {
  owner: ['products.manage', 'inventory.adjust', 'sales.create', 'sales.refund', 'reports.view'],
  admin: ['products.manage', 'inventory.adjust', 'sales.create', 'sales.refund', 'reports.view'],
  manager: ['products.manage', 'inventory.adjust', 'sales.create', 'sales.refund', 'reports.view'],
  cashier: ['sales.create'],
  inventory_staff: ['products.manage', 'inventory.adjust'],
};

function requirePermission(auth: AuthContext, permission: string) {
  if (!rolePermissions[auth.role]?.includes(permission)) return fail('FORBIDDEN', 'You do not have permission for this operation', 403);
  return null;
}

async function adjustInventory(request: Request, env: Env, auth: AuthContext) {
  const denied = requirePermission(auth, 'inventory.adjust');
  if (denied) return denied;
  let input: { productId?: string; quantityDelta?: number; reason?: string };
  try { input = await request.json(); } catch { return fail('INVALID_JSON', 'Request body must be valid JSON', 400); }
  if (!input.productId || !Number.isInteger(input.quantityDelta) || input.quantityDelta === 0 || !input.reason?.trim()) return fail('INVALID_ADJUSTMENT', 'Product, integer quantity delta, and reason are required', 422);
  const productId = input.productId;
  const quantityDelta = input.quantityDelta as number;
  const reason = input.reason.trim();
  const current = await env.DB.prepare(`SELECT i.quantity, p.name FROM inventory_levels i JOIN products p ON p.id = i.product_id WHERE i.product_id = ? AND i.outlet_id = ? AND p.business_id = ? LIMIT 1`).bind(productId, auth.outletId, auth.businessId).first<{ quantity: number; name: string }>();
  if (!current) return fail('PRODUCT_NOT_FOUND', 'Product is not available at this outlet', 404);
  const nextQuantity = current.quantity + quantityDelta;
  if (nextQuantity < 0) return fail('NEGATIVE_STOCK', 'Adjustment would make stock negative', 409);
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(`UPDATE inventory_levels SET quantity = ?, updated_at = ? WHERE product_id = ? AND outlet_id = ?`).bind(nextQuantity, now, productId, auth.outletId),
      env.DB.prepare(`INSERT INTO stock_movements (id,business_id,outlet_id,product_id,quantity_delta,reason,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(requestId(), auth.businessId, auth.outletId, productId, quantityDelta, reason, auth.userId, now),
      env.DB.prepare(`INSERT INTO audit_logs (id,business_id,user_id,action,entity,entity_id,new_value,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(requestId(), auth.businessId, auth.userId, 'inventory.adjusted', 'product', productId, JSON.stringify({ from: current.quantity, to: nextQuantity, reason }), now),
    ]);
  } catch { return fail('INVENTORY_UPDATE_FAILED', 'Inventory could not be adjusted', 409); }
  return json({ data: { productId: input.productId, name: current.name, quantity: nextQuantity } });
}
async function openShift(request: Request, env: Env, auth: AuthContext) {
  const denied = requirePermission(auth, 'sales.create');
  if (denied) return denied;
  let input: { openingCash?: number; note?: string };
  try { input = await request.json(); } catch { return fail('INVALID_JSON', 'Request body must be valid JSON', 400); }
  if (!Number.isInteger(input.openingCash) || (input.openingCash as number) < 0) return fail('INVALID_SHIFT', 'Opening cash must be a non-negative integer', 422);
  const openingCash = input.openingCash as number;
  let register = await env.DB.prepare(`SELECT id FROM registers WHERE outlet_id = ? AND business_id = ? AND active = 1 ORDER BY id LIMIT 1`).bind(auth.outletId, auth.businessId).first<{ id: string }>();
  if (!register) {
    const registerId = requestId();
    await env.DB.prepare(`INSERT INTO registers (id,business_id,outlet_id,name,created_at) VALUES (?,?,?,?,?)`).bind(registerId, auth.businessId, auth.outletId, 'Register 1', new Date().toISOString()).run();
    register = { id: registerId };
  }
  const active = await env.DB.prepare(`SELECT id FROM shifts WHERE register_id = ? AND status = 'open' LIMIT 1`).bind(register.id).first<{ id: string }>();
  if (active) return fail('SHIFT_ALREADY_OPEN', 'This register already has an open shift', 409);
  const id = requestId();
  await env.DB.prepare(`INSERT INTO shifts (id,register_id,cashier_id,opening_cash,note,status,opened_at) VALUES (?,?,?,?,?,?,?)`).bind(id, register.id, auth.userId, openingCash, input.note?.trim() ?? null, 'open', new Date().toISOString()).run();
  return json({ data: { id, status: 'open', openingCash } }, 201);
}

async function closeShift(request: Request, env: Env, auth: AuthContext, shiftId: string) {
  const denied = requirePermission(auth, 'sales.create');
  if (denied) return denied;
  let input: { closingCash?: number };
  try { input = await request.json(); } catch { return fail('INVALID_JSON', 'Request body must be valid JSON', 400); }
  if (!Number.isInteger(input.closingCash) || (input.closingCash as number) < 0) return fail('INVALID_SHIFT', 'Closing cash must be a non-negative integer', 422);
  const closingCash = input.closingCash as number;
  const shift = await env.DB.prepare(`SELECT s.id, s.opening_cash as openingCash FROM shifts s JOIN registers r ON r.id = s.register_id WHERE s.id = ? AND r.business_id = ? AND r.outlet_id = ? AND s.status = 'open' LIMIT 1`).bind(shiftId, auth.businessId, auth.outletId).first<{ id: string; openingCash: number }>();
  if (!shift) return fail('SHIFT_NOT_FOUND', 'Open shift not found', 404);
  const cashSales = await env.DB.prepare(`SELECT COALESCE(SUM(p.amount),0) as amount FROM payments p JOIN sales s ON s.id = p.sale_id WHERE s.business_id = ? AND s.outlet_id = ? AND s.cashier_id = ? AND s.status = 'completed' AND p.method = 'cash' AND s.created_at >= (SELECT opened_at FROM shifts WHERE id = ?)`).bind(auth.businessId, auth.outletId, auth.userId, shiftId).first<{ amount: number }>();
  const movements = await env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN type = 'cash_in' THEN amount WHEN type IN ('cash_out','expense','refund') THEN -amount ELSE 0 END),0) as amount FROM cash_movements WHERE shift_id = ?`).bind(shiftId).first<{ amount: number }>();
  const expectedCash = shift.openingCash + (cashSales?.amount ?? 0) + (movements?.amount ?? 0);
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE shifts SET closing_cash = ?, expected_cash = ?, status = 'closed', closed_at = ? WHERE id = ?`).bind(closingCash, expectedCash, now, shiftId).run();
  return json({ data: { id: shiftId, expectedCash, closingCash, difference: closingCash - expectedCash, status: 'closed' } });
}

async function refundSale(request: Request, env: Env, auth: AuthContext) {
  const denied = requirePermission(auth, 'sales.refund');
  if (denied) return denied;
  let input: { saleId?: string; reason?: string };
  try { input = await request.json(); } catch { return fail('INVALID_JSON', 'Request body must be valid JSON', 400); }
  if (!input.saleId || !input.reason?.trim()) return fail('INVALID_REFUND', 'Sale and reason are required', 422);
  const sale = await env.DB.prepare(`SELECT id, total, outlet_id as outletId FROM sales WHERE id = ? AND business_id = ? AND status = 'completed' LIMIT 1`).bind(input.saleId, auth.businessId).first<{ id: string; total: number; outletId: string }>();
  if (!sale || sale.outletId !== auth.outletId) return fail('SALE_NOT_FOUND', 'Completed sale not found at this outlet', 404);
  const prior = await env.DB.prepare(`SELECT id FROM refunds WHERE sale_id = ? AND status = 'completed' LIMIT 1`).bind(sale.id).first<{ id: string }>();
  if (prior) return fail('SALE_ALREADY_REFUNDED', 'Sale has already been refunded', 409);
  const items = await env.DB.prepare(`SELECT id, product_id as productId, quantity, line_total as lineTotal FROM sale_items WHERE sale_id = ?`).bind(sale.id).all<{ id: string; productId: string; quantity: number; lineTotal: number }>();
  const refundId = requestId();
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`INSERT INTO refunds (id,sale_id,business_id,outlet_id,created_by,amount,reason,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(refundId, sale.id, auth.businessId, auth.outletId, auth.userId, sale.total, input.reason.trim(), now),
    env.DB.prepare(`UPDATE sales SET status = 'refunded' WHERE id = ?`).bind(sale.id),
    ...items.results.map((item) => env.DB.prepare(`INSERT INTO refund_items (id,refund_id,sale_item_id,quantity,amount) VALUES (?,?,?,?,?)`).bind(requestId(), refundId, item.id, item.quantity, item.lineTotal)),
    ...items.results.map((item) => env.DB.prepare(`UPDATE inventory_levels SET quantity = quantity + ?, updated_at = ? WHERE product_id = ? AND outlet_id = ?`).bind(item.quantity, now, item.productId, auth.outletId)),
    ...items.results.map((item) => env.DB.prepare(`INSERT INTO stock_movements (id,business_id,outlet_id,product_id,quantity_delta,reason,reference_id,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(requestId(), auth.businessId, auth.outletId, item.productId, item.quantity, 'refund', refundId, auth.userId, now)),
    env.DB.prepare(`INSERT INTO audit_logs (id,business_id,user_id,action,entity,entity_id,new_value,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(requestId(), auth.businessId, auth.userId, 'sale.refunded', 'sale', sale.id, JSON.stringify({ amount: sale.total, reason: input.reason.trim() }), now),
  ];
  try { await env.DB.batch(statements); } catch { return fail('REFUND_FAILED', 'Refund could not be completed', 409); }
  return json({ data: { refundId, saleId: sale.id, amount: sale.total, status: 'completed' } }, 201);
}
async function listProducts(request: Request, env: Env, auth: AuthContext) {
  const url = new URL(request.url);
  const query = url.searchParams.get('q')?.trim() ?? '';
  const category = url.searchParams.get('category') ?? '';
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 40), 100);
  const like = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const statement = env.DB.prepare(`
    SELECT p.id, p.business_id as businessId, p.category_id as categoryId, p.sku, p.barcode,
      p.name, p.unit, p.price, p.cost, p.reorder_point as reorderPoint, p.image_url as imageUrl,
      COALESCE(i.quantity, 0) as stock,
      CASE WHEN p.active = 1 THEN 1 ELSE 0 END as isFavorite
    FROM products p LEFT JOIN inventory_levels i ON i.product_id = p.id AND i.outlet_id = ?
    WHERE p.business_id = ? AND p.active = 1
      AND (? = '' OR p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR p.barcode = ?)
      AND (? = '' OR p.category_id = ?)
    ORDER BY CASE WHEN p.name LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, p.name, p.id
    LIMIT ?
  `).bind(auth.outletId, auth.businessId, query, like, like, query, category, category, `${query}%`, limit);
  const { results } = await statement.all<Product>();
  return json({ data: results });
}
async function listCustomers(request: Request, env: Env, auth: AuthContext) {
  const denied = requirePermission(auth, 'sales.create');
  if (denied) return denied;
  const url = new URL(request.url);
  const query = url.searchParams.get('q')?.trim() ?? '';
  const like = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const { results } = await env.DB.prepare(`SELECT id, name, phone, email, created_at as createdAt FROM customers WHERE business_id = ? AND (? = '' OR name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\') ORDER BY name, id LIMIT 100`).bind(auth.businessId, query, like, like).all<{ id: string; name: string; phone: string | null; email: string | null; createdAt: string }>();
  return json({ data: results });
}

async function createCustomer(request: Request, env: Env, auth: AuthContext) {
  const denied = requirePermission(auth, 'sales.create');
  if (denied) return denied;
  let input: { name?: string; phone?: string; email?: string };
  try { input = await request.json(); } catch { return fail('INVALID_JSON', 'Request body must be valid JSON', 400); }
  const name = input.name?.trim();
  if (!name) return fail('INVALID_CUSTOMER', 'Customer name is required', 422);
  const id = requestId();
  const now = new Date().toISOString();
  try { await env.DB.prepare(`INSERT INTO customers (id,business_id,name,phone,email,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`).bind(id, auth.businessId, name, input.phone?.trim() || null, input.email?.trim().toLowerCase() || null, now, now).run(); } catch { return fail('CUSTOMER_CREATE_FAILED', 'Customer could not be created', 409); }
  return json({ data: { id, name, phone: input.phone?.trim() || null, email: input.email?.trim().toLowerCase() || null } }, 201);
}

async function listSuppliers(request: Request, env: Env, auth: AuthContext) {
  const denied = requirePermission(auth, 'products.manage');
  if (denied) return denied;
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  const like = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const { results } = await env.DB.prepare(`SELECT id, name, phone, email, created_at as createdAt FROM suppliers WHERE business_id = ? AND (? = '' OR name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\') ORDER BY name, id LIMIT 100`).bind(auth.businessId, query, like, like).all<{ id: string; name: string; phone: string | null; email: string | null; createdAt: string }>();
  return json({ data: results });
}

async function createSupplier(request: Request, env: Env, auth: AuthContext) {
  const denied = requirePermission(auth, 'products.manage');
  if (denied) return denied;
  let input: { name?: string; phone?: string; email?: string };
  try { input = await request.json(); } catch { return fail('INVALID_JSON', 'Request body must be valid JSON', 400); }
  const name = input.name?.trim();
  if (!name) return fail('INVALID_SUPPLIER', 'Supplier name is required', 422);
  const id = requestId();
  const now = new Date().toISOString();
  try { await env.DB.prepare(`INSERT INTO suppliers (id,business_id,name,phone,email,created_at,updated_at) VALUES (?,?,?,?,?, ?, ?)`).bind(id, auth.businessId, name, input.phone?.trim() || null, input.email?.trim().toLowerCase() || null, now, now).run(); } catch { return fail('SUPPLIER_CREATE_FAILED', 'Supplier could not be created', 409); }
  return json({ data: { id, name, phone: input.phone?.trim() || null, email: input.email?.trim().toLowerCase() || null } }, 201);
}

async function listPurchaseOrders(request: Request, env: Env, auth: AuthContext) {
  const denied = requirePermission(auth, 'products.manage');
  if (denied) return denied;
  const status = new URL(request.url).searchParams.get('status') ?? '';
  const { results } = await env.DB.prepare(`SELECT po.id, po.order_number as orderNumber, po.status, po.total, po.created_at as createdAt, s.id as supplierId, s.name as supplierName, COUNT(poi.id) as lineCount FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id WHERE po.business_id = ? AND po.outlet_id = ? AND (? = '' OR po.status = ?) GROUP BY po.id, s.id, s.name ORDER BY po.created_at DESC, po.id DESC LIMIT 100`).bind(auth.businessId, auth.outletId, status, status).all<{ id: string; orderNumber: string; status: string; total: number; createdAt: string; supplierId: string | null; supplierName: string | null; lineCount: number }>();
  return json({ data: results });
}
async function createPurchaseOrder(request: Request, env: Env, auth: AuthContext) {
  const denied = requirePermission(auth, 'products.manage');
  if (denied) return denied;
  let input: { supplierId?: string; items?: Array<{ productId?: string; quantity?: number; unitCost?: number }> };
  try { input = await request.json(); } catch { return fail('INVALID_JSON', 'Request body must be valid JSON', 400); }
  if (!input.items?.length || input.items.some((item) => !item.productId || !Number.isInteger(item.quantity) || (item.quantity as number) <= 0 || !Number.isInteger(item.unitCost) || (item.unitCost as number) < 0)) return fail('INVALID_PURCHASE_ORDER', 'Items require positive integer quantities and non-negative integer costs', 422);
  const items = input.items as Array<{ productId: string; quantity: number; unitCost: number }>;
  const ids = [...new Set(items.map((item) => item.productId))];
  const placeholders = ids.map(() => '?').join(',');
  const products = await env.DB.prepare(`SELECT id FROM products WHERE business_id = ? AND active = 1 AND id IN (${placeholders})`).bind(auth.businessId, ...ids).all<{ id: string }>();
  if (products.results.length !== ids.length) return fail('PRODUCT_NOT_FOUND', 'One or more products are unavailable', 404);
  if (input.supplierId) {
    const supplier = await env.DB.prepare(`SELECT id FROM suppliers WHERE id = ? AND business_id = ? LIMIT 1`).bind(input.supplierId, auth.businessId).first<{ id: string }>();
    if (!supplier) return fail('SUPPLIER_NOT_FOUND', 'Supplier not found', 404);
  }
  const orderId = requestId();
  const orderNumber = `PO-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${orderId.slice(0, 8).toUpperCase()}`;
  const total = items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [env.DB.prepare(`INSERT INTO purchase_orders (id,business_id,outlet_id,supplier_id,order_number,status,total,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(orderId, auth.businessId, auth.outletId, input.supplierId ?? null, orderNumber, 'ordered', total, auth.userId, now), ...items.map((item) => env.DB.prepare(`INSERT INTO purchase_order_items (id,purchase_order_id,product_id,quantity,unit_cost,line_total) VALUES (?,?,?,?,?,?)`).bind(requestId(), orderId, item.productId, item.quantity, item.unitCost, item.quantity * item.unitCost))];
  try { await env.DB.batch(statements); } catch { return fail('PURCHASE_ORDER_FAILED', 'Purchase order could not be created', 409); }
  return json({ data: { id: orderId, orderNumber, status: 'ordered', total } }, 201);
}

async function receivePurchaseOrder(request: Request, env: Env, auth: AuthContext, orderId: string) {
  const denied = requirePermission(auth, 'inventory.adjust');
  if (denied) return denied;
  const order = await env.DB.prepare(`SELECT id, status FROM purchase_orders WHERE id = ? AND business_id = ? AND outlet_id = ? LIMIT 1`).bind(orderId, auth.businessId, auth.outletId).first<{ id: string; status: string }>();
  if (!order) return fail('PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found', 404);
  if (order.status !== 'ordered') return fail('PURCHASE_ORDER_NOT_RECEIVABLE', 'Purchase order is not awaiting receipt', 409);
  const prior = await env.DB.prepare(`SELECT id FROM goods_receipts WHERE purchase_order_id = ? LIMIT 1`).bind(orderId).first<{ id: string }>();
  if (prior) return fail('PURCHASE_ORDER_ALREADY_RECEIVED', 'Purchase order has already been received', 409);
  const items = await env.DB.prepare(`SELECT product_id as productId, quantity FROM purchase_order_items WHERE purchase_order_id = ?`).bind(orderId).all<{ productId: string; quantity: number }>();
  const receiptId = requestId();
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [env.DB.prepare(`INSERT INTO goods_receipts (id,purchase_order_id,business_id,outlet_id,received_by,created_at) VALUES (?,?,?,?,?,?)`).bind(receiptId, orderId, auth.businessId, auth.outletId, auth.userId, now), env.DB.prepare(`UPDATE purchase_orders SET status = 'received' WHERE id = ?`).bind(orderId), ...items.results.map((item) => env.DB.prepare(`UPDATE inventory_levels SET quantity = quantity + ?, updated_at = ? WHERE product_id = ? AND outlet_id = ?`).bind(item.quantity, now, item.productId, auth.outletId)), ...items.results.map((item) => env.DB.prepare(`INSERT INTO stock_movements (id,business_id,outlet_id,product_id,quantity_delta,reason,reference_id,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(requestId(), auth.businessId, auth.outletId, item.productId, item.quantity, 'purchase_receipt', receiptId, auth.userId, now)), env.DB.prepare(`INSERT INTO audit_logs (id,business_id,user_id,action,entity,entity_id,new_value,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(requestId(), auth.businessId, auth.userId, 'purchase.received', 'purchase_order', orderId, JSON.stringify({ receiptId }), now)];
  try { await env.DB.batch(statements); } catch { return fail('RECEIPT_FAILED', 'Goods receipt could not be completed', 409); }
  return json({ data: { receiptId, purchaseOrderId: orderId, status: 'received' } }, 201);
}
async function salesReport(request: Request, env: Env, auth: AuthContext) {
  const denied = requirePermission(auth, 'reports.view');
  if (denied) return denied;
  const url = new URL(request.url);
  const from = url.searchParams.get('from') ?? new Date().toISOString().slice(0, 10);
  const to = url.searchParams.get('to') ?? from;
  const summary = await env.DB.prepare(`SELECT COUNT(*) as transactions, COALESCE(SUM(subtotal),0) as grossSales, COALESCE(SUM(discount),0) as discount, COALESCE(SUM(tax),0) as tax, COALESCE(SUM(total),0) as netSales FROM sales WHERE business_id = ? AND outlet_id = ? AND status = 'completed' AND date(created_at) BETWEEN date(?) AND date(?)`).bind(auth.businessId, auth.outletId, from, to).first<{ transactions: number; grossSales: number; discount: number; tax: number; netSales: number }>();
  const payments = await env.DB.prepare(`SELECT p.method, COUNT(*) as transactions, COALESCE(SUM(p.amount),0) as amount FROM payments p JOIN sales s ON s.id = p.sale_id WHERE s.business_id = ? AND s.outlet_id = ? AND s.status = 'completed' AND date(s.created_at) BETWEEN date(?) AND date(?) GROUP BY p.method ORDER BY amount DESC`).bind(auth.businessId, auth.outletId, from, to).all<{ method: string; transactions: number; amount: number }>();
  const topProducts = await env.DB.prepare(`SELECT si.product_id as productId, si.name_snapshot as name, SUM(si.quantity) as quantity, SUM(si.line_total) as revenue FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.business_id = ? AND s.outlet_id = ? AND s.status = 'completed' AND date(s.created_at) BETWEEN date(?) AND date(?) GROUP BY si.product_id, si.name_snapshot ORDER BY revenue DESC LIMIT 10`).bind(auth.businessId, auth.outletId, from, to).all<{ productId: string; name: string; quantity: number; revenue: number }>();
  return json({ data: { from, to, summary: summary ?? { transactions: 0, grossSales: 0, discount: 0, tax: 0, netSales: 0 }, payments: payments.results, topProducts: topProducts.results } });
}
async function saleDetail(request: Request, env: Env, auth: AuthContext, saleId: string) {
  const sale = await env.DB.prepare(`SELECT s.id, s.receipt_number as receiptNumber, s.created_at as createdAt, s.subtotal, s.discount, s.tax, s.total, s.status, s.note, u.name as cashierName, o.name as outletName, c.name as customerName, c.phone as customerPhone FROM sales s JOIN users u ON u.id = s.cashier_id JOIN outlets o ON o.id = s.outlet_id LEFT JOIN customers c ON c.id = s.customer_id WHERE s.id = ? AND s.business_id = ? AND s.outlet_id = ? LIMIT 1`).bind(saleId, auth.businessId, auth.outletId).first<{ id: string; receiptNumber: string; createdAt: string; subtotal: number; discount: number; tax: number; total: number; status: string; note: string | null; cashierName: string; outletName: string; customerName: string | null; customerPhone: string | null }>();
  if (!sale) return fail('SALE_NOT_FOUND', 'Sale not found', 404);
  const items = await env.DB.prepare(`SELECT name_snapshot as name, sku_snapshot as sku, quantity, unit_price as unitPrice, discount, line_total as lineTotal FROM sale_items WHERE sale_id = ? ORDER BY id`).bind(saleId).all<{ name: string; sku: string; quantity: number; unitPrice: number; discount: number; lineTotal: number }>();
  const payments = await env.DB.prepare(`SELECT method, amount, reference FROM payments WHERE sale_id = ? ORDER BY id`).bind(saleId).all<{ method: string; amount: number; reference: string | null }>();
  return json({ data: { ...sale, items: items.results, payments: payments.results } });
}

async function dashboard(env: Env, auth: AuthContext) {
  const row = await env.DB.prepare(`
    SELECT COUNT(*) as transactions, COALESCE(SUM(total), 0) as sales,
      COALESCE(SUM(discount), 0) as discount, COALESCE(SUM(tax), 0) as tax
    FROM sales WHERE business_id = ? AND outlet_id = ? AND status = 'completed' AND date(created_at) = date('now', 'localtime')
  `).bind(auth.businessId, auth.outletId).first<{ transactions: number; sales: number; discount: number; tax: number }>();
  const lowStock = await env.DB.prepare(`
    SELECT COUNT(*) as count FROM products p JOIN inventory_levels i ON i.product_id = p.id AND i.outlet_id = ?
    WHERE p.business_id = ? AND p.active = 1 AND i.quantity <= p.reorder_point
  `).bind(auth.outletId, auth.businessId).first<{ count: number }>();
  return json({ data: { salesToday: row?.sales ?? 0, transactionsToday: row?.transactions ?? 0, discountToday: row?.discount ?? 0, taxToday: row?.tax ?? 0, lowStock: lowStock?.count ?? 0 } });
}

async function checkout(request: Request, env: Env, auth: AuthContext) {
  let payload: CheckoutPayload;
  try {
    payload = await request.json<CheckoutPayload>();
  } catch {
    return fail('INVALID_JSON', 'Request body must be valid JSON', 400);
  }
  if (payload.outletId !== auth.outletId || !payload.clientTransactionId || !payload.lines?.length || !payload.payments?.length) {
    return fail('INVALID_CHECKOUT', 'Outlet, transaction ID, lines, and payments are required', 422);
  }
  const existing = await env.DB.prepare(`SELECT id, receipt_number as receiptNumber, total FROM sales WHERE business_id = ? AND client_transaction_id = ? LIMIT 1`).bind(auth.businessId, payload.clientTransactionId).first<{ id: string; receiptNumber: string; total: number }>();
  if (existing) return json({ data: { saleId: existing.id, receiptNumber: existing.receiptNumber, total: existing.total, change: 0, status: 'completed' } });

  const productIds = [...new Set(payload.lines.map((line) => line.productId))];
  const quantities: Record<string, number> = {};
  const lineDiscounts: Record<string, number> = {};
  for (const line of payload.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0 || !Number.isInteger(line.discount) || line.discount < 0 || line.discount > line.price * line.quantity) return fail('INVALID_CHECKOUT', 'Quantities and discounts must be valid integer amounts', 422);
    quantities[line.productId] = (quantities[line.productId] ?? 0) + line.quantity;
    lineDiscounts[line.productId] = (lineDiscounts[line.productId] ?? 0) + line.discount;
  }
  if (!Number.isInteger(payload.discount) || payload.discount < 0 || !Number.isInteger(payload.tax) || payload.tax < 0) return fail('INVALID_CHECKOUT', 'Discount and tax must be valid integer amounts', 422);
  const placeholders = productIds.map(() => '?').join(',');
  const products = await env.DB.prepare(`SELECT p.id, p.name, p.sku, p.unit, p.price, i.quantity FROM products p JOIN inventory_levels i ON i.product_id = p.id AND i.outlet_id = ? WHERE p.business_id = ? AND p.id IN (${placeholders}) AND p.active = 1`).bind(auth.outletId, auth.businessId, ...productIds).all<{ id: string; name: string; sku: string; unit: string; price: number; quantity: number }>();
  const productsById: Record<string, { id: string; name: string; sku: string; unit: string; price: number; quantity: number }> = {};
  for (const product of products.results) productsById[product.id] = product;
  const serverLines = productIds.map((productId) => {
    const product = productsById[productId];
    return product ? { productId, sku: product.sku, name: product.name, unit: product.unit, price: product.price, quantity: quantities[productId], discount: lineDiscounts[productId] ?? 0 } : null;
  });
  if (serverLines.some((line) => !line)) return fail('PRODUCT_NOT_FOUND', 'One or more products are unavailable', 404);
  const validServerLines = serverLines as CheckoutPayload['lines'];
  for (const line of validServerLines) {
    const product = productsById[line.productId];
    if (product.quantity < line.quantity) return fail('INSUFFICIENT_STOCK', `Insufficient stock for ${line.name}`, 409);
  }
  const totals = calculateSaleTotals(validServerLines, payload.discount, payload.tax);
  const received = payload.payments.reduce((sum, payment) => sum + payment.amount, 0);
  if (!payload.payments.every((payment) => Number.isInteger(payment.amount) && payment.amount > 0)) return fail('INVALID_PAYMENT', 'Payment amounts must be positive integer amounts', 422);
  if (received < totals.total) return fail('INSUFFICIENT_PAYMENT', 'Payment is less than the sale total', 422);

  const saleId = requestId();
  const receiptNumber = `KSR-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${saleId.slice(0, 8).toUpperCase()}`;
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    ...validServerLines.map((line) => env.DB.prepare(`INSERT INTO sale_items (id,sale_id,product_id,name_snapshot,sku_snapshot,quantity,unit_price,discount,line_total) VALUES (?,?,?,?,?,?,?,?,?)`).bind(requestId(), saleId, line.productId, line.name, line.sku, line.quantity, line.price, line.discount, (line.price * line.quantity) - line.discount)),
    ...payload.payments.map((payment) => env.DB.prepare(`INSERT INTO payments (id,sale_id,method,amount,reference,created_at) VALUES (?,?,?,?,?,?)`).bind(requestId(), saleId, payment.method, payment.amount, payment.reference ?? null, now)),
    ...validServerLines.map((line) => env.DB.prepare(`UPDATE inventory_levels SET quantity = quantity - ?, updated_at = ? WHERE product_id = ? AND outlet_id = ? AND quantity >= ?`).bind(line.quantity, now, line.productId, auth.outletId, line.quantity)),
    ...validServerLines.map((line) => env.DB.prepare(`INSERT INTO stock_movements (id,business_id,outlet_id,product_id,quantity_delta,reason,reference_id,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(requestId(), auth.businessId, auth.outletId, line.productId, -line.quantity, 'sale', saleId, auth.userId, now)),
    env.DB.prepare(`INSERT INTO sync_records (client_transaction_id,business_id,sale_id,created_at) VALUES (?,?,?,?)`).bind(payload.clientTransactionId, auth.businessId, saleId, now),
    env.DB.prepare(`INSERT INTO audit_logs (id,business_id,user_id,action,entity,entity_id,new_value,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(requestId(), auth.businessId, auth.userId, 'sale.completed', 'sale', saleId, JSON.stringify({ total: totals.total }), now),
  ];
  try {
    await env.DB.batch(statements);
  } catch (error) {
    return fail('CHECKOUT_FAILED', 'Checkout could not be completed', 409);
  }
  return json({ data: { saleId, receiptNumber, total: totals.total, change: received - totals.total, status: 'completed' } }, 201);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('origin');
    const allowedOrigin = origin && (origin === env.APP_ORIGIN || /^http:\/\/localhost:\d+$/.test(origin) || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) ? origin : env.APP_ORIGIN;
    const cors = { 'access-control-allow-origin': allowedOrigin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization, content-type, x-client-transaction-id', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'vary': 'Origin' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    if (url.pathname === '/api/v1/auth/login' && request.method === 'POST') return login(request, env);
    if (url.pathname === '/api/v1/auth/logout' && request.method === 'POST') return logout(request, env);
    if (url.pathname === '/health') return json({ status: 'ok' }, 200, cors);
    const auth = await requireAuth(request, env);
    if (!isAuthContext(auth)) return new Response(auth.body, { status: auth.status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8' } });
    let response: Response;
    if (url.pathname === '/api/v1/products' && request.method === 'GET') response = await listProducts(request, env, auth);
    else if (url.pathname === '/api/v1/dashboard' && request.method === 'GET') response = await dashboard(env, auth);
    else if (url.pathname === '/api/v1/reports/sales' && request.method === 'GET') response = await salesReport(request, env, auth);
    else if (url.pathname === '/api/v1/customers' && request.method === 'GET') response = await listCustomers(request, env, auth);
    else if (url.pathname === '/api/v1/customers' && request.method === 'POST') response = await createCustomer(request, env, auth);
    else if (url.pathname === '/api/v1/suppliers' && request.method === 'GET') response = await listSuppliers(request, env, auth);
    else if (url.pathname === '/api/v1/suppliers' && request.method === 'POST') response = await createSupplier(request, env, auth);
    else if (url.pathname === '/api/v1/purchase-orders' && request.method === 'GET') response = await listPurchaseOrders(request, env, auth);
    else if (url.pathname.match(/^\/api\/v1\/purchase-orders\/[^/]+\/receive$/) && request.method === 'POST') response = await receivePurchaseOrder(request, env, auth, url.pathname.split('/')[4]);
    else if (url.pathname === '/api/v1/inventory/adjust' && request.method === 'POST') response = await adjustInventory(request, env, auth);
    else if (url.pathname === '/api/v1/shifts/open' && request.method === 'POST') response = await openShift(request, env, auth);
    else if (url.pathname.match(/^\/api\/v1\/shifts\/[^/]+\/close$/) && request.method === 'POST') response = await closeShift(request, env, auth, url.pathname.split('/')[5]);
    else if (url.pathname === '/api/v1/refunds' && request.method === 'POST') response = await refundSale(request, env, auth);
    else if (url.pathname.match(/^\/api\/v1\/sales\/[^/]+$/) && request.method === 'GET') response = await saleDetail(request, env, auth, url.pathname.split('/')[4]);
    else if (url.pathname === '/api/v1/sales' && request.method === 'POST') {
      const denied = requirePermission(auth, 'sales.create');
      response = denied ?? await checkout(request, env, auth);
    } else response = fail('NOT_FOUND', 'Route not found', 404);
    return new Response(response.body, { status: response.status, headers: { ...cors, 'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8', 'cache-control': response.headers.get('cache-control') ?? 'no-store' } });
  },
};
