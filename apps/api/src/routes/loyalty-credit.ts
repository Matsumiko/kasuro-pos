import type { Hono } from 'hono';
import type { Env } from '../index';
import { createId } from '@kasuro/domain';
import { businessContext, requirePermission } from '../middleware/tenant';

export function registerLoyaltyCreditRoutes(app: Hono<Env>): void {
  app.use('/api/v1/businesses/:businessId/customers/:customerId/loyalty', businessContext);
  app.use('/api/v1/businesses/:businessId/customers/:customerId/loyalty/*', businessContext);
  app.use('/api/v1/businesses/:businessId/customers/:customerId/credit', businessContext);
  app.use('/api/v1/businesses/:businessId/customers/:customerId/credit/*', businessContext);

  app.get('/api/v1/businesses/:businessId/customers/:customerId/loyalty', async (c) => {
    const membership = requirePermission(c, 'customers.view_manage');
    if (!c.env.DB) return unavailable(c);
    const customerId = c.req.param('customerId');
    const customer = await c.env.DB.prepare(
      "SELECT id FROM customers WHERE id=? AND business_id=? AND status='active'",
    )
      .bind(customerId, membership.businessId)
      .first();
    if (!customer) return notFound(c);
    const account = await c.env.DB.prepare(
      'SELECT id,customer_id,points_balance,updated_at FROM loyalty_accounts WHERE business_id=? AND customer_id=?',
    )
      .bind(membership.businessId, customerId)
      .first();
    return c.json({ data: account ?? { customer_id: customerId, points_balance: 0 } });
  });

  app.post('/api/v1/businesses/:businessId/customers/:customerId/loyalty/adjust', async (c) => {
    const membership = requirePermission(c, 'loyalty.manage');
    if (!c.env.DB) return unavailable(c);
    const customerId = c.req.param('customerId');
    const body = await c.req.json<{ points_delta?: number; reason?: string }>();
    const delta = body.points_delta;
    if (
      typeof delta !== 'number' ||
      !Number.isInteger(delta) ||
      delta === 0 ||
      !body.reason?.trim()
    )
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Non-zero points and reason are required' } },
        422,
      );
    const customer = await c.env.DB.prepare(
      "SELECT id FROM customers WHERE id=? AND business_id=? AND status='active'",
    )
      .bind(customerId, membership.businessId)
      .first();
    if (!customer) return notFound(c);
    const current = await c.env.DB.prepare(
      'SELECT points_balance FROM loyalty_accounts WHERE business_id=? AND customer_id=?',
    )
      .bind(membership.businessId, customerId)
      .first<{ points_balance: number }>();
    if ((current?.points_balance ?? 0) + delta < 0)
      return c.json(
        { error: { code: 'CONFLICT', message: 'Points balance cannot be negative' } },
        409,
      );
    const now = new Date().toISOString();
    const sourceId = createId();
    try {
      const results = await c.env.DB.batch([
        c.env.DB.prepare(
          'INSERT INTO loyalty_accounts(id,business_id,customer_id,points_balance,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(business_id,customer_id) DO UPDATE SET points_balance=points_balance+excluded.points_balance,updated_at=excluded.updated_at WHERE points_balance+excluded.points_balance>=0',
        ).bind(createId(), membership.businessId, customerId, delta, now, now),
        c.env.DB.prepare(
          'INSERT INTO loyalty_ledger(id,business_id,customer_id,points_delta,source_type,source_id,actor_member_id,created_at) SELECT ?,?,?,?,?,?,?,? WHERE changes()>0',
        ).bind(
          createId(),
          membership.businessId,
          customerId,
          delta,
          'manual_adjustment',
          sourceId,
          membership.memberId,
          now,
        ),
      ]);
      if (!results[0]?.meta.changes || !results[1]?.meta.changes)
        return c.json(
          { error: { code: 'CONFLICT', message: 'Points balance cannot be negative' } },
          409,
        );
    } catch (error) {
      if (String(error).includes('UNIQUE'))
        return c.json(
          { error: { code: 'CONFLICT', message: 'Points adjustment already recorded' } },
          409,
        );
      throw error;
    }
    const balance = await c.env.DB.prepare(
      'SELECT points_balance FROM loyalty_accounts WHERE business_id=? AND customer_id=?',
    )
      .bind(membership.businessId, customerId)
      .first<{ points_balance: number }>();
    return c.json(
      {
        data: {
          customer_id: customerId,
          points_balance: balance?.points_balance ?? 0,
          source_id: sourceId,
        },
      },
      201,
    );
  });

  app.get('/api/v1/businesses/:businessId/customers/:customerId/credit', async (c) => {
    const membership = requirePermission(c, 'customers.view_manage');
    if (!c.env.DB) return unavailable(c);
    const customerId = c.req.param('customerId');
    const customer = await c.env.DB.prepare(
      "SELECT id FROM customers WHERE id=? AND business_id=? AND status='active'",
    )
      .bind(customerId, membership.businessId)
      .first();
    if (!customer) return notFound(c);
    const account = await c.env.DB.prepare(
      'SELECT id,customer_id,credit_limit_minor,balance_minor,updated_at FROM credit_accounts WHERE business_id=? AND customer_id=?',
    )
      .bind(membership.businessId, customerId)
      .first();
    return c.json({
      data: account ?? { customer_id: customerId, credit_limit_minor: 0, balance_minor: 0 },
    });
  });
  app.put('/api/v1/businesses/:businessId/customers/:customerId/credit', async (c) => {
    const membership = requirePermission(c, 'customers.credit_manage');
    if (!c.env.DB) return unavailable(c);
    const customerId = c.req.param('customerId');
    const body = await c.req.json<{ credit_limit_minor?: number }>();
    const limit = body.credit_limit_minor;
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 0)
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Non-negative credit limit is required' } },
        422,
      );
    const customer = await c.env.DB.prepare(
      "SELECT id FROM customers WHERE id=? AND business_id=? AND status='active'",
    )
      .bind(customerId, membership.businessId)
      .first();
    if (!customer) return notFound(c);
    const current = await c.env.DB.prepare(
      'SELECT balance_minor FROM credit_accounts WHERE business_id=? AND customer_id=?',
    )
      .bind(membership.businessId, customerId)
      .first<{ balance_minor: number }>();
    if (current && limit < current.balance_minor)
      return c.json(
        { error: { code: 'CREDIT_LIMIT', message: 'Limit cannot be below outstanding balance' } },
        409,
      );
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      'INSERT INTO credit_accounts(id,business_id,customer_id,credit_limit_minor,balance_minor,created_at,updated_at) VALUES(?,?,?,?,0,?,?) ON CONFLICT(business_id,customer_id) DO UPDATE SET credit_limit_minor=excluded.credit_limit_minor,updated_at=excluded.updated_at',
    )
      .bind(createId(), membership.businessId, customerId, limit, now, now)
      .run();
    return c.json({
      data: {
        customer_id: customerId,
        credit_limit_minor: limit,
        balance_minor: current?.balance_minor ?? 0,
      },
    });
  });

  app.post('/api/v1/businesses/:businessId/customers/:customerId/credit/charge', async (c) => {
    const membership = requirePermission(c, 'customers.credit_manage');
    if (!c.env.DB) return unavailable(c);
    const customerId = c.req.param('customerId');
    const body = await c.req.json<{ amount_minor?: number; source_id?: string }>();
    const amount = body.amount_minor;
    if (
      typeof amount !== 'number' ||
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      !body.source_id?.trim()
    )
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Positive amount and source are required' } },
        422,
      );
    const customer = await c.env.DB.prepare(
      "SELECT id FROM customers WHERE id=? AND business_id=? AND status='active'",
    )
      .bind(customerId, membership.businessId)
      .first();
    if (!customer) return notFound(c);
    const account = await c.env.DB.prepare(
      'SELECT balance_minor,credit_limit_minor FROM credit_accounts WHERE business_id=? AND customer_id=?',
    )
      .bind(membership.businessId, customerId)
      .first<{ balance_minor: number; credit_limit_minor: number }>();
    if (!account || account.balance_minor + amount > account.credit_limit_minor)
      return c.json({ error: { code: 'CREDIT_LIMIT', message: 'Credit limit exceeded' } }, 409);
    const now = new Date().toISOString();
    const sourceId = body.source_id.trim();
    try {
      const results = await c.env.DB.batch([
        c.env.DB.prepare(
          'UPDATE credit_accounts SET balance_minor=balance_minor+?,updated_at=? WHERE business_id=? AND customer_id=? AND balance_minor+?<=credit_limit_minor',
        ).bind(amount, now, membership.businessId, customerId, amount),
        c.env.DB.prepare(
          'INSERT INTO credit_ledger(id,business_id,customer_id,amount_delta_minor,source_type,source_id,actor_member_id,created_at) SELECT ?,?,?,?,?,?,?,? WHERE changes()>0',
        ).bind(
          createId(),
          membership.businessId,
          customerId,
          amount,
          'charge',
          sourceId,
          membership.memberId,
          now,
        ),
      ]);
      if (!results[0]?.meta.changes || !results[1]?.meta.changes)
        return c.json({ error: { code: 'CREDIT_LIMIT', message: 'Credit limit exceeded' } }, 409);
    } catch (error) {
      if (String(error).includes('UNIQUE'))
        return c.json(
          { error: { code: 'CONFLICT', message: 'Credit source already recorded' } },
          409,
        );
      throw error;
    }
    const updated = await c.env.DB.prepare(
      'SELECT balance_minor FROM credit_accounts WHERE business_id=? AND customer_id=?',
    )
      .bind(membership.businessId, customerId)
      .first<{ balance_minor: number }>();
    return c.json(
      {
        data: {
          customer_id: customerId,
          amount_minor: amount,
          balance_minor: updated?.balance_minor ?? account.balance_minor + amount,
        },
      },
      201,
    );
  });

  app.post('/api/v1/businesses/:businessId/customers/:customerId/credit/payment', async (c) => {
    const membership = requirePermission(c, 'customers.credit_manage');
    if (!c.env.DB) return unavailable(c);
    const customerId = c.req.param('customerId');
    const body = await c.req.json<{ amount_minor?: number }>();
    const amount = body.amount_minor;
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0)
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Positive payment is required' } },
        422,
      );
    const customer = await c.env.DB.prepare(
      "SELECT id FROM customers WHERE id=? AND business_id=? AND status='active'",
    )
      .bind(customerId, membership.businessId)
      .first();
    if (!customer) return notFound(c);
    const account = await c.env.DB.prepare(
      'SELECT balance_minor FROM credit_accounts WHERE business_id=? AND customer_id=?',
    )
      .bind(membership.businessId, customerId)
      .first<{ balance_minor: number }>();
    if (!account || account.balance_minor < amount)
      return c.json(
        { error: { code: 'CREDIT_LIMIT', message: 'Payment exceeds outstanding credit' } },
        409,
      );
    const now = new Date().toISOString();
    const sourceId = createId();
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE credit_accounts SET balance_minor=balance_minor-?,updated_at=? WHERE business_id=? AND customer_id=? AND balance_minor>=?',
      ).bind(amount, now, membership.businessId, customerId, amount),
      c.env.DB.prepare(
        'INSERT INTO credit_ledger(id,business_id,customer_id,amount_delta_minor,source_type,source_id,actor_member_id,created_at) SELECT ?,?,?,?,?,?,?,? WHERE changes()>0',
      ).bind(
        createId(),
        membership.businessId,
        customerId,
        -amount,
        'payment',
        sourceId,
        membership.memberId,
        now,
      ),
    ]);
    if (!results[0]?.meta.changes || !results[1]?.meta.changes)
      return c.json(
        { error: { code: 'CREDIT_LIMIT', message: 'Payment exceeds outstanding credit' } },
        409,
      );
    return c.json(
      { data: { customer_id: customerId, amount_minor: amount, source_id: sourceId } },
      201,
    );
  });
}

function notFound(c: { json: (body: unknown, status?: 404) => Response }): Response {
  return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
}
function unavailable(c: { json: (body: unknown, status?: 503) => Response }): Response {
  return c.json({ error: { code: 'CONFIGURATION_ERROR', message: 'Database unavailable' } }, 503);
}
