import type { Hono } from 'hono';
import type { Env } from '../index';
import { createId } from '@kasuro/domain';
import { businessContext, requirePermission } from '../middleware/tenant';

export function registerRefundRoutes(app: Hono<Env>): void {
  app.use('/api/v1/businesses/:businessId/refunds', businessContext);
  app.post('/api/v1/businesses/:businessId/refunds', async (c) => {
    const membership = requirePermission(c, 'sales.refund');
    if (!c.env.DB) return unavailable(c);
    const body = await c.req.json<{
      sale_id?: string;
      reason?: string;
      payment_method?: string;
      lines?: Array<{ sale_line_id: string; quantity: string | number }>;
    }>();
    if (!body.sale_id || !body.reason?.trim() || !body.payment_method || !body.lines?.length)
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Sale, reason, payment method and lines are required',
          },
        },
        422,
      );
    const sale = await c.env.DB.prepare(
      `SELECT id,outlet_id,status FROM sales WHERE id=? AND business_id=? AND status IN ('completed','partially_refunded')`,
    )
      .bind(body.sale_id, membership.businessId)
      .first<{ id: string; outlet_id: string; status: string }>();
    if (!sale) return c.json({ error: { code: 'NOT_FOUND', message: 'Sale not found' } }, 404);
    const lineIds = body.lines.map((line) => line.sale_line_id);
    const placeholders = lineIds.map(() => '?').join(',');
    const original = await c.env.DB.prepare(
      `SELECT id,variant_id,unit_price_minor,quantity,refundable_quantity,unit_cost_minor FROM sale_lines WHERE sale_id=? AND id IN (${placeholders})`,
    )
      .bind(body.sale_id, ...lineIds)
      .all<{
        id: string;
        variant_id: string;
        unit_price_minor: number;
        quantity: number;
        refundable_quantity: number;
        unit_cost_minor: number;
      }>();
    if (original.results.length !== lineIds.length)
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Refund line not found' } }, 422);
    const requested = body.lines.map((line) => ({
      input: line,
      original: original.results.find((item) => item.id === line.sale_line_id)!,
    }));
    const quantities = requested.map(({ input, original: item }) => ({
      quantity: integer(input.quantity),
      item,
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
      (sum, { quantity, item }) => sum + quantity! * item.unit_price_minor,
      0,
    );
    const refundId = createId();
    const now = new Date().toISOString();
    const statements = [
      c.env.DB.prepare(
        `INSERT INTO refunds(id,business_id,sale_id,status,reason,amount_minor,payment_method,actor_member_id,created_at,updated_at) VALUES(?,?,?,'completed',?,?,?,?,?,?)`,
      ).bind(
        refundId,
        membership.businessId,
        body.sale_id,
        body.reason.trim(),
        amount,
        body.payment_method,
        membership.memberId,
        now,
        now,
      ),
    ];
    for (const { quantity, item } of quantities) {
      statements.push(
        c.env.DB.prepare(
          'INSERT INTO refund_lines(id,refund_id,sale_line_id,quantity,amount_minor,created_at) VALUES(?,?,?,?,?,?)',
        ).bind(createId(), refundId, item.id, quantity, quantity! * item.unit_price_minor, now),
      );
      statements.push(
        c.env.DB.prepare(
          'UPDATE sale_lines SET refundable_quantity=refundable_quantity-? WHERE id=? AND sale_id=?',
        ).bind(quantity, item.id, body.sale_id),
      );
      statements.push(
        c.env.DB.prepare(
          `UPDATE inventory_balances SET quantity_on_hand=quantity_on_hand+?,updated_at=? WHERE business_id=? AND outlet_id=? AND variant_id=?`,
        ).bind(quantity, now, membership.businessId, sale.outlet_id, item.variant_id),
      );
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO stock_movements(id,business_id,outlet_id,variant_id,movement_type,quantity_delta,unit_cost_minor,source_type,source_id,actor_member_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        ).bind(
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
    await c.env.DB.batch(statements);
    const remaining = await c.env.DB.prepare(
      'SELECT COALESCE(SUM(refundable_quantity),0) AS remaining FROM sale_lines WHERE sale_id=?',
    )
      .bind(body.sale_id)
      .first<{ remaining: number }>();
    const nextStatus = (remaining?.remaining ?? 0) === 0 ? 'refunded' : 'partially_refunded';
    await c.env.DB.prepare('UPDATE sales SET status=?,updated_at=? WHERE id=? AND business_id=?')
      .bind(nextStatus, now, body.sale_id, membership.businessId)
      .run();
    return c.json(
      {
        data: {
          id: refundId,
          sale_id: body.sale_id,
          amount_minor: amount,
          status: 'completed',
          sale_status: nextStatus,
        },
      },
      201,
    );
  });
}

function integer(value: string | number): number | undefined {
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
