import type { Hono } from 'hono';
import type { Env } from '../index';
import { createId } from '@kasuro/domain';
import { businessContext, requirePermission, type MembershipContext } from '../middleware/tenant';

export function registerPurchaseRoutes(app: Hono<Env>): void {
  app.use('/api/v1/businesses/:businessId/suppliers', businessContext);
  app.use('/api/v1/businesses/:businessId/suppliers/*', businessContext);
  app.use('/api/v1/businesses/:businessId/purchases', businessContext);
  app.use('/api/v1/businesses/:businessId/purchases/*', businessContext);
  app.get('/api/v1/businesses/:businessId/suppliers', async (c) => {
    const membership = requirePermission(c, 'suppliers.manage');
    if (!c.env.DB) return unavailable(c);
    const result = await c.env.DB.prepare(
      "SELECT id,supplier_code,name,phone,email,notes,status,created_at FROM suppliers WHERE business_id=? AND status='active' ORDER BY name LIMIT 100",
    )
      .bind(membership.businessId)
      .all();
    return c.json({ data: result.results });
  });
  app.post('/api/v1/businesses/:businessId/suppliers', async (c) => {
    const membership = requirePermission(c, 'suppliers.manage');
    if (!c.env.DB) return unavailable(c);
    const body = await c.req.json<{
      supplier_code?: string;
      name?: string;
      phone?: string;
      email?: string;
      notes?: string;
    }>();
    const name = body.name?.trim();
    const code = body.supplier_code?.trim().toUpperCase();
    if (!name || !code || name.length > 120 || code.length > 40)
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Supplier name and code are required' } },
        422,
      );
    const now = new Date().toISOString();
    const id = createId();
    try {
      await c.env.DB.prepare(
        'INSERT INTO suppliers(id,business_id,supplier_code,name,phone,email,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?, ?,?)',
      )
        .bind(
          id,
          membership.businessId,
          code,
          name,
          body.phone?.trim() ?? null,
          body.email?.trim().toLowerCase() ?? null,
          body.notes?.trim() ?? null,
          now,
          now,
        )
        .run();
    } catch {
      return c.json({ error: { code: 'CONFLICT', message: 'Supplier code already exists' } }, 409);
    }
    return c.json({ data: { id, supplier_code: code, name, status: 'active' } }, 201);
  });

  app.get('/api/v1/businesses/:businessId/purchases', async (c) => {
    const membership = requirePermission(c, 'purchases.view_create');
    if (!c.env.DB) return unavailable(c);
    const result = await c.env.DB.prepare(
      `SELECT po.id,po.supplier_id,po.outlet_id,po.status,po.subtotal_minor,po.tax_minor,po.total_minor,po.expected_at,po.created_at,s.name AS supplier_name,o.name AS outlet_name
       FROM purchase_orders po LEFT JOIN suppliers s ON s.id=po.supplier_id AND s.business_id=po.business_id LEFT JOIN outlets o ON o.id=po.outlet_id AND o.business_id=po.business_id
       WHERE po.business_id=? AND (?=1 OR EXISTS (SELECT 1 FROM member_outlets mo WHERE mo.member_id=? AND mo.outlet_id=po.outlet_id))
       ORDER BY po.created_at DESC,po.id DESC LIMIT 100`,
    )
      .bind(membership.businessId, membership.allOutlets ? 1 : 0, membership.memberId)
      .all();
    return c.json({ data: result.results });
  });

  app.get('/api/v1/businesses/:businessId/purchases/:purchaseId', async (c) => {
    const membership = requirePermission(c, 'purchases.view_create');
    if (!c.env.DB) return unavailable(c);
    const purchase = await c.env.DB.prepare(
      `SELECT po.id,po.supplier_id,po.outlet_id,po.status,po.subtotal_minor,po.tax_minor,po.total_minor,po.expected_at,po.created_at,s.name AS supplier_name,o.name AS outlet_name
       FROM purchase_orders po LEFT JOIN suppliers s ON s.id=po.supplier_id AND s.business_id=po.business_id LEFT JOIN outlets o ON o.id=po.outlet_id AND o.business_id=po.business_id
       WHERE po.id=? AND po.business_id=?`,
    )
      .bind(c.req.param('purchaseId'), membership.businessId)
      .first<{ outlet_id: string }>();
    if (!purchase || !(await canAccessOutlet(c.env.DB, membership, purchase.outlet_id)))
      return notFound(c);
    const lines = await c.env.DB.prepare(
      `SELECT pol.id,pol.variant_id,pol.quantity_ordered,pol.quantity_received,pol.unit_cost_minor,v.sku,p.name AS product_name,v.label
       FROM purchase_order_lines pol
       JOIN purchase_orders po ON po.id=pol.purchase_order_id AND po.business_id=?
       JOIN product_variants v ON v.id=pol.variant_id AND v.business_id=po.business_id
       JOIN products p ON p.id=v.product_id AND p.business_id=po.business_id
       WHERE pol.purchase_order_id=? ORDER BY pol.id`,
    )
      .bind(membership.businessId, c.req.param('purchaseId'))
      .all();
    return c.json({ data: { ...purchase, lines: lines.results } });
  });

  app.post('/api/v1/businesses/:businessId/purchases', async (c) => {
    const membership = requirePermission(c, 'purchases.view_create');
    if (!c.env.DB) return unavailable(c);
    const body = await c.req.json<{
      supplier_id?: string;
      outlet_id?: string;
      lines?: Array<{
        variant_id: string;
        quantity: string | number;
        unit_cost_minor: string | number;
      }>;
      expected_at?: string;
    }>();
    if (!body.outlet_id || !body.lines?.length)
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Outlet and lines are required' } },
        422,
      );
    if (!(await canAccessOutlet(c.env.DB, membership, body.outlet_id))) return notFound(c);
    if (body.supplier_id) {
      const supplier = await c.env.DB.prepare(
        "SELECT id FROM suppliers WHERE id=? AND business_id=? AND status='active'",
      )
        .bind(body.supplier_id, membership.businessId)
        .first();
      if (!supplier) return notFound(c);
    }
    const lines = body.lines.map((line) => ({
      variantId: line.variant_id?.trim(),
      quantity: integer(line.quantity),
      cost: integer(line.unit_cost_minor),
    }));
    if (
      lines.some(
        (line) =>
          !line.variantId ||
          !line.quantity ||
          line.quantity <= 0 ||
          line.cost === undefined ||
          line.cost < 0,
      ) ||
      new Set(lines.map((line) => line.variantId)).size !== lines.length
    )
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid or duplicate purchase line' } },
        422,
      );
    const variants = await c.env.DB.prepare(
      `SELECT id FROM product_variants WHERE business_id=? AND status='active' AND id IN (${lines.map(() => '?').join(',')})`,
    )
      .bind(membership.businessId, ...lines.map((line) => line.variantId))
      .all();
    if (variants.results.length !== lines.length)
      return c.json({ error: { code: 'NOT_FOUND', message: 'Variant not found' } }, 404);
    const purchaseId = createId();
    const now = new Date().toISOString();
    const subtotal = lines.reduce((sum, line) => sum + line.quantity! * line.cost!, 0);
    const statements = [
      c.env.DB.prepare(
        `INSERT INTO purchase_orders(id,business_id,supplier_id,outlet_id,status,subtotal_minor,tax_minor,total_minor,expected_at,created_by_member_id,created_at,updated_at) VALUES(?,?,?,?,'ordered',?,0,?,?,?, ?,?)`,
      ).bind(
        purchaseId,
        membership.businessId,
        body.supplier_id ?? null,
        body.outlet_id,
        subtotal,
        subtotal,
        body.expected_at ?? null,
        membership.memberId,
        now,
        now,
      ),
    ];
    for (const line of lines)
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO purchase_order_lines(id,purchase_order_id,variant_id,quantity_ordered,quantity_received,unit_cost_minor,created_at) VALUES(?,?,?, ?,0,?,?)`,
        ).bind(createId(), purchaseId, line.variantId, line.quantity, line.cost, now),
      );
    await c.env.DB.batch(statements);
    return c.json({ data: { id: purchaseId, status: 'ordered', subtotal_minor: subtotal } }, 201);
  });

  app.post('/api/v1/businesses/:businessId/purchases/:purchaseId/receive', async (c) => {
    const membership = requirePermission(c, 'purchases.receive');
    if (!c.env.DB) return unavailable(c);
    const body = await c.req.json<{
      receipt_id?: string;
      lines?: Array<{ line_id: string; quantity: string | number }>;
    }>();
    const receiptId = body.receipt_id?.trim() || createId();
    if (receiptId.length > 80)
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid receipt ID' } }, 422);
    const purchase = await c.env.DB.prepare(
      `SELECT id,outlet_id,status FROM purchase_orders WHERE id=? AND business_id=? AND status IN ('ordered','partially_received')`,
    )
      .bind(c.req.param('purchaseId'), membership.businessId)
      .first<{ id: string; outlet_id: string; status: string }>();
    if (!purchase || !body.lines?.length)
      return c.json({ error: { code: 'NOT_FOUND', message: 'Purchase order not found' } }, 404);
    if (!(await canAccessOutlet(c.env.DB, membership, purchase.outlet_id))) return notFound(c);
    if (new Set(body.lines.map((line) => line.line_id)).size !== body.lines.length)
      return c.json(
        {
          error: { code: 'VALIDATION_ERROR', message: 'Duplicate purchase lines are not allowed' },
        },
        422,
      );
    if (body.receipt_id) {
      const duplicate = await c.env.DB.prepare(
        'SELECT 1 FROM stock_movements WHERE business_id=? AND source_type=? AND source_id=? LIMIT 1',
      )
        .bind(membership.businessId, 'purchase_order', `${purchase.id}:${receiptId}`)
        .first();
      if (duplicate)
        return c.json({ error: { code: 'CONFLICT', message: 'Receipt already recorded' } }, 409);
    }
    const statements = [];
    for (const input of body.lines) {
      const quantity = integer(input.quantity);
      if (!quantity || quantity <= 0)
        return c.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Invalid received quantity' } },
          422,
        );
      const line = await c.env.DB.prepare(
        `SELECT pol.id,pol.variant_id,pol.quantity_ordered,pol.quantity_received,pol.unit_cost_minor FROM purchase_order_lines pol WHERE pol.id=? AND pol.purchase_order_id=?`,
      )
        .bind(input.line_id, purchase.id)
        .first<{
          id: string;
          variant_id: string;
          quantity_ordered: number;
          quantity_received: number;
          unit_cost_minor: number;
        }>();
      if (!line || line.quantity_received + quantity > line.quantity_ordered)
        return c.json(
          { error: { code: 'RECEIVE_LIMIT', message: 'Received quantity exceeds order' } },
          409,
        );
      statements.push(
        c.env.DB.prepare(
          'UPDATE purchase_order_lines SET quantity_received=quantity_received+? WHERE id=? AND quantity_received+?<=quantity_ordered',
        ).bind(quantity, line.id, quantity),
        c.env.DB.prepare(
          'UPDATE inventory_balances SET average_cost_minor=-1 WHERE business_id=? AND outlet_id=? AND variant_id=? AND changes()=0',
        ).bind(membership.businessId, purchase.outlet_id, line.variant_id),
      );
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO inventory_balances(business_id,outlet_id,variant_id,quantity_on_hand,average_cost_minor,updated_at) VALUES(?,?,?,?,?,?)
           ON CONFLICT(business_id,outlet_id,variant_id) DO UPDATE SET
             quantity_on_hand=inventory_balances.quantity_on_hand+excluded.quantity_on_hand,
             average_cost_minor=CASE
               WHEN inventory_balances.quantity_on_hand > 0 THEN CAST((inventory_balances.quantity_on_hand * inventory_balances.average_cost_minor + excluded.quantity_on_hand * excluded.average_cost_minor + (inventory_balances.quantity_on_hand + excluded.quantity_on_hand)/2) / (inventory_balances.quantity_on_hand + excluded.quantity_on_hand) AS INTEGER)
               ELSE excluded.average_cost_minor
             END,
             updated_at=excluded.updated_at`,
        ).bind(
          membership.businessId,
          purchase.outlet_id,
          line.variant_id,
          quantity,
          line.unit_cost_minor,
          new Date().toISOString(),
        ),
      );
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO stock_movements(id,business_id,outlet_id,variant_id,movement_type,quantity_delta,unit_cost_minor,source_type,source_id,actor_member_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        ).bind(
          createId(),
          membership.businessId,
          purchase.outlet_id,
          line.variant_id,
          'purchase_receipt',
          quantity,
          line.unit_cost_minor,
          'purchase_order',
          `${purchase.id}:${receiptId}`,
          membership.memberId,
          new Date().toISOString(),
        ),
      );
    }
    try {
      await c.env.DB.batch(statements);
    } catch (error) {
      if (
        String(error).includes('average_cost_minor') ||
        String(error).includes('quantity_received')
      )
        return c.json(
          { error: { code: 'RECEIVE_LIMIT', message: 'Received quantity exceeds order' } },
          409,
        );
      if (String(error).includes('UNIQUE')) {
        const duplicate = await c.env.DB.prepare(
          'SELECT 1 FROM stock_movements WHERE business_id=? AND source_type=? AND source_id=? LIMIT 1',
        )
          .bind(membership.businessId, 'purchase_order', `${purchase.id}:${receiptId}`)
          .first();
        if (duplicate)
          return c.json({ error: { code: 'CONFLICT', message: 'Receipt already recorded' } }, 409);
      }
      throw error;
    }
    await c.env.DB.prepare(
      `UPDATE purchase_orders SET status=CASE WHEN EXISTS (SELECT 1 FROM purchase_order_lines WHERE purchase_order_id=? AND quantity_received<quantity_ordered) THEN 'partially_received' ELSE 'received' END,updated_at=? WHERE id=? AND business_id=? AND status IN ('ordered','partially_received')`,
    )
      .bind(purchase.id, new Date().toISOString(), purchase.id, membership.businessId)
      .run();
    const updated = await c.env.DB.prepare(
      'SELECT status FROM purchase_orders WHERE id=? AND business_id=?',
    )
      .bind(purchase.id, membership.businessId)
      .first<{ status: string }>();
    return c.json({ data: { id: purchase.id, status: updated?.status ?? 'received' } });
  });
}
async function canAccessOutlet(
  db: D1Database,
  membership: MembershipContext,
  outletId: string,
): Promise<boolean> {
  const row = membership.allOutlets
    ? await db
        .prepare("SELECT id FROM outlets WHERE business_id=? AND id=? AND status='active'")
        .bind(membership.businessId, outletId)
        .first()
    : await db
        .prepare(
          `SELECT o.id FROM outlets o JOIN member_outlets mo ON mo.outlet_id=o.id
           WHERE o.business_id=? AND o.id=? AND mo.member_id=? AND o.status='active'`,
        )
        .bind(membership.businessId, outletId, membership.memberId)
        .first();
  return Boolean(row);
}

function notFound(c: { json: (body: unknown, status?: 404) => Response }): Response {
  return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
}

function unavailable(c: { json: (body: unknown, status?: 503) => Response }): Response {
  return c.json({ error: { code: 'CONFIGURATION_ERROR', message: 'Database unavailable' } }, 503);
}

function integer(value: string | number): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}
