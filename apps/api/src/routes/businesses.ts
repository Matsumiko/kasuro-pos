import type { Hono } from 'hono';
import type { Env } from '../index';
import { businessCreateSchema } from '@kasuro/contracts/auth';
import { createId } from '@kasuro/domain';
import { requireSession } from '../middleware/session';
import { businessContext, requirePermission } from '../middleware/tenant';

export function registerBusinessRoutes(app: Hono<Env>): void {
  app.get('/api/v1/businesses', async (c) => {
    const session = requireSession(c);
    if (!c.env.DB)
      return c.json(
        { error: { code: 'CONFIGURATION_ERROR', message: 'Database unavailable' } },
        503,
      );
    const result = await c.env.DB.prepare(
      `SELECT b.id,b.name,b.slug,b.status,b.timezone,b.currency_code,bm.id AS member_id,bm.all_outlets
      FROM businesses b JOIN business_members bm ON bm.business_id=b.id
      WHERE bm.user_id=? AND bm.status='active' AND b.status='active' ORDER BY b.name`,
    )
      .bind(session.user.id)
      .all();
    return c.json({ data: result.results });
  });

  app.post('/api/v1/businesses', async (c) => {
    const session = requireSession(c);
    const input = businessCreateSchema.safeParse(await c.req.json());
    if (!input.success)
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid business data',
            details: input.error.flatten().fieldErrors,
          },
        },
        422,
      );
    if (!c.env.DB)
      return c.json(
        { error: { code: 'CONFIGURATION_ERROR', message: 'Database unavailable' } },
        503,
      );
    const db = c.env.DB;
    const now = new Date().toISOString();
    const businessId = createId();
    const memberId = createId();
    const statements = [
      db
        .prepare(
          `INSERT INTO businesses(id,name,slug,status,country_code,currency_code,currency_exponent,timezone,created_at,updated_at) VALUES(?,?,?,'active','ID','IDR',0,?,?,?)`,
        )
        .bind(businessId, input.data.name, input.data.slug, input.data.timezone, now, now),
      db
        .prepare(
          `INSERT INTO business_members(id,business_id,user_id,status,all_outlets,joined_at,created_at,updated_at) VALUES(?,?,?,'active',1,?,?,?)`,
        )
        .bind(memberId, businessId, session.user.id, now, now, now),
      db
        .prepare(`INSERT INTO business_settings(business_id,created_at,updated_at) VALUES(?,?,?)`)
        .bind(businessId, now, now),
      db
        .prepare(`INSERT INTO member_roles(member_id,role_id) VALUES(?, 'role-owner')`)
        .bind(memberId),
    ];
    await db.batch(statements);
    return c.json(
      {
        data: { id: businessId, name: input.data.name, slug: input.data.slug, member_id: memberId },
      },
      201,
    );
  });

  app.get('/api/v1/businesses/:businessId', businessContext, (c) => {
    const membership = requirePermission(c, 'settings.view');
    return c.json({
      data: {
        business_id: membership.businessId,
        member_id: membership.memberId,
        all_outlets: membership.allOutlets,
        permissions: [...membership.permissions],
      },
    });
  });
}
