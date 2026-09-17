import type { MiddlewareHandler } from 'hono';
import type { Env } from '../index';
import { sha256 } from '../modules/crypto';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const csrfProtection: MiddlewareHandler<Env> = async (c, next) => {
  if (!MUTATING_METHODS.has(c.req.method)) return next();
  const session = c.get('session');
  if (!session) return next();
  const origin = c.req.header('Origin');
  if (origin && origin !== c.env.WEB_ORIGIN)
    return c.json(
      { error: { code: 'CSRF_ORIGIN_REJECTED', message: 'Request origin is not allowed' } },
      403,
    );
  const supplied = c.req.header('X-CSRF-Token');
  if (!supplied || !((await sha256(supplied)) === session.csrfTokenHash))
    return c.json({ error: { code: 'CSRF_REJECTED', message: 'CSRF validation failed' } }, 403);
  await next();
};
