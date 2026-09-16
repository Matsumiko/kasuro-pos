# Authentication boundary

The Worker owns session issuance and revocation. Passwords are never returned to the browser. Password hashes use PBKDF2-SHA-256 with a per-user salt and 100,000 iterations, the maximum supported by Cloudflare Workers Web Crypto. Session tokens are random values returned once at login; only their SHA-256 hashes are stored in D1.

The API applies a lightweight failed-login window per email and IP hash. Session lookup is tenant-scoped through the user row and rejects inactive, revoked, and expired sessions. The browser should eventually use an HTTP-only secure cookie at the production custom domain; local development may use the bearer token path.
