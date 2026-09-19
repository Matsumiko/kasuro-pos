import type { Hono } from 'hono';
import type { Env } from '../index';
import { businessContext, requirePermission } from '../middleware/tenant';

export function registerOnboardingRoutes(app: Hono<Env>): void {
  app.use('/api/v1/businesses/:businessId/setup', businessContext);
  app.get('/api/v1/businesses/:businessId/setup', async (c) => {
    const membership = requirePermission(c, 'settings.view');
    if (!c.env.DB) return unavailable(c);
    const business = await c.env.DB.prepare(
      `SELECT b.id,b.name,b.slug,b.timezone,b.currency_code,b.setup_step,b.setup_completed_at,
       (SELECT COUNT(*) FROM outlets o WHERE o.business_id=b.id AND o.status='active') AS outlet_count,
       (SELECT COUNT(*) FROM products p WHERE p.business_id=b.id AND p.status='active') AS product_count,
       (SELECT COUNT(*) FROM business_members bm WHERE bm.business_id=b.id AND bm.status='active') AS staff_count
       FROM businesses b WHERE b.id=? AND b.status='active'`,
    )
      .bind(membership.businessId)
      .first();
    if (!business) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    return c.json({ data: business });
  });
  app.patch('/api/v1/businesses/:businessId/setup', async (c) => {
    const membership = requirePermission(c, 'settings.manage');
    if (!c.env.DB) return unavailable(c);
    const body = await c.req.json<{
      setup_step?: string;
      completed?: boolean;
      stock_policy?: 'prevent_negative' | 'allow_negative';
      tax_mode?: 'exclusive' | 'inclusive';
      default_tax_rate_bp?: number | string;
      enabled_payment_methods?: string[];
    }>();
    const steps = ['business', 'outlet', 'configure', 'products', 'staff', 'first-sale', 'complete'];
    if (!body.setup_step || !steps.includes(body.setup_step))
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid setup step' } }, 422);
    const current = await c.env.DB.prepare(
      `SELECT setup_step FROM businesses WHERE id=? AND status='active'`,
    )
      .bind(membership.businessId)
      .first<{ setup_step: string }>();
    if (!current) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    const currentIndex = Math.max(0, steps.indexOf(current.setup_step));
    const requestedIndex = steps.indexOf(body.setup_step);
    if (requestedIndex > currentIndex + 1)
      return c.json({ error: { code: 'CONFLICT', message: 'Complete the previous setup step first' } }, 409);
    if (body.setup_step === 'configure' || body.setup_step === 'products') {
      const outlet = await c.env.DB.prepare(
        "SELECT 1 FROM outlets WHERE business_id=? AND status='active' LIMIT 1",
      )
        .bind(membership.businessId)
        .first();
      if (!outlet)
        return c.json({ error: { code: 'CONFLICT', message: 'Create an outlet first' } }, 409);
    }
    const taxRate = body.default_tax_rate_bp === undefined ? undefined : Number(body.default_tax_rate_bp);
    if (taxRate !== undefined && (!Number.isInteger(taxRate) || taxRate < 0 || taxRate > 10000))
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid tax rate' } }, 422);
    if (body.enabled_payment_methods && (!body.enabled_payment_methods.length || body.enabled_payment_methods.some((method) => !['cash', 'transfer', 'qris'].includes(method))))
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid payment methods' } }, 422);
    const now = new Date().toISOString();
    const completedAt = body.completed || body.setup_step === 'complete' ? now : null;
    const statements = [];
    if (body.stock_policy || body.tax_mode || taxRate !== undefined || body.enabled_payment_methods) {
      const settings = await c.env.DB.prepare('SELECT business_id FROM business_settings WHERE business_id=?')
        .bind(membership.businessId)
        .first();
      if (!settings)
        return c.json({ error: { code: 'CONFIGURATION_ERROR', message: 'Business settings unavailable' } }, 503);
      const fields: string[] = [];
      const values: unknown[] = [];
      if (body.stock_policy) { fields.push('stock_policy=?'); values.push(body.stock_policy); }
      if (body.tax_mode) { fields.push('tax_mode=?'); values.push(body.tax_mode); }
      if (taxRate !== undefined) { fields.push('default_tax_rate_bp=?'); values.push(taxRate); }
      if (body.enabled_payment_methods) { fields.push('enabled_payment_methods=?'); values.push(JSON.stringify(body.enabled_payment_methods)); }
      fields.push('updated_at=?');
      values.push(now, membership.businessId);
      statements.push(c.env.DB.prepare(`UPDATE business_settings SET ${fields.join(',')} WHERE business_id=?`).bind(...values));
    }
    statements.push(
      c.env.DB.prepare('UPDATE businesses SET setup_step=?,setup_completed_at=?,updated_at=? WHERE id=? AND status=\'active\'').bind(
        body.setup_step,
        completedAt,
        now,
        membership.businessId,
      ),
    );
    await c.env.DB.batch(statements);
    return c.json({ data: { setup_step: body.setup_step, setup_completed_at: completedAt } });
  });
}
function unavailable(c: { json: (body: unknown, status?: 503) => Response }): Response {
  return c.json({ error: { code: 'CONFIGURATION_ERROR', message: 'Database unavailable' } }, 503);
}
