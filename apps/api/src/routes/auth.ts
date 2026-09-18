import { deleteCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Hono } from 'hono';
import type { Env } from '../index';
import { hashPassword, sha256, verifyPassword } from '../modules/crypto';
import { createId, createSecret } from '@kasuro/domain';
import { loginSchema, registerSchema } from '@kasuro/contracts/auth';
import { requireSession } from '../middleware/session';

const SESSION_DAYS = 30;
const ABSOLUTE_SESSION_DAYS = 90;

const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export function registerAuthRoutes(app: Hono<Env>): void {
  app.post('/api/v1/auth/register', async (c) => {
    const input = parseBody(registerSchema, await c.req.json());
    if (!input)
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid registration data' } },
        422,
      );
    if (!c.env.DB)
      return c.json(
        { error: { code: 'CONFIGURATION_ERROR', message: 'Database unavailable' } },
        503,
      );
    const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(input.email)
      .first();
    if (existing)
      return c.json(
        { error: { code: 'REGISTRATION_FAILED', message: 'Unable to create account' } },
        400,
      );
    const now = new Date().toISOString();
    const userId = createId();
    const passwordHash = await hashPassword(input.password);
    await c.env.DB.prepare(
      `INSERT INTO users(id,email,password_hash,password_algorithm,display_name,status,created_at,updated_at)
      VALUES(?,?,?,?,?,'active',?,?)`,
    )
      .bind(userId, input.email, passwordHash, 'pbkdf2-sha256', input.display_name, now, now)
      .run();
    const session = await createSession(
      c.env.DB,
      userId,
      c.req.header('CF-Connecting-IP'),
      c.req.header('User-Agent'),
    );
    setSessionCookies(
      c,
      session.token,
      session.csrfToken,
      c.env.SESSION_COOKIE_NAME ?? 'kasuro_session',
      c.env.ENVIRONMENT !== 'local',
    );
    return c.json(
      {
        data: {
          user: { id: userId, email: input.email, display_name: input.display_name },
          needs_business_setup: true,
        },
      },
      201,
    );
  });

  app.post('/api/v1/auth/login', async (c) => {
    const input = parseBody(loginSchema, await c.req.json());
    if (!input || !c.env.DB)
      return c.json(
        { error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' } },
        401,
      );
    const rateKey = await sha256(`${input.email}|${c.req.header('CF-Connecting-IP') ?? 'unknown'}`);
    if (await loginRateLimited(c.env.DB, rateKey))
      return c.json({ error: { code: 'TOO_MANY_ATTEMPTS', message: 'Try again later' } }, 429);
    const row = await c.env.DB.prepare(
      `SELECT id,email,password_hash,display_name FROM users WHERE email = ? AND status = 'active'`,
    )
      .bind(input.email)
      .first<{ id: string; email: string; password_hash: string; display_name: string }>();
    if (!row || !(await verifyPassword(input.password, row.password_hash)))
      return c.json(
        { error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' } },
        401,
      );
    await clearLoginRateLimit(c.env.DB, rateKey);
    const now = new Date().toISOString();
    await c.env.DB.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?')
      .bind(now, now, row.id)
      .run();
    const session = await createSession(
      c.env.DB,
      row.id,
      c.req.header('CF-Connecting-IP'),
      c.req.header('User-Agent'),
    );
    setSessionCookies(
      c,
      session.token,
      session.csrfToken,
      c.env.SESSION_COOKIE_NAME ?? 'kasuro_session',
      c.env.ENVIRONMENT !== 'local',
    );
    return c.json({
      data: { user: { id: row.id, email: row.email, display_name: row.display_name } },
    });
  });

  app.post('/api/v1/auth/logout', async (c) => {
    const session = c.get('session');
    if (session && c.env.DB)
      await c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?')
        .bind(new Date().toISOString(), session.sessionId)
        .run();
    deleteCookie(c, c.env.SESSION_COOKIE_NAME ?? 'kasuro_session', { path: '/' });
    deleteCookie(c, 'kasuro_csrf', { path: '/' });
    return c.json({ data: { logged_out: true } });
  });

  app.get('/api/v1/auth/me', (c) => {
    const session = requireSession(c);
    return c.json({
      data: {
        user: {
          id: session.user.id,
          email: session.user.email,
          display_name: session.user.displayName,
        },
      },
    });
  });
}

async function createSession(
  db: D1Database,
  userId: string,
  ip: string | undefined,
  userAgent: string | undefined,
) {
  const token = createSecret(32);
  const csrfToken = createSecret(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString();
  const absoluteExpiresAt = new Date(
    now.getTime() + ABSOLUTE_SESSION_DAYS * 86_400_000,
  ).toISOString();
  await db
    .prepare(
      `INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,expires_at,absolute_expires_at,last_seen_at,created_at,created_ip_hash,user_agent_summary)
    VALUES(?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      createId(),
      userId,
      await sha256(token),
      await sha256(csrfToken),
      expiresAt,
      absoluteExpiresAt,
      now.toISOString(),
      now.toISOString(),
      ip ? await sha256(ip) : null,
      (userAgent ?? '').slice(0, 160),
    )
    .run();
  return { token, csrfToken };
}

function setSessionCookies(
  c: Parameters<typeof setCookie>[0],
  token: string,
  csrfToken: string,
  sessionCookieName: string,
  secure: boolean,
): void {
  setCookie(c, sessionCookieName, token, {
    httpOnly: true,
    secure,
    sameSite: secure ? 'None' : 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  });
  setCookie(c, 'kasuro_csrf', csrfToken, {
    httpOnly: false,
    secure,
    sameSite: secure ? 'None' : 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  });
}

function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> | undefined {
  const result = schema.safeParse(body);
  return result.success ? result.data : undefined;
}

async function loginRateLimited(db: D1Database, keyHash: string): Promise<boolean> {
  const now = Date.now();
  const row = await db
    .prepare('SELECT window_started_at,attempts FROM auth_rate_limits WHERE key_hash=?')
    .bind(keyHash)
    .first<{ window_started_at: string; attempts: number }>();
  const started = row ? Date.parse(row.window_started_at) : now;
  const activeWindow = row && now - started < LOGIN_WINDOW_MS;
  const attempts = activeWindow ? row.attempts : 0;
  const next = attempts + 1;
  const timestamp = new Date(activeWindow ? started : now).toISOString();
  await db
    .prepare(
      'INSERT INTO auth_rate_limits(key_hash,window_started_at,attempts,updated_at) VALUES(?,?,?,?) ON CONFLICT(key_hash) DO UPDATE SET window_started_at=excluded.window_started_at,attempts=excluded.attempts,updated_at=excluded.updated_at',
    )
    .bind(keyHash, timestamp, next, new Date(now).toISOString())
    .run();
  return next > LOGIN_LIMIT;
}

async function clearLoginRateLimit(db: D1Database, keyHash: string): Promise<void> {
  await db.prepare('DELETE FROM auth_rate_limits WHERE key_hash=?').bind(keyHash).run();
}
