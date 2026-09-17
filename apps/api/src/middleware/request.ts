import type { MiddlewareHandler } from 'hono';
import type { Env } from '../index';

export const requestSafety: MiddlewareHandler<Env> = async (c, next) => {
  const requestId = crypto.randomUUID();
  c.header('X-Request-ID', requestId);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  await next();
};
