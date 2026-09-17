import type { Hono } from 'hono';
import type { Env } from '../index';
import { createId } from '@kasuro/domain';
import { businessContext, requirePermission, type MembershipContext } from '../middleware/tenant';

export function registerStockRoutes(app: Hono<Env>): void {
  app.use('/api/v1/businesses/:businessId/stock-counts', businessContext);
  app.use('/api/v1/businesses/:businessId/stock-counts/*', businessContext);
  app.use('/api/v1/businesses/:businessId/stock-transfers', businessContext);
  app.use('/api/v1/businesses/:businessId/stock-transfers/*', businessContext);

  app.get('/api/v1/businesses/:businessId/stock-counts', async (c) => {
    const membership = requirePermission(c, 'inventory.view');
    if (!c.env.DB) return unavailable(c);
    const result = await c.env.DB.prepare(
      'SELECT id,outlet_id,status,created_at,updated_at FROM stock_counts WHERE business_id=? ORDER BY created_at DESC LIMIT 100',
    )
      .bind(membership.businessId)
      .all();
    return c.json({ data: result.results });
  });

  app.post('/api/v1/businesses/:businessId/stock-counts', async (c) => {
    const membership = requirePermission(c, 'inventory.stock_opname');
    if (!c.env.DB) return unavailable(c);
    const body = await c.req.json<{
      outlet_id?: string;
      lines?: Array<{ variant_id?: string; physical_quantity?: number }>;
    }>();
    if (
      !body.outlet_id ||
      !Array.isArray(body.lines) ||
      body.lines.length === 0 ||
      body.lines.length > 500
    )
      return c.json(
        {
          error: { code: 'VALIDATION_ERROR', message: 'Outlet and stock count lines are required' },
        },
        422,
      );
    if (!(await canAccessOutlet(c.env.DB, membership, body.outlet_id))) return notFound(c);
    const variantIds = body.lines
      .map((line) => line.variant_id)
      .filter((id): id is string => Boolean(id));
    if (
      variantIds.length !== body.lines.length ||
      new Set(variantIds).size !== variantIds.length ||
      body.lines.some(
        (line) => !Number.isInteger(line.physical_quantity) || (line.physical_quantity ?? -1) < 0,
      )
    )
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Each line needs a unique variant and non-negative quantity',
          },
        },
        422,
      );
    const placeholders = variantIds.map(() => '?').join(',');
    const balances = await c.env.DB.prepare(
      `SELECT variant_id,quantity_on_hand FROM inventory_balances WHERE business_id=? AND outlet_id=? AND variant_id IN (${placeholders})`,
    )
      .bind(membership.businessId, body.outlet_id, ...variantIds)
      .all<{ variant_id: string; quantity_on_hand: number }>();
    if (balances.results.length !== variantIds.length) return notFound(c);
    const expected = new Map(balances.results.map((row) => [row.variant_id, row.quantity_on_hand]));
    const now = new Date().toISOString();
    const countId = createId();
    const statements = [
      c.env.DB.prepare(
        "INSERT INTO stock_counts(id,business_id,outlet_id,status,created_by_member_id,created_at,updated_at) VALUES(?,?,?,'counting',?,?,?)",
      ).bind(countId, membership.businessId, body.outlet_id, membership.memberId, now, now),
    ];
    for (const line of body.lines)
      statements.push(
        c.env.DB.prepare(
          'INSERT INTO stock_count_lines(id,stock_count_id,variant_id,expected_quantity,physical_quantity,difference_quantity,created_at) VALUES(?,?,?,?,?,?,?)',
        ).bind(
          createId(),
          countId,
          line.variant_id,
          expected.get(line.variant_id as string),
          line.physical_quantity,
          (line.physical_quantity as number) - (expected.get(line.variant_id as string) ?? 0),
          now,
        ),
      );
    await c.env.DB.batch(statements);
    return c.json({ data: { id: countId, status: 'counting', outlet_id: body.outlet_id } }, 201);
  });

  app.post('/api/v1/businesses/:businessId/stock-counts/:countId/post', async (c) => {
    const membership = requirePermission(c, 'inventory.stock_opname');
    if (!c.env.DB) return unavailable(c);
    const countId = c.req.param('countId');
    const count = await c.env.DB.prepare(
      "SELECT id,outlet_id,status FROM stock_counts WHERE id=? AND business_id=? AND status IN ('counting','review','approved')",
    )
      .bind(countId, membership.businessId)
      .first<{ id: string; outlet_id: string; status: string }>();
    if (!count || !(await canAccessOutlet(c.env.DB, membership, count.outlet_id)))
      return notFound(c);
    const lines = await c.env.DB.prepare(
      'SELECT scl.variant_id,scl.expected_quantity,scl.physical_quantity,ib.average_cost_minor FROM stock_count_lines scl JOIN inventory_balances ib ON ib.business_id=? AND ib.outlet_id=? AND ib.variant_id=scl.variant_id WHERE scl.stock_count_id=?',
    )
      .bind(membership.businessId, count.outlet_id, countId)
      .all<{
        variant_id: string;
        expected_quantity: number;
        physical_quantity: number | null;
        average_cost_minor: number;
      }>();
    if (!lines.results.length || lines.results.some((line) => line.physical_quantity === null))
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'All stock count lines must be counted' } },
        422,
      );
    const now = new Date().toISOString();
    const statements = [
      c.env.DB.prepare(
        "UPDATE stock_counts SET status='posted',approved_by_member_id=?,updated_at=? WHERE id=? AND business_id=?",
      ).bind(membership.memberId, now, countId, membership.businessId),
    ];
    for (const line of lines.results) {
      const delta = line.physical_quantity! - line.expected_quantity;
      if (!delta) continue;
      statements.push(
        c.env.DB.prepare(
          'UPDATE inventory_balances SET quantity_on_hand=?,updated_at=? WHERE business_id=? AND outlet_id=? AND variant_id=?',
        ).bind(
          line.physical_quantity,
          now,
          membership.businessId,
          count.outlet_id,
          line.variant_id,
        ),
      );
      statements.push(
        c.env.DB.prepare(
          'INSERT INTO stock_movements(id,business_id,outlet_id,variant_id,movement_type,quantity_delta,unit_cost_minor,source_type,source_id,actor_member_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        ).bind(
          createId(),
          membership.businessId,
          count.outlet_id,
          line.variant_id,
          'stock_count',
          delta,
          line.average_cost_minor,
          'stock_count',
          countId,
          membership.memberId,
          now,
        ),
      );
    }
    await c.env.DB.batch(statements);
    return c.json({ data: { id: countId, status: 'posted' } });
  });

  app.get('/api/v1/businesses/:businessId/stock-transfers', async (c) => {
    const membership = requirePermission(c, 'inventory.view');
    if (!c.env.DB) return unavailable(c);
    const result = await c.env.DB.prepare(
      'SELECT id,source_outlet_id,destination_outlet_id,status,created_at,updated_at FROM stock_transfers WHERE business_id=? ORDER BY created_at DESC LIMIT 100',
    )
      .bind(membership.businessId)
      .all();
    return c.json({ data: result.results });
  });

  app.post('/api/v1/businesses/:businessId/stock-transfers', async (c) => {
    const membership = requirePermission(c, 'inventory.transfer');
    if (!c.env.DB) return unavailable(c);
    const body = await c.req.json<{
      source_outlet_id?: string;
      destination_outlet_id?: string;
      lines?: Array<{ variant_id?: string; quantity?: number }>;
    }>();
    if (
      !body.source_outlet_id ||
      !body.destination_outlet_id ||
      body.source_outlet_id === body.destination_outlet_id ||
      !Array.isArray(body.lines) ||
      !body.lines.length ||
      body.lines.length > 500
    )
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Distinct outlets and transfer lines are required',
          },
        },
        422,
      );
    if (
      !(await canAccessOutlet(c.env.DB, membership, body.source_outlet_id)) ||
      !(await canAccessOutlet(c.env.DB, membership, body.destination_outlet_id))
    )
      return notFound(c);
    if (
      body.lines.some(
        (line) => !line.variant_id || !Number.isInteger(line.quantity) || (line.quantity ?? 0) <= 0,
      ) ||
      new Set(body.lines.map((line) => line.variant_id)).size !== body.lines.length
    )
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Each line needs a unique positive quantity',
          },
        },
        422,
      );
    const ids = body.lines.map((line) => line.variant_id!);
    const placeholders = ids.map(() => '?').join(',');
    const variants = await c.env.DB.prepare(
      `SELECT id FROM product_variants WHERE business_id=? AND status='active' AND id IN (${placeholders})`,
    )
      .bind(membership.businessId, ...ids)
      .all();
    if (variants.results.length !== ids.length) return notFound(c);
    const now = new Date().toISOString();
    const transferId = createId();
    const statements = [
      c.env.DB.prepare(
        "INSERT INTO stock_transfers(id,business_id,source_outlet_id,destination_outlet_id,status,created_by_member_id,created_at,updated_at) VALUES(?,?,?,?,'requested',?,?,?)",
      ).bind(
        transferId,
        membership.businessId,
        body.source_outlet_id,
        body.destination_outlet_id,
        membership.memberId,
        now,
        now,
      ),
    ];
    for (const line of body.lines)
      statements.push(
        c.env.DB.prepare(
          'INSERT INTO stock_transfer_lines(id,transfer_id,variant_id,quantity_requested,created_at) VALUES(?,?,?,?,?)',
        ).bind(createId(), transferId, line.variant_id, line.quantity, now),
      );
    await c.env.DB.batch(statements);
    return c.json({ data: { id: transferId, status: 'requested' } }, 201);
  });

  app.post('/api/v1/businesses/:businessId/stock-transfers/:transferId/receive', async (c) => {
    const membership = requirePermission(c, 'inventory.transfer');
    if (!c.env.DB) return unavailable(c);
    const transferId = c.req.param('transferId');
    const transfer = await c.env.DB.prepare(
      "SELECT id,source_outlet_id,destination_outlet_id,status FROM stock_transfers WHERE id=? AND business_id=? AND status IN ('requested','approved','sent','partially_received')",
    )
      .bind(transferId, membership.businessId)
      .first<{
        id: string;
        source_outlet_id: string;
        destination_outlet_id: string;
        status: string;
      }>();
    if (!transfer || !(await canAccessOutlet(c.env.DB, membership, transfer.destination_outlet_id)))
      return notFound(c);
    const lines = await c.env.DB.prepare(
      'SELECT variant_id,quantity_requested,quantity_received FROM stock_transfer_lines WHERE transfer_id=?',
    )
      .bind(transferId)
      .all<{ variant_id: string; quantity_requested: number; quantity_received: number }>();
    if (!lines.results.length) return notFound(c);
    const now = new Date().toISOString();
    const statements = [];
    for (const line of lines.results) {
      const quantity = line.quantity_requested - line.quantity_received;
      if (!quantity) continue;
      statements.push(
        c.env.DB.prepare(
          'UPDATE inventory_balances SET quantity_on_hand=quantity_on_hand-?,updated_at=? WHERE business_id=? AND outlet_id=? AND variant_id=? AND quantity_on_hand>=?',
        ).bind(
          quantity,
          now,
          membership.businessId,
          transfer.source_outlet_id,
          line.variant_id,
          quantity,
        ),
      );
      statements.push(
        c.env.DB.prepare(
          'UPDATE inventory_balances SET quantity_on_hand=quantity_on_hand+?,updated_at=? WHERE business_id=? AND outlet_id=? AND variant_id=?',
        ).bind(
          quantity,
          now,
          membership.businessId,
          transfer.destination_outlet_id,
          line.variant_id,
        ),
      );
      statements.push(
        c.env.DB.prepare(
          'UPDATE stock_transfer_lines SET quantity_sent=quantity_requested,quantity_received=quantity_requested WHERE transfer_id=? AND variant_id=?',
        ).bind(transferId, line.variant_id),
      );
      statements.push(
        c.env.DB.prepare(
          'INSERT INTO stock_movements(id,business_id,outlet_id,variant_id,movement_type,quantity_delta,unit_cost_minor,source_type,source_id,actor_member_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        ).bind(
          createId(),
          membership.businessId,
          transfer.source_outlet_id,
          line.variant_id,
          'transfer_out',
          -quantity,
          0,
          'stock_transfer',
          transferId,
          membership.memberId,
          now,
        ),
      );
      statements.push(
        c.env.DB.prepare(
          'INSERT INTO stock_movements(id,business_id,outlet_id,variant_id,movement_type,quantity_delta,unit_cost_minor,source_type,source_id,actor_member_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        ).bind(
          createId(),
          membership.businessId,
          transfer.destination_outlet_id,
          line.variant_id,
          'transfer_in',
          quantity,
          0,
          'stock_transfer',
          transferId,
          membership.memberId,
          now,
        ),
      );
    }
    statements.push(
      c.env.DB.prepare(
        "UPDATE stock_transfers SET status='received',updated_at=? WHERE id=? AND business_id=?",
      ).bind(now, transferId, membership.businessId),
    );
    await c.env.DB.batch(statements);
    return c.json({ data: { id: transferId, status: 'received' } });
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
          "SELECT o.id FROM outlets o JOIN member_outlets mo ON mo.outlet_id=o.id WHERE o.business_id=? AND o.id=? AND mo.member_id=? AND o.status='active'",
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
