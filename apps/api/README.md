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

Local secrets live in `.dev.vars` (git-ignored); copy `.dev.vars.example` to start.

Routes so far:

| Route | Purpose |
| --- | --- |
| `GET /api/health` | State of the database and file storage |
| `POST /internal/jobs/claim` | Worker claims the oldest queued job of the types it lists; 204 when none |
| `POST /internal/jobs/:id/heartbeat` | Worker reports it is alive; the reply says continue, cancel or stop |
| `POST /internal/jobs/:id/complete` | Worker reports success with a result, or failure with category and cause |

`/internal` routes need `Authorization: Bearer <WORKER_TOKEN>` (ADR-016).
