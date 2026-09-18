import type { MiddlewareHandler } from 'hono';
import type { Env } from '../index';

export const requestSafety: MiddlewareHandler<Env> = async (c, next) => {
  const requestId = crypto.randomUUID();
  c.header('X-Request-ID', requestId);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  const contentLength = Number(c.req.header('Content-Length') ?? 0);
  if (contentLength > 1_048_576)
    return c.json(
      { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } },
      413,
    );
  if (['POST', 'PUT', 'PATCH'].includes(c.req.method) && c.req.path.startsWith('/api/')) {
    const contentType = c.req.header('Content-Type') ?? '';
    if (contentLength > 0 && !contentType.toLowerCase().startsWith('application/json'))
      return c.json(
        { error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'JSON content is required' } },
        415,
      );
  }
  await next();
};
