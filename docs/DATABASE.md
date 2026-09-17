# Database

D1/SQLite tables use plural snake_case names, text ULIDs, UTC ISO timestamps, integer boolean flags, and integer minor-unit money. Tenant-owned tables carry `business_id`; outlet-owned rows carry `outlet_id` and are checked against the same business.

`database/migrations/0001_identity_tenants.sql` creates identity, business, membership, role, permission, outlet, register, settings, invitation, session, and reset-token foundations. `0002_operations.sql` creates catalog, inventory, sales, shifts, customers, purchasing, refunds, expenses, and audit tables. `0003_platform_resilience.sql` creates plans, imports, summaries, and platform audit. `0004_onboarding.sql` adds resumable setup state.

Migrations are numbered and forward-only. Feature phases add schema with their owning module and verify indexes/query plans before release.

## Query review

All high-volume queries bind `business_id` before resource selectors and project only required columns. Catalog, sales history, inventory movement, purchases, expenses, imports, and sync endpoints are bounded at 100–1,000 rows. The dashboard report is date-bounded and uses indexed business/outlet/date predicates. A later performance phase must run `EXPLAIN QUERY PLAN` against realistic fixtures and replace raw report scans with summary projections before production.
