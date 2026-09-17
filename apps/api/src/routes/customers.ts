import type { Hono } from 'hono';
import type { Env } from '../index';
import { createId } from '@kasuro/domain';
import { businessContext, requirePermission } from '../middleware/tenant';

export function registerCustomerRoutes(app: Hono<Env>): void {
  app.use('/api/v1/businesses/:businessId/customers', businessContext);
  app.get('/api/v1/businesses/:businessId/customers', async (c) => {
    const membership = requirePermission(c, 'customers.view_manage');
    if (!c.env.DB) return unavailable(c);
    const q = c.req.query('q')?.trim() ?? '';
    const result = await c.env.DB.prepare(
      `SELECT id,customer_code,name,phone,email,total_spend_minor,transaction_count,last_transaction_at FROM customers WHERE business_id=? AND status='active' AND (?='' OR name LIKE ? OR phone LIKE ? OR customer_code LIKE ?) ORDER BY name LIMIT 100`,
    )
      .bind(membership.businessId, q, `%${q}%`, `%${q}%`, `%${q}%`)
      .all();
    return c.json({ data: result.results });
  });
  app.post('/api/v1/businesses/:businessId/customers', async (c) => {
    const membership = requirePermission(c, 'customers.view_manage');
    if (!c.env.DB) return unavailable(c);
    const body = await c.req.json<{
      name?: string;
      customer_code?: string;
      phone?: string;
      email?: string;
      notes?: string;
    }>();
    const name = body.name?.trim();
    const code = body.customer_code?.trim().toUpperCase() || `CUS-${Date.now()}`;
    if (!name || name.length > 120 || code.length > 40)
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Customer name is required' } },
        422,
      );
    const now = new Date().toISOString();
    const id = createId();
    try {
      await c.env.DB.prepare(
        `INSERT INTO customers(id,business_id,customer_code,name,phone,email,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?, ?,?)`,
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
      return c.json({ error: { code: 'CONFLICT', message: 'Customer code already exists' } }, 409);
    }
    return c.json({ data: { id, customer_code: code, name } }, 201);
  });
}
function unavailable(c: { json: (body: unknown, status?: 503) => Response }): Response {
  return c.json({ error: { code: 'CONFIGURATION_ERROR', message: 'Database unavailable' } }, 503);
}
