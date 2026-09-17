# Security posture

Security boundaries are server-side. Business IDs from request bodies and URLs are untrusted selectors. Scoped repositories require authorized business context, and outlet operations require explicit outlet access.

Authentication uses opaque hashed sessions, CSRF validation, Origin validation, password hashing, token hashing, and generic unauthorized responses. Production cookies are HttpOnly/Secure/SameSite=Lax; local HTTP development intentionally omits `Secure` so the browser can exercise the real session flow. No credentials, payment credentials, raw session tokens, or reset tokens belong in logs.

Completed sales, refunds, stock movements, credit, loyalty, imports, and platform mutations are append/audit-oriented and tenant-scoped. Offline replay requires an idempotency key; changed-payload reuse is rejected. CSV export prefixes formula cells to prevent spreadsheet injection.

Before production: verify all mutation routes with an allowed Origin and CSRF token; run cross-business BOLA tests; inspect redacted Worker logs; rotate `.dev.vars` values; apply migrations to the target D1 explicitly; confirm platform-admin assignments independently from merchant roles; and test D1 recovery/Time Travel.
