# Operations boundary

The current vertical slice includes D1 schema foundations for registers, shifts, cash movements, refunds, suppliers, and purchase orders. The frontend currently exposes POS and inventory surfaces only.

Required next endpoints before claiming the full acceptance list:

- `POST /api/v1/shifts/open`
- `POST /api/v1/shifts/:id/close`
- `POST /api/v1/refunds`
- `GET /api/v1/reports/sales`
- `GET /api/v1/reports/inventory`
- `POST /api/v1/purchase-orders`
- `POST /api/v1/purchase-orders/:id/receive`

These should use the same tenant-scoped auth, server-side permission checks, integer monetary values, audit records, and transactional stock movements as checkout.
