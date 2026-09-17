import type { Hono } from 'hono';
import type { Env } from '../index';
import { createId } from '@kasuro/domain';
import { businessContext, requirePermission } from '../middleware/tenant';
import { sha256 } from '../modules/crypto';

export function registerStaffRoutes(app: Hono<Env>): void {
  app.use('/api/v1/businesses/:businessId/staff', businessContext);
  app.use('/api/v1/businesses/:businessId/staff/*', businessContext);
  app.get('/api/v1/businesses/:businessId/staff', async (c) => {
    const membership = requirePermission(c, 'staff.view');
    if (!c.env.DB) return unavailable(c);
    const result = await c.env.DB.prepare(
      `SELECT bm.id,bm.user_id,u.email,u.display_name,bm.status,bm.all_outlets,GROUP_CONCAT(r.name) AS roles FROM business_members bm JOIN users u ON u.id=bm.user_id LEFT JOIN member_roles mr ON mr.member_id=bm.id LEFT JOIN roles r ON r.id=mr.role_id WHERE bm.business_id=? GROUP BY bm.id ORDER BY u.display_name LIMIT 100`,
    )
      .bind(membership.businessId)
      .all();
    return c.json({ data: result.results });
  });
  app.post('/api/v1/businesses/:businessId/staff/invitations', async (c) => {
    const membership = requirePermission(c, 'staff.invite');
    if (!c.env.DB) return unavailable(c);
    const body = await c.req.json<{ email?: string; role_key?: string }>();
    const email = body.email?.trim().toLowerCase();
    const roleKey = body.role_key?.trim() || 'cashier';
    if (!email || !email.includes('@') || email.length > 254)
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Valid email is required' } },
        422,
      );
    const role = await c.env.DB.prepare('SELECT id FROM roles WHERE business_id IS NULL AND key=?')
      .bind(roleKey)
      .first<{ id: string }>();
    if (!role)
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Role is not available' } }, 422);
    const rawToken = crypto.randomUUID() + crypto.randomUUID();
    const now = new Date();
    const expires = new Date(now.getTime() + 7 * 86400000).toISOString();
    await c.env.DB.prepare(
      `INSERT INTO invitations(id,business_id,email,role_id,token_hash,expires_at,invited_by_member_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?, ?,?)`,
    )
      .bind(
        createId(),
        membership.businessId,
        email,
        role.id,
        await sha256(rawToken),
        expires,
        membership.memberId,
        now.toISOString(),
        now.toISOString(),
      )
      .run();
    return c.json(
      { data: { email, role_key: roleKey, expires_at: expires, invitation_token: rawToken } },
      201,
    );
  });
}
function unavailable(c: { json: (body: unknown, status?: 503) => Response }): Response {
  return c.json({ error: { code: 'CONFIGURATION_ERROR', message: 'Database unavailable' } }, 503);
}
