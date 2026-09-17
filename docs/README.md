# KASURO POS

KASURO is a multi-tenant POS foundation for independent businesses. The initial foundation provides a runnable React public shell and a Cloudflare Worker health endpoint; domain features are introduced phase by phase according to the approved implementation blueprint.

## Commands

```sh
npm install
npm run dev:web
npm run dev:api
npm run build
npm run typecheck
npm run lint
npm run test
```

The API health endpoint is `GET /health`. Local D1 migrations and seed commands are provided after the database phase adds schema migrations.
