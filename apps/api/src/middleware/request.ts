import type { MiddlewareHandler } from 'hono';
import type { Env } from '../index';

const MAX_BODY_BYTES = 1_048_576;
const AUTH_RATE_WINDOW_MS = 60_000;
const AUTH_RATE_LIMIT = 30;
const authRateWindows = new Map<string, { startedAt: number; count: number }>();

export const requestSafety: MiddlewareHandler<Env> = async (c, next) => {
  const requestId = crypto.randomUUID();
  c.header('X-Request-ID', requestId);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  );
  c.header('Cache-Control', 'no-store');
  if (c.env.ENVIRONMENT !== 'local')
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  const contentLengthHeader = c.req.header('Content-Length');
  const contentLength = contentLengthHeader === undefined ? 0 : Number(contentLengthHeader);
  if (
    (contentLengthHeader !== undefined &&
      (!Number.isSafeInteger(contentLength) || contentLength < 0)) ||
    contentLength > MAX_BODY_BYTES
  )
    return c.json(
      {
        error: {
          code: contentLength > MAX_BODY_BYTES ? 'PAYLOAD_TOO_LARGE' : 'INVALID_CONTENT_LENGTH',
          message:
            contentLength > MAX_BODY_BYTES
              ? 'Request body is too large'
              : 'Content-Length must be a non-negative integer',
        },
      },
      contentLength > MAX_BODY_BYTES ? 413 : 400,
    );

  const rateLimit = authRateLimit(c.req.path, c.req.header('CF-Connecting-IP'));
  if (rateLimit) {
    c.header('Retry-After', String(rateLimit.retryAfterSeconds));
    c.header('X-RateLimit-Limit', String(AUTH_RATE_LIMIT));
    c.header('X-RateLimit-Remaining', '0');
    return c.json(
      { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many authentication requests' } },
      429,
    );
  }

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

function authRateLimit(path: string, ip: string | undefined): { retryAfterSeconds: number } | null {
  if (!ip || (path !== '/api/v1/auth/login' && path !== '/api/v1/auth/register')) return null;
  const now = Date.now();
  const key = `${ip}:${path}`;
  const current = authRateWindows.get(key);
  if (!current || now - current.startedAt >= AUTH_RATE_WINDOW_MS) {
    authRateWindows.set(key, { startedAt: now, count: 1 });
    return null;
  }
  current.count += 1;
  if (current.count <= AUTH_RATE_LIMIT) return null;
  return {
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((AUTH_RATE_WINDOW_MS - (now - current.startedAt)) / 1000),
    ),
  };
}
