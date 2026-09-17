import type { Hono } from 'hono';
import type { Env } from '../index';
import { requireSession } from '../middleware/session';

export function registerPlatformRoutes(app: Hono<Env>): void {
  app.get('/api/v1/platform/metrics', async (c) => {
    const session = requireSession(c);
    if (!c.env.DB || !(await isPlatformAdmin(c.env.DB, session.user.id)))
      return c.json({ error: { code: 'FORBIDDEN', message: 'Platform access required' } }, 403);
    const metrics = await c.env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM users) AS users,(SELECT COUNT(*) FROM businesses) AS businesses,(SELECT COUNT(*) FROM businesses WHERE status='active') AS active_businesses`,
    ).first();
    return c.json({ data: metrics });
  });
  app.get('/api/v1/platform/businesses', async (c) => {
    const session = requireSession(c);
    if (!c.env.DB || !(await isPlatformAdmin(c.env.DB, session.user.id)))
      return c.json({ error: { code: 'FORBIDDEN', message: 'Platform access required' } }, 403);
    const rows = await c.env.DB.prepare(
      `SELECT id,name,slug,status,currency_code,timezone,created_at FROM businesses ORDER BY created_at DESC LIMIT 100`,
    ).all();
    return c.json({ data: rows.results });
  });
  app.post('/api/v1/platform/businesses/:businessId/plan', async (c) => {
    const session = requireSession(c);
    if (!c.env.DB || !(await isPlatformAdmin(c.env.DB, session.user.id)))
      return c.json({ error: { code: 'FORBIDDEN', message: 'Platform access required' } }, 403);
    const body = await c.req.json<{ plan_key?: string }>();
    if (!body.plan_key?.trim() || !/^[a-z0-9_-]{1,40}$/.test(body.plan_key))
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Valid plan key is required' } },
        422,
      );
    const plan = await c.env.DB.prepare('SELECT id FROM plans WHERE key=?')
      .bind(body.plan_key)
      .first<{ id: string }>();
    if (!plan) return c.json({ error: { code: 'NOT_FOUND', message: 'Plan not found' } }, 404);
    const businessId = c.req.param('businessId');
    const now = new Date().toISOString();
    const business = await c.env.DB.prepare('SELECT id FROM businesses WHERE id=?')
      .bind(businessId)
      .first();
    if (!business) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    await c.env.DB.prepare(
      "INSERT INTO business_subscriptions(business_id,plan_id,status,starts_at,updated_at) VALUES(?,?, 'active',?,?) ON CONFLICT(business_id) DO UPDATE SET plan_id=excluded.plan_id,status='active',updated_at=excluded.updated_at",
    )
      .bind(businessId, plan.id, now, now)
      .run();
    await c.env.DB.prepare(
      'INSERT INTO platform_audit_events(id,actor_user_id,action,entity_type,entity_id,summary_json,created_at) VALUES(?,?,?,?,?,?,?)',
    )
      .bind(
        crypto.randomUUID(),
        session.user.id,
        'business.plan_assigned',
        'business',
        businessId,
        JSON.stringify({ plan_key: body.plan_key }),
        now,
      )
      .run();
    return c.json({ data: { business_id: businessId, plan_key: body.plan_key } });
  });
  app.post('/api/v1/platform/businesses/:businessId/status', async (c) => {
    const session = requireSession(c);
    if (!c.env.DB || !(await isPlatformAdmin(c.env.DB, session.user.id)))
      return c.json({ error: { code: 'FORBIDDEN', message: 'Platform access required' } }, 403);
    const body = await c.req.json<{ status?: 'active' | 'suspended' | 'disabled' }>();
    if (!body.status)
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Status is required' } }, 422);
    const businessId = c.req.param('businessId');
    const now = new Date().toISOString();
    const updated = await c.env.DB.prepare('UPDATE businesses SET status=?,updated_at=? WHERE id=?')
      .bind(body.status, now, businessId)
      .run();
    if (!updated.meta.changes)
      return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    await c.env.DB.prepare(
      'INSERT INTO platform_audit_events(id,actor_user_id,action,entity_type,entity_id,summary_json,created_at) VALUES(?,?,?,?,?,?,?)',
    )
      .bind(
        crypto.randomUUID(),
        session.user.id,
        `business.${body.status}`,
        'business',
        businessId,
        JSON.stringify({ status: body.status }),
        now,
      )
      .run();
    return c.json({ data: { business_id: businessId, status: body.status } });
  });
  app.get('/api/v1/platform/audit', async (c) => {
    const session = requireSession(c);
    if (!c.env.DB || !(await isPlatformAdmin(c.env.DB, session.user.id)))
      return c.json({ error: { code: 'FORBIDDEN', message: 'Platform access required' } }, 403);
    const rows = await c.env.DB.prepare(
      'SELECT id,actor_user_id,action,entity_type,entity_id,summary_json,created_at FROM platform_audit_events ORDER BY created_at DESC,id DESC LIMIT 100',
    ).all();
    return c.json({ data: rows.results });
  });
}
async function isPlatformAdmin(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT user_id FROM platform_admins WHERE user_id=? AND status='active'")
    .bind(userId)
    .first();
  return Boolean(row);
}
