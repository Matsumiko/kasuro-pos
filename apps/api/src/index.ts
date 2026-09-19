import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { SessionContext } from './middleware/session';
import type { MembershipContext } from './middleware/tenant';
import { requestSafety } from './middleware/request';
import { isAllowedWebOrigin } from './middleware/origin';
import { sessionMiddleware } from './middleware/session';
import { csrfProtection } from './middleware/csrf';
import { registerAuthRoutes } from './routes/auth';
import { registerBusinessRoutes } from './routes/businesses';
import { registerCatalogRoutes } from './routes/catalog';
import { registerOutletRoutes } from './routes/outlets';
import { registerSalesRoutes } from './routes/sales';
import { registerRefundRoutes } from './routes/refunds';
import { registerPurchaseRoutes } from './routes/purchases';
import { registerCustomerRoutes } from './routes/customers';
import { registerExpenseRoutes } from './routes/expenses';
import { registerReportRoutes } from './routes/reports';
import { registerSyncRoutes } from './routes/sync';
import { registerImportExportRoutes } from './routes/import-export';
import { registerPlatformRoutes } from './routes/platform';
import { registerStockRoutes } from './routes/stock';
import { registerStaffRoutes } from './routes/staff';
import { registerLoyaltyCreditRoutes } from './routes/loyalty-credit';
import { registerOnboardingRoutes } from './routes/onboarding';
export type Env = {
  Bindings: {
    DB?: D1Database;
    ENVIRONMENT?: string;
    API_VERSION?: string;
    WEB_ORIGIN?: string;
    SESSION_COOKIE_NAME?: string;
  };
  Variables: {
    session?: SessionContext;
    membership?: MembershipContext;
  };
};

const app = new Hono<Env>();

const cors: MiddlewareHandler<Env> = async (c, next) => {
  if (c.req.method === 'OPTIONS') return withCors(c, c.body(null, 204));
  await next();
  c.res = withCors(c, c.res);
};

function withCors(
  c: { req: { header: (name: string) => string | undefined }; env: Env['Bindings'] },
  response: Response,
): Response {
  const origin = c.req.header('Origin');
  if (!origin || !isAllowedWebOrigin(origin, c.env.WEB_ORIGIN ?? 'http://localhost:5173'))
    return response;
  const result = new Response(response.body, response);
  result.headers.set('Access-Control-Allow-Origin', origin);
  result.headers.set('Access-Control-Allow-Credentials', 'true');
  result.headers.set('Vary', 'Origin');
  result.headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-CSRF-Token, Idempotency-Key',
  );
  result.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  return result;
}

app.use('*', requestSafety);
app.use('*', sessionMiddleware);
app.use('*', cors);
app.use('*', csrfProtection);

app.get('/health', (c) =>
  c.json({
    data: {
      status: 'ok',
      version: c.env.API_VERSION ?? '0.1.0',
      environment: c.env.ENVIRONMENT ?? 'local',
    },
  }),
);

registerAuthRoutes(app);
registerBusinessRoutes(app);
registerOutletRoutes(app);
registerCatalogRoutes(app);
registerSalesRoutes(app);
registerRefundRoutes(app);
registerPurchaseRoutes(app);
registerCustomerRoutes(app);
registerExpenseRoutes(app);
registerReportRoutes(app);
registerSyncRoutes(app);
registerPlatformRoutes(app);
registerImportExportRoutes(app);
registerStaffRoutes(app);
registerStockRoutes(app);
registerOnboardingRoutes(app);
registerLoyaltyCreditRoutes(app);

app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404));

app.onError((error, c) => {
  if (error instanceof HTTPException) return withCors(c, error.getResponse());
  if (error instanceof SyntaxError)
    return withCors(
      c,
      c.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' } }, 400),
    );
  console.error(
    JSON.stringify({
      event: 'request_error',
      name: error.name,
      message: c.env.ENVIRONMENT === 'local' ? error.message : undefined,
    }),
  );
  return withCors(
    c,
    c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500),
  );
});

export default app;
