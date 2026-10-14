# apps/api

Cloudflare Worker API (Hono) with D1 migrations and R2 storage. In Phase 0 it runs under `wrangler dev` with local D1 and R2, persisted in `.wrangler/state`.

```
pnpm --filter @clearfea/api dev          # apply local migrations, serve on http://localhost:8787
pnpm --filter @clearfea/api db:migrate   # apply migrations to the local D1 only
pnpm --filter @clearfea/api test         # Vitest inside the Workers runtime
pnpm --filter @clearfea/api typecheck
```

| Path | Holds |
| --- | --- |
| `wrangler.jsonc` | Bindings: `DB` (D1), `FILES` (R2) |
| `migrations/` | D1 migrations, numbered |
| `src/index.ts` | Hono app and routes |
| `src/db/` | Data-access layer. Route handlers do not write SQL |
| `test/` | Tests; migrations are applied before each file |

Routes so far: `GET /api/health` returns the state of the database and file storage.
