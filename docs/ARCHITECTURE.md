# Kasuro architecture

Kasuro uses a small npm-workspaces monorepo. `apps/web` is a React/Vite static SPA and PWA target. `apps/api` is a Hono Cloudflare Worker. `packages/domain` contains pure rules; `packages/contracts` contains public schemas/types; `packages/db` owns scoped D1 repository code; `packages/ui` owns accessible shared primitives.

The web client never authorizes a request and never owns financial calculations. The Worker derives identity, business, outlet, and permissions from the server-side session and membership context. Tenant-owned repository methods require a scope containing `businessId`; outlet operations additionally require `outletId`.

Cloudflare bindings and environment-specific deployment are defined in Wrangler configuration. Database migrations are forward-only and live under `database/migrations`.
