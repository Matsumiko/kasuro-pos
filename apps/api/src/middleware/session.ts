import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../index';
import { sha256 } from '../modules/crypto';

export type AuthUser = { id: string; email: string; displayName: string };
export type SessionContext = { user: AuthUser; sessionId: string; csrfTokenHash: string };

export const sessionMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  const cookieToken = getCookie(
    c.req.header('Cookie'),
    c.env.SESSION_COOKIE_NAME ?? 'kasuro_session',
  );
  const bearer = c.req.header('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = cookieToken ?? bearer;
  if (!token || !c.env.DB) return next();
  const tokenHash = await sha256(token);
  const row = await c.env.DB.prepare(
    `SELECT s.id, s.csrf_token_hash, u.id AS user_id, u.email, u.display_name
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > datetime('now')
      AND s.absolute_expires_at > datetime('now') AND u.status = 'active'`,
  )
    .bind(tokenHash)
    .first<{
      id: string;
      csrf_token_hash: string;
      user_id: string;
      email: string;
      display_name: string;
    }>();
  if (row)
    c.set('session', {
      user: { id: row.user_id, email: row.email, displayName: row.display_name },
      sessionId: row.id,
      csrfTokenHash: row.csrf_token_hash,
    });
  await next();
};

export function requireSession(c: {
  get: (key: 'session') => SessionContext | undefined;
}): SessionContext {
  const session = c.get('session');
  if (!session) throw new HTTPException(401, { message: 'Unauthorized' });
  return session;
}

function getCookie(header: string | undefined, name: string): string | undefined {
  const prefix = `${name}=`;
  return header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}
