import { HTTPException } from 'hono/http-exception';
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../index';
import { requireSession, type SessionContext } from './session';

export type MembershipContext = SessionContext & {
  businessId: string;
  memberId: string;
  allOutlets: boolean;
  permissions: ReadonlySet<string>;
};

export const businessContext: MiddlewareHandler<Env> = async (c, next) => {
  const session = requireSession(c);
  const businessId = c.req.param('businessId') ?? c.req.header('X-Business-ID');
  if (!businessId || !c.env.DB)
    return c.json(
      { error: { code: 'BUSINESS_REQUIRED', message: 'Business context is required' } },
      400,
    );
  const member = await c.env.DB.prepare(
    `SELECT bm.id, bm.all_outlets,
      GROUP_CONCAT(rp.permission_key) AS permission_keys
    FROM business_members bm
    LEFT JOIN member_roles mr ON mr.member_id = bm.id
    LEFT JOIN role_permissions rp ON rp.role_id = mr.role_id
    WHERE bm.business_id = ? AND bm.user_id = ? AND bm.status = 'active'
    GROUP BY bm.id, bm.all_outlets`,
  )
    .bind(businessId, session.user.id)
    .first<{ id: string; all_outlets: number; permission_keys: string | null }>();
  if (!member) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  c.set('membership', {
    ...session,
    businessId,
    memberId: member.id,
    allOutlets: member.all_outlets === 1,
    permissions: new Set(member.permission_keys?.split(',').filter(Boolean) ?? []),
  });
  await next();
};

export function requirePermission(
  c: { get: (key: 'membership') => MembershipContext | undefined },
  permission: string,
): MembershipContext {
  const membership = c.get('membership');
  if (!membership) throw new HTTPException(401, { message: 'Unauthorized' });
  if (!membership.permissions.has(permission))
    throw new HTTPException(403, { message: 'Forbidden' });
  return membership;
}
