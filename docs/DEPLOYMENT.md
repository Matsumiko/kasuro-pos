# Deployment

Local, preview, and production use separate Pages, Worker, D1, and secrets. Migrations are applied explicitly before the compatible Worker deployment. Current forward-only migrations are `0001_identity_tenants.sql` through `0008_stock_insert_integrity.sql`; apply them with `npm run db:migrate:local` locally and the equivalent `wrangler d1 migrations apply --remote` command for the target database. Pages is deployed after the Worker health check passes.

Release gate: `npm run typecheck && npm run lint && npm run format:check && npm run test && npm run build`. Then smoke `/health`, unauthenticated `/api/v1/auth/me` (401), tenant context denial, a real register/shift/checkout/refund flow, offline idempotent replay, import validation, and platform-admin separation against a non-production fixture.

Production recovery uses Cloudflare D1 recovery/Time Travel procedures documented and rehearsed before release. User exports are not backups. Worker logs must be reviewed for request IDs without secrets, and production bindings must not reuse development credentials.
