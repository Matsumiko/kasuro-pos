# Kasuro POS Architecture

## Runtime

- `apps/web`: React + Vite PWA deployed to Cloudflare Pages.
- `apps/api`: standalone Cloudflare Worker REST API.
- `database`: D1 migrations and local seed data.
- `packages/shared`: shared money, sale, product, payment, and permission contracts.

The frontend never writes authoritative sales or stock. The Worker validates tenant, outlet, stock, payment, and idempotency before the D1 batch write.

## Checkout boundary

`POST /api/v1/sales` accepts a client-generated `clientTransactionId`. D1 enforces uniqueness per business. The checkout batch writes sale, line snapshots, payments, stock reductions, stock movements, sync record, and audit record together.

When offline, the web app stores the exact payload in IndexedDB. It retries when connectivity returns. The server's unique client transaction key makes retries safe.

## Current API

- `GET /health`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/products?q=&category=&limit=`
- `GET /api/v1/dashboard`
- `GET /api/v1/reports/sales?from=&to=`
- `GET|POST /api/v1/customers`
- `GET|POST /api/v1/suppliers`
- `GET|POST /api/v1/purchase-orders`
- `POST /api/v1/purchase-orders/:id/receive`
- `POST /api/v1/inventory/adjust`
- `POST /api/v1/shifts/open`
- `POST /api/v1/shifts/:id/close`
- `POST /api/v1/sales`
- `GET /api/v1/sales/:id`
- `POST /api/v1/refunds`

All authenticated routes resolve business and outlet from the bearer session. Resource lookups repeat those scopes in SQL predicates; IDs from another tenant cannot be used as read or write authority.

Authentication is bearer-session based in this initial vertical slice. Production login/session issuance is the next core boundary and must use HTTP-only cookies where the deployment topology permits it.
