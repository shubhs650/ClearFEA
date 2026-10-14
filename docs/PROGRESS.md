# Progress

Current state of the project. Update this file at the end of every working session.

## Now

- **Phase:** 0 (localhost prototype)
- **Current milestone:** M0 Bootstrap
- **Next task:** M0.9 Seeded test users and session login
- **Blocked on:** nothing

## Milestones

| # | Milestone | Status | Closed on |
| --- | --- | --- | --- |
| M0 | Bootstrap | In progress | |
| M1 | Thin slice | Not started | |
| M2 | Structural setup | Not started | |
| M3 | Results tools | Not started | |
| M4 | Assemblies | Not started | |
| M5 | Thermal | Not started | |
| M6 | Modal | Not started | |
| M7 | Report | Not started | |
| M8 | Platform | Not started | |
| M9 | Gate | Not started | |

Status values: Not started, In progress, Verifying, Done.

## Current milestone tasks

Copy the task list for the current milestone from `PLAN.md` here when the milestone starts, and tick tasks as they merge.

### M0 Bootstrap

- [x] M0.1 Confirm Docker works in the Claude Code cloud environment
- [x] M0.2 Monorepo layout, pnpm workspaces, uv, Makefile
- [x] M0.3 API skeleton with local D1 and R2
- [x] M0.4 Web skeleton with layout shell
- [x] M0.5 Worker skeleton, Dockerfile, no-op job
- [x] M0.6 `packages/spec` with first schema, type generation, `units.json`
- [x] M0.7 `make dev`, `make test`, Commands section in `CLAUDE.md`
- [x] M0.8 GitHub Actions fast tier, DCO check, nightly placeholder
- [ ] M0.9 Seeded test users and session login

## Maintainer to-do

Things only the maintainer can do.

- [ ] Create the public GitHub repository and upload these files
- [ ] Check domain, GitHub organisation name and trademark registers for "ClearFEA"
- [x] Review the proposed ADRs in `DECISIONS.md` and mark each accepted or changed (all eleven accepted 2026-10-14)
- [ ] Enable branch protection on `main` (require pull request and passing checks)
- [ ] Confirm Docker Desktop (or equivalent) runs on the verification laptop

## Verification status

| Tier | Last run | Result |
| --- | --- | --- |
| Fast (pull request) | 2026-10-14 | Green (PR #9) |
| Nightly coarse | never | |
| Full | never | |

## Handoff notes

Written by the last session for the next one. Replace, do not append.

> M0.1 to M0.6 are done; start with M0.7. ADR-001 to ADR-011 were accepted unchanged on 2026-10-14.
>
> Environment check (2026-10-14, Claude Code cloud): pnpm 12.11.2, uv 0.11.32, wrangler 4.151.0, Node 22.22.0, Python 3.13 default with 3.12 present. CalculiX `ccx` 2.21 (Debian `calculix-ccx`) runs. Gmsh pip package 4.15.2 is installed but fails to load because `libGLU.so.1` is missing.
>
> Docker (M0.1, ADR-012): Docker 29.8.2 works but the daemon is not started for us. Start it with `nohup dockerd > /tmp/dockerd.log 2>&1 &` and wait for `/var/run/docker.sock`. Compose v5.6.0 and buildx are present. Pull base images via `mirror.gcr.io/library/...` because Docker Hub returns 429. Inside builds, apt over HTTP works directly, but HTTPS (pip) fails certificate checks until the proxy CA is passed as `--secret id=extra_ca,src=/root/.ccr/ca-bundle.crt` and read through `RUN --mount=type=secret,id=extra_ca,required=false`. Checked: run, bind mounts, `--cpus`/`--memory` limits, a Compose service reaching another by name, a container reaching the host through `host.docker.internal:host-gateway`, and a published port reached from the host.
>
> For M0.5: a probe image on `python:3.12-slim-bookworm` with `calculix-ccx` and pip `gmsh==4.15.2` built, Gmsh initialised, and CalculiX solved a one-element C3D8 deck. Gmsh needs `libgl1 libglu1-mesa libgomp1 libxrender1 libxcursor1 libxft2 libxinerama1` (the host's missing `libGLU.so.1` is the same problem). Bookworm's `calculix-ccx` is 2.20, while the host has 2.21, so M0.5 must pin one version on purpose. Image size was about 490 MB.
>
> M0.2 (2026-10-14): monorepo layout in place. `make install` and `make test` work; `make test` runs pnpm lint/typecheck/test across the workspace (no-ops until packages gain scripts) and ruff plus pytest in `worker/`. The TypeScript packages are empty `package.json` stubs with a README naming the task that fills them. `make dev`, `verify` and `e2e` are left for M0.7 and later. Python tooling choice is ADR-013 (accepted).
>
> M0.3 (2026-10-14): `apps/api` is a Hono app on `wrangler dev` (port 8787) with local D1 (`DB`) and R2 (`FILES`) bindings in `wrangler.jsonc`, persisted under `apps/api/.wrangler/state`. Migration `0001_users_projects.sql` creates `users` and `projects`; apply it with `pnpm --filter @clearfea/api db:migrate` (the `dev` script does this first). `GET /api/health` probes both bindings and returns 503 with a plain-language fix when tables are missing. Tests run in `workerd` through `@cloudflare/vitest-plugin` (ADR-014, accepted). Not done here, on purpose: a TypeScript lint tool (the api has `typecheck` and `test` scripts but no `lint`; choose one in M0.7), the wallet balance column on `users` (no money unit is decided; add it with the ledger), CORS (the M0.4 Vite dev server can proxy `/api`). Pin new npm packages at least a day old: pnpm's release-age policy rejects fresher ones.
>
> M0.4 (2026-10-14): `apps/web` is Vite 8, React 19.3.0 and TypeScript on port 5173 (`strictPort`), with `/api` proxied to `127.0.0.1:8787`. The shell is a CSS grid (tree 260 px, viewer, settings 320 px, 28 px status bar, minimum width 1024 px); the panes hold placeholder text only. The status bar calls `/api/health` once on load and shows connected, degraded (with the API's own fix text) or not reachable (with the command to start the API). Tests use Vitest with jsdom and Testing Library. Not done here, on purpose: three.js (comes with the viewer in M1), polling health, and lint (M0.7). The health response shape is checked by hand in `apps/web/src/api/health.ts`; move it to a shared schema once M0.6 creates `packages/spec`. For headless screenshots use `/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`; full `chrome --headless` cuts about 90 px off the viewport height.
>
> M0.5 (2026-10-14): the worker image (`worker/Dockerfile`) is Ubuntu 24.04 by digest with `calculix-ccx=2.21-1` and Gmsh 4.15.2 from `uv.lock`, running as a non-root user (ADR-015, accepted): Debian trixie has no CalculiX package and bookworm has 2.20, so Ubuntu matches the host's 2.21. `python -m clearfea_worker check` prints both versions and initialises Gmsh (on the host it fails on `libGLU.so.1`, as expected). The API gained migration `0002_jobs.sql` (with a `noop` job type) and `POST /internal/jobs/claim`, `/internal/jobs/:id/heartbeat`, `/internal/jobs/:id/complete`, guarded by `WORKER_TOKEN` from `apps/api/.dev.vars` (copy `.dev.vars.example`; ADR-016, accepted). Run the worker with `docker compose -f infra/docker-compose.yml -f infra/docker-compose.linux.yml up --build worker` on Linux (drop the second file on Docker Desktop); behind the cloud proxy set `CLEARFEA_BUILD_CA=/root/.ccr/ca-bundle.crt`. There is no route to create a job yet (needs M0.9 sessions), so queue one with `wrangler d1 execute DB --local`; see `worker/README.md`. Not done here, on purpose: the heartbeat-timeout sweep that fails silent jobs, job logs, transfer URLs and metering (they arrive with the job types that need them). Wire shapes are hand-checked on both sides; move them into `packages/spec` in M0.6. Surprise: D1 storage in API tests is shared between tests in one file, not isolated per test as ADR-014 says, so `test/jobs.test.ts` resets its rows in `beforeEach`. The image is about 990 MB.
>
> M0.6 (2026-10-14): `packages/spec` holds the first schemas (`health`, `jobs` with the internal job messages under `$defs`, and `units` for the shape of `units.json`), `units.json` with length, force and pressure, and `fixtures/unit-conversions.json`. `make spec` regenerates TypeScript types and validators (`packages/spec/src/generated/`) and Pydantic models (`worker/clearfea_worker/spec/`); `make test` now starts with `make spec-check`, which fails when the committed generated files differ from the schemas (ADR-017, accepted). The web health check, the API's `/internal` request bodies and the worker's API client now go through the schemas, and the worker tests' fake API checks every body it sees. Unit conversion: `apps/web/src/units/convert.ts` and `worker/clearfea_worker/units.py`, both run against the shared fixture (ADR-018, accepted). Not done here, on purpose: `SimulationSpec` and the `{ value, unit }` quantity shape (M1.4), and any kind beyond length, force and pressure. Watch: the worker image does not contain `packages/spec/units.json` (its build context is `worker/`), so the first job that converts units (the deck generator in M1) must change the build context or copy the table in. Validation messages come from `@cfworker/json-schema` and are tidied in `packages/spec/src/validate.ts`; they are fine for the internal routes but are not user-facing text.
>
> M0.7 (2026-10-14): `make dev` runs `infra/dev.sh` (ADR-020, accepted): API, web app and worker container in one terminal with `[api]`/`[web]`/`[worker]` prefixes; Ctrl-C, or any one service exiting, stops all three and the worker container. It checks for `node_modules`, a reachable Docker daemon and free ports 8787 and 5173 first, creates `apps/api/.dev.vars` if missing and hands its token to the worker. Checked here: with `dockerd` started by hand and `BUILD_CA=/root/.ccr/ca-bundle.crt`, the worker built, a no-op job queued with `wrangler d1 execute` went to `succeeded`, `/api/health` answered through the Vite proxy, and both Ctrl-C and killing Vite left no process or running container behind. TypeScript lint is Biome 2.5.9 from a root `biome.json` (ADR-019, accepted); it found one real issue (`aria-label` on the status-bar `footer` now has an explicit `contentinfo` role). Not done here, on purpose: `make verify` (M1.13) and `make e2e` (M1.14), Biome's formatter (would rewrite most files; its own decision), and a route to create jobs (M0.9). The "Ready" line appears once the API and web app answer, which on a first run is before the worker image finishes building.
>
> M0.8 (2026-10-14): `.github/workflows/fast.yml` runs on every pull request. Job `make test` runs `make install` then `make test` on `ubuntu-24.04` (Node 22, pnpm from `packageManager`, uv 0.11.32, Python 3.12, pnpm and uv caches); sign-offs are checked by the DCO GitHub App, which was already installed. Actions are pinned by commit SHA and the token is read-only (ADR-021, proposed). `.github/workflows/nightly.yml` runs at 02:00 UTC and by hand but only prints that no suites exist yet; replace its step when `make verify` (M1.13) lands. To require these checks, the maintainer adds `make test` and `DCO` as required status checks in branch protection for `main`. The first CI run (PR #9) took 34 s for `make test`.
>
> Two points to watch from the ADR review: Gmsh may not report the STEP file's original length unit (check in the M1.1 spike), and browser-captured report figures (ADR-011) mean report generation needs the browser open.

## Parked ideas

Ideas that came up during work and are outside the current milestone. Do not build these without a decision.

- Shrink the worker image (about 990 MB): Mesa and Open MPI pull in LLVM and GPU libraries the worker does not use.

## Log

Newest first. One entry per session: date, what was done, what was learned.

### 2026-10-14

- M0.8: GitHub Actions fast tier (`make test`) on every pull request (DCO sign-off left to the already-installed DCO App), nightly workflow placeholder (ADR-021 proposed).
- M0.7: `make dev` starts the API, web app and worker together and stops them together (ADR-020 accepted); Biome lints all TypeScript (ADR-019 accepted); Commands section in `CLAUDE.md` and "Running it" in `README.md` filled in.
- M0.6: `packages/spec` with health, jobs and units schemas, `units.json` (length, force, pressure), TypeScript and Pydantic generation with a drift check in `make test`, unit conversion in both languages tested against one shared fixture (ADR-017 and ADR-018 accepted).
- M0.5: worker image with pinned CalculiX 2.21 and Gmsh 4.15.2, jobs table and internal claim routes in the API, worker claim loop that takes a no-op job from queued to succeeded (ADR-015 and ADR-016 accepted).
- M0.4: web skeleton with Vite, React and TypeScript; three-pane layout shell with a status bar that calls the API health route through the dev server proxy.
- M0.3: API skeleton with Hono, local D1 and R2, first migration (`users`, `projects`), health route, Vitest in the Workers runtime (ADR-014 accepted).
- M0.2: created the monorepo layout (`apps/web`, `apps/api`, `worker`, `packages/spec`, `verification`, `infra`), pnpm workspace, `uv` project for the worker, top-level `Makefile`.
- M0.1: Docker works in the cloud environment once `dockerd` is started; recorded as ADR-012 (accepted) with the image mirror and build CA conditions. Fallback not needed.
- Maintainer accepted ADR-001 to ADR-011 unchanged.
- Checked tool availability in the cloud environment; see handoff notes.

### 2026-10-13

- Product interview completed; decisions recorded in `DECISIONS.md`.
- Architecture, plan, verification plan and working instructions written.
- Name search found no existing product called ClearFEA; nearest is ClearCalcs (structural calculations). Domain and trademark not checked.
