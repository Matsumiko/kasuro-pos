import type { Hono } from 'hono';
import type { Env } from '../index';
import { createId } from '@kasuro/domain';
import { requirePermission, businessContext } from '../middleware/tenant';

export function registerOutletRoutes(app: Hono<Env>): void {
  app.use('/api/v1/businesses/:businessId/outlets', businessContext);
  app.use('/api/v1/businesses/:businessId/registers', businessContext);
  app.use('/api/v1/businesses/:businessId/registers/*', businessContext);
  app.get('/api/v1/businesses/:businessId/outlets', async (c) => {
    const membership = requirePermission(c, 'outlets.view');
    if (!c.env.DB)
      return c.json(
        { error: { code: 'CONFIGURATION_ERROR', message: 'Database unavailable' } },
        503,
      );
    const result = membership.allOutlets
      ? await c.env.DB.prepare(
          `SELECT id,code,name,address,phone,timezone,status FROM outlets WHERE business_id=? ORDER BY name`,
        )
          .bind(membership.businessId)
          .all()
      : await c.env.DB.prepare(
          `SELECT o.id,o.code,o.name,o.address,o.phone,o.timezone,o.status FROM outlets o JOIN member_outlets mo ON mo.outlet_id=o.id WHERE o.business_id=? AND mo.member_id=? ORDER BY o.name`,
        )
          .bind(membership.businessId, membership.memberId)
          .all();
    return c.json({ data: result.results });
  });

  app.get('/api/v1/businesses/:businessId/registers', async (c) => {
    const membership = requirePermission(c, 'outlets.view');
    if (!c.env.DB) return unavailable(c);
    const result = membership.allOutlets
      ? await c.env.DB.prepare(
          "SELECT r.id,r.outlet_id,r.name,r.status FROM registers r JOIN outlets o ON o.id=r.outlet_id WHERE r.business_id=? AND o.status='active' ORDER BY o.name,r.name",
        )
          .bind(membership.businessId)
          .all()
      : await c.env.DB.prepare(
          "SELECT r.id,r.outlet_id,r.name,r.status FROM registers r JOIN outlets o ON o.id=r.outlet_id JOIN member_outlets mo ON mo.outlet_id=o.id AND mo.member_id=? WHERE r.business_id=? AND o.status='active' ORDER BY o.name,r.name",
        )
          .bind(membership.memberId, membership.businessId)
          .all();
    return c.json({ data: result.results });
  });

  app.post('/api/v1/businesses/:businessId/outlets', async (c) => {
    const membership = requirePermission(c, 'outlets.manage');
    if (!c.env.DB)
      return c.json(
        { error: { code: 'CONFIGURATION_ERROR', message: 'Database unavailable' } },
        503,
      );
    const body = await c.req.json<{
      code?: string;
      name?: string;
      address?: string;
      phone?: string;
      timezone?: string;
    }>();
    const code = body.code?.trim().toUpperCase();
    const name = body.name?.trim();
    if (!code || !name || code.length > 32 || name.length > 120)
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Outlet code and name are required' } },
        422,
      );
    const now = new Date().toISOString();
    const outletId = createId();
    try {
      await c.env.DB.prepare(
        `INSERT INTO outlets(id,business_id,code,name,address,phone,timezone,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'active',?,?)`,
      )
        .bind(
          outletId,
          membership.businessId,
          code,
          name,
          body.address?.trim() ?? null,
          body.phone?.trim() ?? null,
          body.timezone?.trim() ?? null,
          now,
          now,
        )
        .run();
      await c.env.DB.prepare(
        `INSERT INTO registers(id,business_id,outlet_id,name,status,created_at,updated_at) VALUES(?,?,?,'Register 1','active',?,?)`,
      )
        .bind(createId(), membership.businessId, outletId, now, now)
        .run();
    } catch {
      return c.json({ error: { code: 'CONFLICT', message: 'Outlet code already exists' } }, 409);
    }
    return c.json(
      { data: { id: outletId, business_id: membership.businessId, code, name, status: 'active' } },
      201,
    );
  });

  app.patch('/api/v1/businesses/:businessId/outlets/:outletId', async (c) => {
    const membership = requirePermission(c, 'outlets.manage');
    if (!c.env.DB)
      return c.json(
        { error: { code: 'CONFIGURATION_ERROR', message: 'Database unavailable' } },
        503,
      );
    const body = await c.req.json<{
      name?: string;
      status?: 'active' | 'inactive';
      address?: string;
      phone?: string;
      timezone?: string;
    }>();
    const current = await c.env.DB.prepare('SELECT id FROM outlets WHERE business_id=? AND id=?')
      .bind(membership.businessId, c.req.param('outletId'))
      .first();
    if (!current) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    const fields: string[] = [];
    const values: unknown[] = [];
    if (body.name?.trim()) {
      fields.push('name=?');
      values.push(body.name.trim());
    }
    if (body.status) {
      fields.push('status=?');
      values.push(body.status);
    }
    if (body.address !== undefined) {
      fields.push('address=?');
      values.push(body.address.trim());
    }
    if (body.phone !== undefined) {
      fields.push('phone=?');
      values.push(body.phone.trim());
    }
    if (body.timezone !== undefined) {
      fields.push('timezone=?');
      values.push(body.timezone.trim());
    }
    if (fields.length === 0)
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'No changes supplied' } }, 422);
    fields.push('updated_at=?');
    values.push(new Date().toISOString(), membership.businessId, c.req.param('outletId'));
    await c.env.DB.prepare(`UPDATE outlets SET ${fields.join(',')} WHERE business_id=? AND id=?`)
      .bind(...values)
      .run();
    return c.json({ data: { id: c.req.param('outletId'), updated: true } });
  });
}
function unavailable(c: { json: (body: unknown, status?: 503) => Response }): Response {
  return c.json({ error: { code: 'CONFIGURATION_ERROR', message: 'Database unavailable' } }, 503);
}
