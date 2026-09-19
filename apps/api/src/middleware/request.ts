import type { MiddlewareHandler } from 'hono';
import type { Env } from '../index';

const MAX_BODY_BYTES = 1_048_576;
const RATE_WINDOW_MS = 60_000;
const RATE_POLICIES = {
  auth: { limit: 30, message: 'Too many authentication requests' },
  reports: { limit: 20, message: 'Too many report or export requests' },
  invitations: { limit: 10, message: 'Too many invitation requests' },
} as const;
type RatePolicy = keyof typeof RATE_POLICIES;
const rateWindows = new Map<string, { startedAt: number; count: number }>();

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

  const rateLimit = requestRateLimit(c.req.path, c.req.method, c.req.header('CF-Connecting-IP'));
  if (rateLimit) {
    c.header('Retry-After', String(rateLimit.retryAfterSeconds));
    c.header('X-RateLimit-Limit', String(rateLimit.limit));
    c.header('X-RateLimit-Remaining', '0');
    return c.json({ error: { code: 'TOO_MANY_REQUESTS', message: rateLimit.message } }, 429);
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

function requestRateLimit(
  path: string,
  method: string,
  ip: string | undefined,
): { retryAfterSeconds: number; limit: number; message: string } | null {
  if (!ip) return null;
  const policy = ratePolicy(path, method);
  if (!policy) return null;
  const now = Date.now();
  for (const [key, window] of rateWindows)
    if (now - window.startedAt >= RATE_WINDOW_MS) rateWindows.delete(key);
  const key = `${ip}:${policy}`;
  const current = rateWindows.get(key);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    rateWindows.set(key, { startedAt: now, count: 1 });
    return null;
  }
  current.count += 1;
  const config = RATE_POLICIES[policy];
  if (current.count <= config.limit) return null;
  return {
    retryAfterSeconds: Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - current.startedAt)) / 1000)),
    limit: config.limit,
    message: config.message,
  };
}

function ratePolicy(path: string, method: string): RatePolicy | null {
  if (path === '/api/v1/auth/login' || path === '/api/v1/auth/register') return 'auth';
  if (method === 'POST' && path.endsWith('/staff/invitations')) return 'invitations';
  if (method === 'GET' && (path.includes('/reports/') || path.includes('/export/')))
    return 'reports';
  return null;
}
