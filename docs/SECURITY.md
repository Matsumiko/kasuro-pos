# Security posture

Security boundaries are server-side. Business IDs from request bodies and URLs are untrusted selectors. Scoped repositories require authorized business context, and outlet operations require explicit outlet access.

Sales history, held-sale lists, sale receipts, refund lists, customer sales history, and refund details all enforce the member's outlet scope. Sales, inventory, and expense exports also apply the same outlet membership predicate for restricted members. Shift cash movements and shift close/resume mutations re-check the shift or sale outlet immediately before writing. A member without `all_outlets` cannot retrieve, export, or mutate another outlet's sale, shift, inventory, expense, or refund by changing a URL ID or query selector. Mutation paths re-check outlet access immediately before writing.

Authentication uses opaque hashed sessions, CSRF validation, Origin validation, password hashing, token hashing, and generic unauthorized responses. Production cookies are HttpOnly/Secure/SameSite=Lax; local HTTP development intentionally omits `Secure` so the browser can exercise the real session flow. No credentials, payment credentials, raw session tokens, reset tokens, or invitation tokens belong in logs. Staff invitation creation is fail-closed in production until an approved email-delivery provider is configured; local development may return a one-time raw token for manual testing.

Completed sales, refunds, stock movements, credit, loyalty, imports, and platform mutations are append/audit-oriented and tenant-scoped. Refund quantities decrement conditionally inside the D1 batch, refund-line amounts are trigger-checked, and retry payloads are idempotent. Offline replay requires an idempotency key; changed-payload reuse is rejected. CSV export prefixes formula cells to prevent spreadsheet injection.

Before production: verify all mutation routes with an allowed Origin and CSRF token; run cross-business and cross-outlet BOLA tests; inspect redacted Worker logs; rotate `.dev.vars` values; apply migrations to the target D1 explicitly; confirm platform-admin assignments independently from merchant roles; and test D1 recovery/Time Travel.
