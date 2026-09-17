import type { Hono } from 'hono';
import type { Env } from '../index';
import { createId } from '@kasuro/domain';
import { businessContext, requirePermission } from '../middleware/tenant';

export function registerCatalogRoutes(app: Hono<Env>): void {
  app.use('/api/v1/businesses/:businessId/products', businessContext);
  app.use('/api/v1/businesses/:businessId/products/*', businessContext);
  app.use('/api/v1/businesses/:businessId/inventory', businessContext);
  app.use('/api/v1/businesses/:businessId/inventory/*', businessContext);
  app.get('/api/v1/businesses/:businessId/products', async (c) => {
    const membership = requirePermission(c, 'products.view');
    if (!c.env.DB) return unavailable(c);
    const query = c.req.query('q')?.trim() ?? '';
    const search = `%${query}%`;
    const result = await c.env.DB.prepare(
      `SELECT p.id,p.name,p.sku,p.barcode,p.unit_key,p.price_minor,p.cost_minor,p.tax_rate_bp,p.status,
        v.id AS variant_id,v.label AS variant_label,v.sku AS variant_sku,v.barcode AS variant_barcode,
        COALESCE(v.price_minor,p.price_minor) AS selling_price_minor,COALESCE(v.cost_minor,p.cost_minor) AS variant_cost_minor
      FROM products p JOIN product_variants v ON v.product_id=p.id AND v.status='active'
      WHERE p.business_id=? AND p.status='active' AND (?='' OR p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR v.sku LIKE ? OR v.barcode LIKE ?)
      ORDER BY p.name,v.label LIMIT 100`,
    )
      .bind(membership.businessId, query, search, search, search, search, search)
      .all();
    return c.json({ data: result.results });
  });

  app.post('/api/v1/businesses/:businessId/products', async (c) => {
    const membership = requirePermission(c, 'products.create_update');
    if (!c.env.DB) return unavailable(c);
    const body = await c.req.json<
      Partial<{
        name: string;
        sku: string;
        barcode: string;
        unit_key: string;
        price_minor: string | number;
        cost_minor: string | number;
        tax_rate_bp: string | number;
        label: string;
      }>
    >();
    const name = body.name?.trim();
    const sku = body.sku?.trim().toUpperCase();
    const label = body.label?.trim() || 'Default';
    const price = integer(body.price_minor);
    const cost = integer(body.cost_minor ?? 0);
    const taxRate = integer(body.tax_rate_bp ?? 0);
    if (
      !name ||
      !sku ||
      !label ||
      price === undefined ||
      cost === undefined ||
      taxRate === undefined ||
      price < 0 ||
      cost < 0 ||
      taxRate < 0 ||
      taxRate > 10000
    )
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid product data' } }, 422);
    const now = new Date().toISOString();
    const productId = createId();
    const variantId = createId();
    try {
      const outlets = await c.env.DB.prepare(
        "SELECT id FROM outlets WHERE business_id=? AND status='active'",
      )
        .bind(membership.businessId)
        .all<{ id: string }>();
      const statements = [
        c.env.DB.prepare(
          `INSERT INTO products(id,business_id,name,sku,barcode,unit_key,price_minor,cost_minor,tax_rate_bp,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,? ,?,'active',?,?)`,
        ).bind(
          productId,
          membership.businessId,
          name,
          sku,
          body.barcode?.trim() || null,
          body.unit_key?.trim() || 'pcs',
          price,
          cost,
          taxRate,
          now,
          now,
        ),
        c.env.DB.prepare(
          `INSERT INTO product_variants(id,business_id,product_id,label,sku,barcode,price_minor,cost_minor,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'active',?,?)`,
        ).bind(
          variantId,
          membership.businessId,
          productId,
          label,
          sku,
          body.barcode?.trim() || null,
          price,
          cost,
          now,
          now,
        ),
      ];
      for (const outlet of outlets.results)
        statements.push(
          c.env.DB.prepare(
            `INSERT INTO inventory_balances(business_id,outlet_id,variant_id,quantity_on_hand,average_cost_minor,updated_at) VALUES(?,?,?,0,?,?)`,
          ).bind(membership.businessId, outlet.id, variantId, cost, now),
        );
      await c.env.DB.batch(statements);
    } catch {
      return c.json({ error: { code: 'CONFLICT', message: 'SKU or barcode already exists' } }, 409);
    }
    return c.json(
      {
        data: {
          id: productId,
          variant_id: variantId,
          name,
          sku,
          price_minor: price,
          status: 'active',
        },
      },
      201,
    );
  });

  app.get('/api/v1/businesses/:businessId/inventory', async (c) => {
    const membership = requirePermission(c, 'inventory.view');
    if (!c.env.DB) return unavailable(c);
    const outletId = c.req.query('outlet_id');
    if (
      outletId &&
      !(await canAccessOutlet(
        c.env.DB,
        membership.businessId,
        membership.memberId,
        membership.allOutlets,
        outletId,
      ))
    )
      return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    const result = await c.env.DB.prepare(
      `SELECT ib.outlet_id,ib.variant_id,p.name,p.sku,v.label,ib.quantity_on_hand,ib.average_cost_minor,ib.updated_at
      FROM inventory_balances ib JOIN product_variants v ON v.id=ib.variant_id JOIN products p ON p.id=v.product_id
      WHERE ib.business_id=? AND (? IS NULL OR ib.outlet_id=?) ORDER BY p.name,v.label LIMIT 200`,
    )
      .bind(membership.businessId, outletId ?? null, outletId ?? null)
      .all();
    return c.json({ data: result.results });
  });

  app.post('/api/v1/businesses/:businessId/inventory/adjustments', async (c) => {
    const membership = requirePermission(c, 'inventory.adjust');
    if (!c.env.DB) return unavailable(c);
    const body = await c.req.json<
      Partial<{
        outlet_id: string;
        variant_id: string;
        quantity_delta: string | number;
        unit_cost_minor: string | number;
        reason: string;
      }>
    >();
    const delta = integer(body.quantity_delta);
    const cost = integer(body.unit_cost_minor ?? 0);
    if (
      !body.outlet_id ||
      !body.variant_id ||
      delta === undefined ||
      delta === 0 ||
      cost === undefined ||
      cost < 0 ||
      !body.reason?.trim()
    )
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Outlet, variant, quantity, cost and reason are required',
          },
        },
        422,
      );
    if (
      !(await canAccessOutlet(
        c.env.DB,
        membership.businessId,
        membership.memberId,
        membership.allOutlets,
        body.outlet_id,
      ))
    )
      return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    const variant = await c.env.DB.prepare(
      "SELECT id FROM product_variants WHERE id=? AND business_id=? AND status='active'",
    )
      .bind(body.variant_id, membership.businessId)
      .first();
    if (!variant) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    const balance = await c.env.DB.prepare(
      'SELECT quantity_on_hand,average_cost_minor FROM inventory_balances WHERE business_id=? AND outlet_id=? AND variant_id=?',
    )
      .bind(membership.businessId, body.outlet_id, body.variant_id)
      .first<{ quantity_on_hand: number; average_cost_minor: number }>();
    if (!balance)
      return c.json({ error: { code: 'NOT_FOUND', message: 'Inventory balance not found' } }, 404);
    if (balance.quantity_on_hand + delta < 0)
      return c.json(
        { error: { code: 'INSUFFICIENT_STOCK', message: 'Adjustment would make stock negative' } },
        409,
      );
    const now = new Date().toISOString();
    const sourceId = createId();
    const nextAverage =
      delta > 0
        ? Math.round(
            (balance.quantity_on_hand * balance.average_cost_minor + delta * cost) /
              (balance.quantity_on_hand + delta || 1),
          )
        : balance.average_cost_minor;
    await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE inventory_balances SET quantity_on_hand=?,average_cost_minor=?,updated_at=? WHERE business_id=? AND outlet_id=? AND variant_id=?',
      ).bind(
        balance.quantity_on_hand + delta,
        nextAverage,
        now,
        membership.businessId,
        body.outlet_id,
        body.variant_id,
      ),
      c.env.DB.prepare(
        `INSERT INTO stock_movements(id,business_id,outlet_id,variant_id,movement_type,quantity_delta,unit_cost_minor,source_type,source_id,actor_member_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        createId(),
        membership.businessId,
        body.outlet_id,
        body.variant_id,
        'adjustment',
        delta,
        cost,
        'adjustment',
        sourceId,
        membership.memberId,
        now,
      ),
    ]);
    return c.json(
      {
        data: {
          source_id: sourceId,
          outlet_id: body.outlet_id,
          variant_id: body.variant_id,
          quantity_on_hand: balance.quantity_on_hand + delta,
          average_cost_minor: nextAverage,
        },
      },
      201,
    );
  });
}

async function canAccessOutlet(
  db: D1Database,
  businessId: string,
  memberId: string,
  allOutlets: boolean,
  outletId: string,
): Promise<boolean> {
  const row = allOutlets
    ? await db
        .prepare("SELECT id FROM outlets WHERE business_id=? AND id=? AND status='active'")
        .bind(businessId, outletId)
        .first()
    : await db
        .prepare(
          `SELECT o.id FROM outlets o JOIN member_outlets mo ON mo.outlet_id=o.id WHERE o.business_id=? AND o.id=? AND mo.member_id=? AND o.status='active'`,
        )
        .bind(businessId, outletId, memberId)
        .first();
  return Boolean(row);
}

function integer(value: string | number | undefined): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function unavailable(c: { json: (body: unknown, status?: 503) => Response }): Response {
  return c.json({ error: { code: 'CONFIGURATION_ERROR', message: 'Database unavailable' } }, 503);
}
