import type { Hono } from 'hono';
import type { Env } from '../index';
import { businessContext, requirePermission } from '../middleware/tenant';
import { sha256 } from '../modules/crypto';

export function registerSyncRoutes(app: Hono<Env>): void {
  app.use('/api/v1/businesses/:businessId/sync', businessContext);
  app.use('/api/v1/businesses/:businessId/sync/*', businessContext);

  app.get('/api/v1/businesses/:businessId/sync/catalog', async (c) => {
    const membership = requirePermission(c, 'pos.use');
    if (!c.env.DB) return unavailable(c);
    const cursor = c.req.query('cursor');
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 100) || 100, 1), 100);
    const result = cursor
      ? await c.env.DB.prepare(
          `SELECT v.id AS variant_id,p.name,p.sku,v.barcode,COALESCE(v.price_minor,p.price_minor) AS price_minor,p.tax_rate_bp,p.unit_key FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.business_id=? AND v.status='active' AND p.status='active' AND v.id>? ORDER BY v.id LIMIT ?`,
        )
          .bind(membership.businessId, cursor, limit + 1)
          .all()
      : await c.env.DB.prepare(
          `SELECT v.id AS variant_id,p.name,p.sku,v.barcode,COALESCE(v.price_minor,p.price_minor) AS price_minor,p.tax_rate_bp,p.unit_key FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.business_id=? AND v.status='active' AND p.status='active' ORDER BY v.id LIMIT ?`,
        )
          .bind(membership.businessId, limit + 1)
          .all();
    const rows = result.results.slice(0, limit);
    return c.json({
      data: rows,
      page: {
        has_more: result.results.length > limit,
        next_cursor: rows.at(-1)?.variant_id ?? null,
      },
    });
  });

  app.post('/api/v1/businesses/:businessId/sync/sales', async (c) => {
    const membership = requirePermission(c, 'sales.create');
    if (!c.env.DB) return unavailable(c);
    const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
    if (!idempotencyKey || idempotencyKey.length > 160)
      return c.json(
        { error: { code: 'IDEMPOTENCY_REQUIRED', message: 'Idempotency-Key is required' } },
        422,
      );
    const body = await c.req.json<OfflineSale>();
    if (body.payment?.method !== 'cash')
      return c.json(
        {
          error: {
            code: 'OFFLINE_PAYMENT_UNSUPPORTED',
            message: 'Offline sync accepts cash sales only',
          },
        },
        422,
      );
    if (
      !body.client_transaction_id ||
      !body.outlet_id ||
      !body.register_id ||
      !body.shift_id ||
      !body.lines?.length
    )
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Offline sale context and lines are required',
          },
        },
        422,
      );
    const payloadHash = await sha256(JSON.stringify(body));
    const existing = await c.env.DB.prepare(
      'SELECT request_hash,response_json FROM idempotency_keys WHERE business_id=? AND endpoint_key=?',
    )
      .bind(membership.businessId, idempotencyKey)
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
    const innerHeaders = new Headers({
      'Content-Type': 'application/json',
      Authorization: c.req.header('Authorization') ?? '',
      Cookie: c.req.header('Cookie') ?? '',
      'X-CSRF-Token': c.req.header('X-CSRF-Token') ?? '',
    });
    const innerRequest = new Request(
      new URL(`/api/v1/businesses/${membership.businessId}/sales`, c.req.url),
      { method: 'POST', headers: innerHeaders, body: JSON.stringify(body) },
    );
    const response = await app.fetch(innerRequest, c.env);
    const text = await response.text();
    if (!response.ok)
      return new Response(text, {
        status: response.status,
        headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
      });
    const responseBody = JSON.parse(text) as Record<string, unknown>;
    const now = new Date().toISOString();
    try {
      await c.env.DB.prepare(
        'INSERT INTO idempotency_keys(business_id,actor_member_id,endpoint_key,request_hash,response_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?)',
      )
        .bind(
          membership.businessId,
          membership.memberId,
          idempotencyKey,
          payloadHash,
          JSON.stringify(responseBody),
          now,
          new Date(Date.now() + 86_400_000).toISOString(),
        )
        .run();
    } catch (error) {
      if (!String(error).includes('UNIQUE')) throw error;
    }
    return c.json(responseBody, response.status === 201 ? 201 : 200);
  });

  app.get('/api/v1/businesses/:businessId/sync/conflicts', async (c) => {
    const membership = requirePermission(c, 'sales.view');
    if (!c.env.DB) return unavailable(c);
    const result = await c.env.DB.prepare(
      `SELECT id,outlet_id,client_transaction_id,total_minor,created_at FROM sales WHERE business_id=? AND status='sync_conflict' AND (?=1 OR EXISTS (SELECT 1 FROM member_outlets mo WHERE mo.member_id=? AND mo.outlet_id=sales.outlet_id)) ORDER BY created_at DESC LIMIT 50`,
    )
      .bind(membership.businessId, membership.allOutlets ? 1 : 0, membership.memberId)
      .all();
    return c.json({ data: result.results });
  });

  app.post('/api/v1/businesses/:businessId/sync/conflicts/:saleId/resolve', async (c) => {
    const membership = requirePermission(c, 'sales.create');
    if (!c.env.DB) return unavailable(c);
    const body = await c.req.json<{ action?: 'accept' | 'void' }>();
    if (body.action !== 'accept' && body.action !== 'void')
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Resolution action is required' } },
        422,
      );
    const sale = await c.env.DB.prepare(
      `SELECT id,outlet_id,status FROM sales WHERE business_id=? AND id=? AND status='sync_conflict'`,
    )
      .bind(membership.businessId, c.req.param('saleId'))
      .first<{ id: string; outlet_id: string }>();
    if (!sale) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    if (!membership.allOutlets) {
      const access = await c.env.DB.prepare(
        'SELECT 1 FROM member_outlets WHERE member_id=? AND outlet_id=?',
      )
        .bind(membership.memberId, sale.outlet_id)
        .first();
      if (!access) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    }
    const nextStatus = body.action === 'void' ? 'void' : 'completed';
    await c.env.DB.prepare(
      "UPDATE sales SET status=?,updated_at=? WHERE business_id=? AND id=? AND status='sync_conflict'",
    )
      .bind(nextStatus, new Date().toISOString(), membership.businessId, sale.id)
      .run();
    return c.json({ data: { id: sale.id, status: nextStatus } });
  });
}

type OfflineSale = {
  client_transaction_id?: string;
  outlet_id?: string;
  register_id?: string;
  shift_id?: string;
  lines?: Array<{ variant_id: string; quantity: number }>;
  payment?: { method: string; amount_minor: number };
};
function unavailable(c: { json: (body: unknown, status?: 503) => Response }): Response {
  return c.json({ error: { code: 'CONFIGURATION_ERROR', message: 'Database unavailable' } }, 503);
}
