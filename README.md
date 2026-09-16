# Kasuro POS

Kasir cepat, bisnis terkendali.

## Local setup

```bash
pnpm install
pnpm --filter @kasuro/api db:migrate:local
pnpm --filter @kasuro/api db:seed:local
pnpm dev:api
pnpm dev:web
```

Open `http://localhost:5173`. The web app can be explored with local demo products while the API is unavailable; when the API is configured, products and dashboard data load from D1.
Local demo login: `business-demo` / `andi@kasuro.local` / `kasuro-demo-2026`.

## Deployment split

- Deploy `apps/api` with `pnpm --filter @kasuro/api deploy` after setting the production D1 ID in `apps/api/wrangler.toml`.
- Deploy `apps/web` as a Cloudflare Pages project with build command `pnpm --filter @kasuro/web build` and output directory `apps/web/dist`.
- Set `VITE_API_URL` in Pages to the Worker URL.

## Constraints

The core architecture uses Pages, Workers, D1, browser IndexedDB, and optional external image URLs. It does not depend on R2, Queues, Durable Objects, Workers AI, or other paid Cloudflare services.
