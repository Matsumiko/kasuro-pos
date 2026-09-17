export type RuntimeEnv = {
  DB?: D1Database;
  ENVIRONMENT: string;
  API_VERSION: string;
  WEB_ORIGIN: string;
  SESSION_COOKIE_NAME: string;
};

export function readRuntimeEnv(bindings: Partial<RuntimeEnv>): RuntimeEnv {
  const environment = bindings.ENVIRONMENT ?? 'local';
  const missing: string[] = [];
  if (!bindings.API_VERSION) missing.push('API_VERSION');
  if (!bindings.WEB_ORIGIN) missing.push('WEB_ORIGIN');
  if (environment === 'production' && !bindings.DB) missing.push('DB');
  if (missing.length > 0) throw new Error(`Missing runtime configuration: ${missing.join(', ')}`);
  const runtime: RuntimeEnv = {
    ENVIRONMENT: environment,
    API_VERSION: bindings.API_VERSION ?? '0.1.0',
    WEB_ORIGIN: bindings.WEB_ORIGIN ?? 'http://localhost:5173',
    SESSION_COOKIE_NAME: bindings.SESSION_COOKIE_NAME ?? 'kasuro_session',
  };
  if (bindings.DB) runtime.DB = bindings.DB;
  return runtime;
}
