# apps/api

Cloudflare Worker API (Hono) with D1 migrations and R2 storage. In Phase 0 it runs under `wrangler dev` with local D1 and R2, persisted in `.wrangler/state`.

```
pnpm --filter @clearfea/api dev          # apply local migrations, seed test users, serve on http://localhost:8787
pnpm --filter @clearfea/api db:migrate   # apply migrations to the local D1 only
pnpm --filter @clearfea/api db:seed      # (re)create the test users alice and bob in the local D1
pnpm --filter @clearfea/api test         # Vitest inside the Workers runtime
pnpm --filter @clearfea/api typecheck
```

| Path | Holds |
| --- | --- |
| `wrangler.jsonc` | Bindings: `DB` (D1), `FILES` (R2) |
| `migrations/` | D1 migrations, numbered |
| `src/index.ts` | Hono app and routes |
| `src/db/` | Data-access layer. Route handlers do not write SQL |
| `src/session/` | Session layer: password hashes, signed cookie, `requireUser` (ADR-022) |
| `src/routes/` | Public routes under `/api` |
| `seed/` | Local test users; passwords are in the file. Never applied to a remote database |
| `scripts/hash-password.mjs` | Prints a password hash for the seed file |
| `test/` | Tests; migrations are applied before each file |

Local secrets live in `.dev.vars` (git-ignored); copy `.dev.vars.example` to start.

Routes so far:

| Route | Purpose |
| --- | --- |
| `GET /api/health` | State of the database and file storage |
| `POST /api/session` | Sign in with login and password; sets the session cookie |
| `GET /api/session` | The signed-in user, or 401 |
| `DELETE /api/session` | Sign out (clears the cookie) |
| `POST /api/jobs` | Queue a job for the signed-in user (only `noop` so far) |
| `GET /api/jobs` | The signed-in user's most recent jobs, newest first |
| `GET /api/jobs/:id` | One of the signed-in user's jobs; another user's job is 404 |
| `POST /internal/jobs/claim` | Worker claims the oldest queued job of the types it lists; 204 when none |
| `POST /internal/jobs/:id/heartbeat` | Worker reports it is alive; the reply says continue, cancel or stop |
| `POST /internal/jobs/:id/complete` | Worker reports success with a result, or failure with category and cause |

`/internal` routes need `Authorization: Bearer <WORKER_TOKEN>` (ADR-016). `/api/jobs` routes need the session cookie, signed with `SESSION_SECRET` (ADR-022). Request bodies must be sent as `application/json`.
