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
| `src/jobs/files.ts` | Which files each job type reads and writes, and their transfer URLs (ADR-005) |
| `seed/` | Local test users; passwords are in the file. Never applied to a remote database |
| `scripts/hash-password.mjs` | Prints a password hash for the seed file |
| `scripts/production-config.mjs` | Writes `wrangler.production.json` for the live site (ADR-096) |
| `test/` | Tests; migrations are applied before each file |

## Production

The live site (ADR-095, ADR-096) is one Worker named `clearfea` on `clearfea.triyalabs.com` that serves the built web app and this API. The deploy workflow runs, from the repository root:

```
pnpm --filter @clearfea/web build
CLOUDFLARE_D1_DATABASE_ID=<id> CLEARFEA_COMMIT=<sha> pnpm --filter @clearfea/api deploy:config   # writes wrangler.production.json
pnpm --filter @clearfea/api deploy:migrate   # D1 migrations on the production database
pnpm --filter @clearfea/api deploy           # wrangler deploy; secrets are set separately
```

`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` must be in the environment for the last two. `/api/health` then reports `commit`. To try the production configuration locally, run `wrangler d1 migrations apply DB --local --config wrangler.production.json` and `wrangler dev --config wrangler.production.json` after `deploy:config` with any id.

Local secrets live in `.dev.vars` (git-ignored); copy `.dev.vars.example` to start. `SELF_HOSTED=true` there turns on self-hosting mode: the wallet is informational and never refuses a run or mesh (ADR-084).

Routes so far:

| Route | Purpose |
| --- | --- |
| `GET /api/health` | State of the database and file storage, and the deployed commit |
| `POST /api/session` | Sign in with login and password; sets the session cookie |
| `GET /api/session` | The signed-in user, or 401 |
| `DELETE /api/session` | Sign out (clears the cookie) |
| `POST /api/jobs` | Queue a job for the signed-in user (only `noop` so far) |
| `GET /api/jobs` | The signed-in user's most recent jobs, newest first |
| `GET /api/jobs/:id` | One of the signed-in user's jobs; another user's job is 404 |
| `POST /api/geometries?name=<file name>` | Upload a STEP file as the raw body (`application/octet-stream`, at most 100 MB); queues its import |
| `GET /api/geometries` | The signed-in user's geometries, newest first |
| `GET /api/geometries/:id` | One geometry: import status, detected and confirmed unit, counts, bounding box (metres) |
| `GET /api/geometries/:id/topology` | `topology.json` of an imported geometry |
| `GET /api/geometries/:id/display` | The display mesh (`packages/spec/display-mesh.md`) |
| `POST /api/geometries/:id/unit` | Confirm the file's length unit, or choose another (re-imports at that unit) |
| `POST /internal/jobs/claim` | Worker claims the oldest queued job of the types it lists, with its parameters and transfer URLs; 204 when none |
| `GET`/`PUT /internal/jobs/:id/files/:name?worker=<id>` | Download a job's input or upload its output; only the worker holding the job, only names the job type defines |
| `POST /internal/jobs/:id/heartbeat` | Worker reports it is alive; the reply says continue, cancel or stop |
| `POST /internal/jobs/:id/complete` | Worker reports success with a result, or failure with category, cause and a message for the user. A finished import updates its geometry |

`/internal` routes need `Authorization: Bearer <WORKER_TOKEN>` (ADR-016). `/api/jobs` and `/api/geometries` routes need the session cookie, signed with `SESSION_SECRET` (ADR-022). Request bodies must be sent as `application/json`, except STEP uploads, which must be `application/octet-stream`; neither can be sent cross-site by an HTML form.
