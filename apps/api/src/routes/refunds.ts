import type { Hono } from 'hono';
import type { Env } from '../index';
import { createId } from '@kasuro/domain';
import { sha256 } from '../modules/crypto';
import { businessContext, requirePermission } from '../middleware/tenant';
export function registerRefundRoutes(app: Hono<Env>): void {
  app.use('/api/v1/businesses/:businessId/refunds', businessContext);
  app.use('/api/v1/businesses/:businessId/refunds/*', businessContext);

  app.get('/api/v1/businesses/:businessId/refunds', async (c) => {
    const membership = requirePermission(c, 'sales.view');
    if (!c.env.DB) return unavailable(c);
    const saleId = c.req.query('sale_id');
    const outletScope = membership.allOutlets
      ? ''
      : ' AND EXISTS (SELECT 1 FROM member_outlets mo WHERE mo.member_id=? AND mo.outlet_id=s.outlet_id)';
    const saleScope = saleId ? 'AND r.sale_id=?' : '';
    const binds = membership.allOutlets
      ? saleId
        ? [membership.businessId, saleId]
        : [membership.businessId]
      : saleId
        ? [membership.businessId, saleId, membership.memberId]
        : [membership.businessId, membership.memberId];
    const result = await c.env.DB.prepare(
      `SELECT r.id,r.sale_id,r.status,r.reason,r.amount_minor,r.payment_method,r.created_at,s.receipt_number,s.outlet_id
       FROM refunds r JOIN sales s ON s.id=r.sale_id AND s.business_id=r.business_id
       WHERE r.business_id=? ${saleScope} ${outletScope}
       ORDER BY r.created_at DESC,r.id DESC LIMIT 100`,
    )
      .bind(...binds)
      .all();
    return c.json({ data: result.results });
  });

  app.get('/api/v1/businesses/:businessId/refunds/:refundId', async (c) => {
    const membership = requirePermission(c, 'sales.view');
    if (!c.env.DB) return unavailable(c);
    const refund = await c.env.DB.prepare(
      `SELECT r.id,r.sale_id,r.status,r.reason,r.amount_minor,r.payment_method,r.created_at,s.receipt_number,s.outlet_id
       FROM refunds r JOIN sales s ON s.id=r.sale_id AND s.business_id=r.business_id
       WHERE r.id=? AND r.business_id=?`,
    )
      .bind(c.req.param('refundId'), membership.businessId)
      .first();
    if (
      !refund ||
      !(await canAccessOutlet(
        c.env.DB,
        membership.businessId,
        membership.memberId,
        membership.allOutlets,
        String(refund.outlet_id),
      ))
    )
      return notFound(c);
    const lines = await c.env.DB.prepare(
      `SELECT rl.id,rl.sale_line_id,rl.quantity,rl.amount_minor,sl.product_name,sl.sku
       FROM refund_lines rl
       JOIN refunds r ON r.id=rl.refund_id AND r.business_id=?
       JOIN sale_lines sl ON sl.id=rl.sale_line_id AND sl.sale_id=r.sale_id
       WHERE rl.refund_id=? ORDER BY rl.id`,
    )
      .bind(membership.businessId, c.req.param('refundId'))
      .all();
    return c.json({ data: { ...refund, lines: lines.results } });
  });

  app.post('/api/v1/businesses/:businessId/refunds', async (c) => {
    const membership = requirePermission(c, 'sales.refund');
    if (!c.env.DB) return unavailable(c);
    const db = c.env.DB;
    const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
    if (!idempotencyKey || idempotencyKey.length > 160)
      return c.json(
        { error: { code: 'IDEMPOTENCY_REQUIRED', message: 'Idempotency-Key is required' } },
        422,
      );
    const body = await c.req.json<{
      sale_id?: string;
      reason?: string;
      payment_method?: string;
      lines?: Array<{ sale_line_id: string; quantity: string | number }>;
    }>();
    const payloadHash = await sha256(JSON.stringify(body));
    const existing = await db
      .prepare(
        'SELECT request_hash,response_json FROM idempotency_keys WHERE business_id=? AND endpoint_key=?',
      )
      .bind(membership.businessId, `refund:${idempotencyKey}`)
      .first<{ request_hash: string; response_json: string | null }>();
    if (existing) {
      if (existing.request_hash !== payloadHash)
        return c.json(
          {
            error: {
              code: 'IDEMPOTENCY_KEY_REUSED',
              message: 'Idempotency key was used for a different payload',
            },
          },
          409,
        );
      if (existing.response_json)
        return c.json({ ...JSON.parse(existing.response_json), idempotent: true });
      return c.json({ data: { status: 'pending' }, idempotent: true }, 202);
    }
    if (
      !body.sale_id ||
      !body.reason?.trim() ||
      body.reason.trim().length > 500 ||
      !['cash', 'bank_transfer', 'store_credit'].includes(body.payment_method?.trim() ?? '') ||
      !body.lines?.length
    )
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Sale, valid reason, payment method and lines are required',
          },
        },
        422,
      );
    const lineIds = body.lines.map((line) => line.sale_line_id);
    if (new Set(lineIds).size !== lineIds.length)
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Refund lines must be unique' } },
        422,
      );
    const sale = await db
      .prepare(
        `SELECT id,outlet_id,status FROM sales WHERE id=? AND business_id=? AND status IN ('completed','partially_refunded')`,
      )
      .bind(body.sale_id, membership.businessId)
      .first<{ id: string; outlet_id: string; status: string }>();
    if (
      !sale ||
      !(await canAccessOutlet(
        db,
        membership.businessId,
        membership.memberId,
        membership.allOutlets,
        sale.outlet_id,
      ))
    )
      return notFound(c);
    const placeholders = lineIds.map(() => '?').join(',');
    const original = await db
      .prepare(
        `SELECT id,variant_id,unit_price_minor,item_discount_minor,tax_minor,line_net_minor,quantity,refundable_quantity,unit_cost_minor FROM sale_lines WHERE sale_id=? AND id IN (${placeholders})`,
      )
      .bind(body.sale_id, ...lineIds)
      .all<{
        id: string;
        variant_id: string;
        unit_price_minor: number;
        item_discount_minor: number;
        tax_minor: number;
        line_net_minor: number;
        quantity: number;
        refundable_quantity: number;
        unit_cost_minor: number;
      }>();
    if (original.results.length !== lineIds.length)
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Refund line not found' } }, 422);
    const quantities = body.lines.map((input) => ({
      quantity: integer(input.quantity),
      item: original.results.find((row) => row.id === input.sale_line_id)!,
    }));
    if (
      quantities.some(
        ({ quantity, item }) =>
          quantity === undefined || quantity <= 0 || quantity > item.refundable_quantity,
      )
    )
      return c.json(
        { error: { code: 'REFUND_LIMIT', message: 'Refund quantity exceeds refundable quantity' } },
        409,
      );
    const amount = quantities.reduce(
      (sum, { quantity, item }) => sum + refundAmount(item, quantity!),
      0,
    );
    const refundId = createId();
    const now = new Date().toISOString();
    const remainingRow = await db
      .prepare(
        'SELECT COALESCE(SUM(refundable_quantity),0) AS remaining FROM sale_lines WHERE sale_id=?',
      )
      .bind(body.sale_id)
      .first<{ remaining: number }>();
    const requestedQuantity = quantities.reduce((sum, row) => sum + row.quantity!, 0);
    const nextStatus =
      (remainingRow?.remaining ?? 0) - requestedQuantity === 0 ? 'refunded' : 'partially_refunded';
    const statements = [
      db
        .prepare(
          'INSERT INTO idempotency_keys(business_id,actor_member_id,endpoint_key,request_hash,response_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?)',
        )
        .bind(
          membership.businessId,
          membership.memberId,
          `refund:${idempotencyKey}`,
          payloadHash,
          null,
          now,
          new Date(Date.now() + 86_400_000).toISOString(),
        ),
      db
        .prepare(
          `INSERT INTO refunds(id,business_id,sale_id,status,reason,amount_minor,payment_method,actor_member_id,created_at,updated_at) VALUES(?,?,?,'completed',?,?,?,?,?,?)`,
        )
        .bind(
          refundId,
          membership.businessId,
          body.sale_id,
          body.reason.trim(),
          amount,
          body.payment_method!,
          membership.memberId,
          now,
          now,
        ),
    ];
    for (const { quantity, item } of quantities) {
      statements.push(
        db
          .prepare(
            'INSERT INTO refund_lines(id,refund_id,sale_line_id,quantity,amount_minor,created_at) VALUES(?,?,?,?,?,?)',
          )
          .bind(createId(), refundId, item.id, quantity, refundAmount(item, quantity!), now),
        db
          .prepare(
            'UPDATE sale_lines SET refundable_quantity=refundable_quantity-? WHERE id=? AND sale_id=? AND refundable_quantity>=?',
          )
          .bind(quantity, item.id, body.sale_id, quantity),
        db
          .prepare('UPDATE sale_lines SET refundable_quantity=-1 WHERE id=? AND changes()=0')
          .bind(item.id),
        db
          .prepare(
            'UPDATE inventory_balances SET quantity_on_hand=quantity_on_hand+?,updated_at=? WHERE business_id=? AND outlet_id=? AND variant_id=?',
          )
          .bind(quantity, now, membership.businessId, sale.outlet_id, item.variant_id),
        db
          .prepare(
            'INSERT INTO stock_movements(id,business_id,outlet_id,variant_id,movement_type,quantity_delta,unit_cost_minor,source_type,source_id,actor_member_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            createId(),
            membership.businessId,
            sale.outlet_id,
            item.variant_id,
            'refund',
            quantity,
            item.unit_cost_minor,
            'refund',
            refundId,
            membership.memberId,
            now,
          ),
      );
    }
    statements.push(
      db
        .prepare(
          "UPDATE sales SET status=CASE WHEN NOT EXISTS (SELECT 1 FROM sale_lines WHERE sale_id=? AND refundable_quantity>0) THEN 'refunded' ELSE 'partially_refunded' END,updated_at=? WHERE id=? AND business_id=? AND status IN ('completed','partially_refunded')",
        )
        .bind(body.sale_id, now, body.sale_id, membership.businessId),
    );
    const responseBody = {
      data: {
        id: refundId,
        sale_id: body.sale_id,
        amount_minor: amount,
        status: 'completed',
        sale_status: nextStatus,
      },
    };
    statements[0] = db
      .prepare(
        'INSERT INTO idempotency_keys(business_id,actor_member_id,endpoint_key,request_hash,response_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?)',
      )
      .bind(
        membership.businessId,
        membership.memberId,
        `refund:${idempotencyKey}`,
        payloadHash,
        JSON.stringify(responseBody),
        now,
        new Date(Date.now() + 86_400_000).toISOString(),
      );
    try {
      await db.batch([
        ...statements,
        db
          .prepare(
            'INSERT INTO audit_events(id,business_id,actor_user_id,actor_member_id,action,entity_type,entity_id,summary_json,request_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            createId(),
            membership.businessId,
            membership.user.id,
            membership.memberId,
            'sales.refund.completed',
            'refund',
            refundId,
            JSON.stringify({
              sale_id: body.sale_id,
              amount_minor: amount,
              lines: quantities.map(({ item, quantity }) => ({ sale_line_id: item.id, quantity })),
            }),
            c.req.header('X-Request-ID') ?? null,
            now,
          ),
      ]);
    } catch (error) {
      if (String(error).includes('REFUND_LIMIT'))
        return c.json(
          { error: { code: 'REFUND_LIMIT', message: 'Refund quantity is no longer available' } },
          409,
        );
      if (String(error).includes('REFUND_LINE_SALE_MISMATCH'))
        return c.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Refund line does not belong to sale' } },
          422,
        );
      if (String(error).includes('UNIQUE'))
        return c.json({ error: { code: 'CONFLICT', message: 'Refund already exists' } }, 409);
      throw error;
    }
    return c.json(responseBody, 201);
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
          "SELECT o.id FROM outlets o JOIN member_outlets mo ON mo.outlet_id=o.id WHERE o.business_id=? AND o.id=? AND mo.member_id=? AND o.status='active'",
        )
        .bind(businessId, outletId, memberId)
        .first();
  return Boolean(row);
}

function integer(value: string | number): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function notFound(c: { json: (body: unknown, status?: 404) => Response }): Response {
  return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
}

function refundAmount(
  item: { line_net_minor: number; quantity: number },
  quantity: number,
): number {
  return Math.floor(
    (item.line_net_minor * quantity + Math.floor(item.quantity / 2)) / item.quantity,
  );
}

function unavailable(c: { json: (body: unknown, status?: 503) => Response }): Response {
  return c.json({ error: { code: 'CONFIGURATION_ERROR', message: 'Database unavailable' } }, 503);
}
