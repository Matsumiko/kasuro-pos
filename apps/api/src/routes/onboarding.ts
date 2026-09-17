import type { Hono } from 'hono';
import type { Env } from '../index';
import { businessContext, requirePermission } from '../middleware/tenant';

export function registerOnboardingRoutes(app: Hono<Env>): void {
  app.use('/api/v1/businesses/:businessId/setup', businessContext);
  app.get('/api/v1/businesses/:businessId/setup', async (c) => {
    const membership = requirePermission(c, 'settings.view');
    if (!c.env.DB) return unavailable(c);
    const business = await c.env.DB.prepare(
      "SELECT setup_step,setup_completed_at FROM businesses WHERE id=? AND status='active'",
    )
      .bind(membership.businessId)
      .first();
    return c.json({ data: business });
  });
  app.patch('/api/v1/businesses/:businessId/setup', async (c) => {
    const membership = requirePermission(c, 'settings.manage');
    if (!c.env.DB) return unavailable(c);
    const body = await c.req.json<{ setup_step?: string; completed?: boolean }>();
    const allowed = new Set([
      'business',
      'outlet',
      'configure',
      'products',
      'staff',
      'first-sale',
      'complete',
    ]);
    if (!body.setup_step || !allowed.has(body.setup_step))
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid setup step' } }, 422);
    const completedAt = body.completed ? new Date().toISOString() : null;
    await c.env.DB.prepare(
      "UPDATE businesses SET setup_step=?,setup_completed_at=?,updated_at=? WHERE id=? AND status='active'",
    )
      .bind(body.setup_step, completedAt, new Date().toISOString(), membership.businessId)
      .run();
    return c.json({ data: { setup_step: body.setup_step, setup_completed_at: completedAt } });
  });
}
function unavailable(c: { json: (body: unknown, status?: 503) => Response }): Response {
  return c.json({ error: { code: 'CONFIGURATION_ERROR', message: 'Database unavailable' } }, 503);
}
