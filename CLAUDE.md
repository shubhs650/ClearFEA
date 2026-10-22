# CLAUDE.md

Working instructions for Claude Code sessions in this repository.

## What this project is

ClearFEA is an open (AGPL v3) cloud FEA platform on CalculiX: STEP upload, browser setup, server-side meshing and solving, results viewer, PDF/Word report, with per-second compute metering. Phase 0 is a fully working localhost prototype that is shaped like the cloud deployment.

## Start of every session

1. Read `docs/PROGRESS.md` to find the current milestone and the last session's handoff notes.
2. Read the current milestone's section in `docs/PLAN.md`.
3. Read the parts of `docs/ARCHITECTURE.md` that the task touches.
4. If the task touches scope, check `docs/DECISIONS.md` first. Do not build anything on the non-goals list.

## End of every session

1. Update `docs/PROGRESS.md`: tick finished tasks, add a dated log entry, and write handoff notes (what is half-done, what to do next, anything surprising).
2. If you made a decision that is not already recorded, add an ADR entry to `docs/DECISIONS.md`. If the decision changes product behaviour, stop and ask the maintainer before building on it.
3. If you changed how something is run or tested, update the Commands section below.

## Hard rules

- **SI base units internally.** Every stored and solved quantity is in m, kg, s, K (and derived N, Pa, J, W). Conversion happens only at the edges, using the single table in `packages/spec/units.json`. Never hard-code a conversion factor anywhere else.
- **The solver input must match the setup.** The CalculiX deck is generated only by the deck generator from a `SimulationSpec` and a mesh. No other code writes or edits `.inp` content.
- **Runs are frozen.** A run stores a snapshot of its spec, mesh reference, deck, versions and cost. Never mutate a run's inputs after creation.
- **Every query is owner-scoped.** All data access goes through the data-access layer, which requires a user id. No raw queries in route handlers.
- **Never print a compliance verdict.** No "PASS", "FAIL", "compliant" or code names as results in UI or reports. Numbers only.
- **Nothing private in the repository.** No credentials, no client geometry, no copyrighted code tables or material data (for example ASME tables). Test models must be ones created for this project.
- **Stay inside the milestone.** Do not start work from a later milestone or add unrequested features. Note ideas in `docs/PROGRESS.md` under "Parked ideas".

## Physics-critical modules

These modules decide whether results are right. Keep them small, pure (no I/O where possible) and separate from everything else. Any pull request that touches them must say so in its description, and the maintainer reads those changes line by line.

| Module | Location (planned) |
| --- | --- |
| Units table and conversion | `packages/spec/units.json`, `worker/clearfea_worker/units.py`, `apps/web/src/units/` |
| Deck generator (spec + mesh → `.inp`) | `worker/clearfea_worker/deck/` |
| Load translation (remote loads, hydrostatic, springs, ties) | `worker/clearfea_worker/deck/loads/` |
| Result extraction (`.frd`/`.dat` → fields, reactions) | `worker/clearfea_worker/results/` |
| Cost calculation and ledger | `apps/api/src/billing/` |

## Testing rules

- Pull requests run **unit tests, deck snapshot tests, type checks and lint only**. Keep this tier under five minutes.
- Physics verification and browser end-to-end tests run **at the end of each milestone** in CI (phase-end workflow) and locally with `make verify` and `make e2e`. See `docs/VERIFICATION.md`.
- Run the relevant physics cases **locally in the session** before opening a pull request that touches a physics-critical module. Paste the result table in the pull request description.
- A red phase-end or verification run is fixed before new feature work.
- **Snapshot updates need a reason.** If a deck snapshot changes, explain in the pull request why the new deck is correct. Never regenerate snapshots just to make a test pass.
- Every new load, support or analysis type lands together with at least one verification case and a row in the coverage matrix in `docs/VERIFICATION.md`.
- Do not weaken a tolerance or delete a failing test to get green. Report the failure.

## Git workflow

- Branch from `main`; one branch per task; merge only through a pull request.
- Commit messages: imperative summary line, body explaining why.
- Sign off every commit (`git commit -s`). This project uses the Developer Certificate of Origin; see `CONTRIBUTING.md`.
- Pull request description: what changed, how it was tested, whether a physics-critical module was touched, screenshots for UI changes.

## Code conventions

- TypeScript: strict mode, no `any` without a comment explaining why. Validate all external input with the shared schemas.
- Python: 3.12, type hints everywhere, `ruff` for lint and format, `pytest` for tests.
- Shared data shapes are defined once in `packages/spec` as JSON Schema. TypeScript types and Pydantic models are generated from it. Do not hand-write a second definition.
- Errors shown to users say what is wrong and what to do about it, in plain engineering language.
- New source files carry the AGPL SPDX header: `SPDX-License-Identifier: AGPL-3.0-or-later`.
- Pin versions of Gmsh, CalculiX and OpenCASCADE. Face identifiers and results depend on them. A version bump is its own pull request with a full verification run.

## Repository layout (planned)

```
apps/web/        React frontend (Vite, TypeScript, three.js)
apps/api/        Cloudflare Worker API (Hono, D1, R2)
worker/          Python job worker (Gmsh, CalculiX) and its Dockerfile
packages/spec/   JSON Schemas, units table, shared fixtures
verification/    Benchmark cases with reference values
infra/           Docker Compose, later cloud deployment
docs/            Decisions, architecture, plan, progress, verification
```

## Commands

Run from the repository root. `make help` lists them.

```
make install     pnpm and uv dependencies (frozen lockfiles)
make dev         API (wrangler dev, :8787), web (Vite, :5173, proxies /api) and the worker
                 container together; Ctrl-C stops all three (infra/dev.sh)
make test        fast tier: generated-code drift check, Biome lint, tsc, Vitest, ruff, pytest
make verify      verification cases (verification/cases) through a fresh API on :8788 and a worker
                 container; prints the result table (VERIFY_TIER=full, CASES="V-01 V-02")
make e2e         browser end-to-end tests (apps/web/e2e, Playwright) through a fresh API on :8789,
                 a worker container and the web app on :5174
make lint        lint only (Biome for TypeScript, ruff for Python)
make format      format Python code with ruff
make spec        regenerate TypeScript types and Pydantic models from packages/spec/schemas
make worker-image  build the worker image on its own
```

- `make dev` needs a running Docker daemon. In the Claude Code cloud environment start it first with `nohup dockerd > /tmp/dockerd.log 2>&1 &` and run `make dev BUILD_CA=/root/.ccr/ca-bundle.crt` so the image build trusts the proxy (ADR-012). With Docker Compose v5 (it builds through buildx bake), also set `BUILDX_BAKE_ENTITLEMENTS_FS=0`, or the build refuses to read the CA file and the worker never starts; the same goes for `make verify` and `make e2e`. It creates `apps/api/.dev.vars` from the example if missing and passes its `WORKER_TOKEN` to the worker.
- CI (`.github/workflows/fast.yml`) runs `make install` and `make test` on every pull request; the DCO GitHub App checks sign-offs. `.github/workflows/phase-end.yml` runs `make verify` (full tier) and `make e2e` when a milestone tag such as `m1-complete` is pushed, by hand from the Actions tab, and on pull requests that change it or `infra/stack.sh`, `verify.sh` or `e2e.sh` (ADR-037). A milestone closes on a green run of it on `main`, started by an `m<N>-complete` tag or by hand (linked in `docs/PROGRESS.md`). `.github/workflows/deploy.yml` deploys every push to `main` to clearfea.triyalabs.com after the fast tier (ADR-095, `docs/DEPLOYMENT.md`), first the solver image to AWS when no image of the current `worker/` and `packages/spec/` exists (`infra/aws/worker-image.sh`, ADR-101); it also runs by hand from the Actions tab, from an older tag to roll back. The nightly workflow stays a placeholder.
- Self-hosting mode (ADR-084): add `SELF_HOSTED=true` to `apps/api/.dev.vars` and restart `make dev`. Jobs are still charged to the wallet, but no run or mesh is refused for its balance.
- VPS mode (M12.4, ADR-120): add `MACHINES=vps` to `apps/api/.dev.vars` and restart `make dev`. New jobs are then refused (503) until a solver host checks in, which the compute manager does every 30 s; by hand: `curl -X POST -H "Authorization: Bearer $WORKER_TOKEN" -H 'Content-Type: application/json' -d '{"host":"dev"}' http://127.0.0.1:8787/internal/hosts/check-in`. The wallet then shows usage only.
- Storage sweep (ADR-086): `make dev` runs it at start and every hour by calling `http://127.0.0.1:8787/__scheduled` (wrangler dev runs with `--test-scheduled`; cron triggers never fire locally), and the per-minute tick every minute, the only thing that fails jobs of a silent worker since M11.3. Call that URL yourself to run it now. The free allowance, retention days and storage rate are rows of the `settings` table: `pnpm --filter @clearfea/api exec wrangler d1 execute DB --local --command "UPDATE settings SET value = 1 WHERE name = 'raw_output_retention_days'"`.
- Queue limits (M11.3, ADR-112) are rows of `settings` (`queue_waiting_per_user`, `queue_running_per_user`, `runs_per_user_per_day`, `queue_total_cap`), changed the same way; `infra/stack.sh` raises the daily run limit for `make verify` and `make e2e`. The request limit (120 per user per minute) is the `API_RATE_LIMIT` binding, added by `apps/api/scripts/productionConfig.mjs` only, so `make dev`, `make verify` and `make e2e` are not rate-limited.
- Solver machines on AWS (M10.7, ADR-100): the launcher runs only with `MACHINES=cloud` and the launcher key, so locally it does nothing; `http://127.0.0.1:8787/__scheduled?cron=*+*+*+*+*` runs the per-minute tick (lost jobs, then the launcher). Check `infra/aws/clearfea.yaml` with `cfn-lint --regions ap-south-1 us-east-1 -- infra/aws/clearfea.yaml` (cfn-lint from pip; not part of `make test`); `worker/tests/test_aws_template.py` checks its machine environment.
- Live checks (M10.9, ADR-104): the **Live checks** workflow (`.github/workflows/live-checks.yml`, started by hand) runs the harness against clearfea.triyalabs.com as the verification account, suite `quick`, `acceptance` or `limits`. Locally the same with `CLEARFEA_VERIFY_TOKEN` set, and, while the site is behind Cloudflare Access, `CLEARFEA_ACCESS_CLIENT_ID` and `CLEARFEA_ACCESS_CLIENT_SECRET` (the service token, `docs/DEPLOYMENT.md` 1.8, ADR-111): `cd verification && CLEARFEA_VERIFY_TOKEN=... uv run --project ../worker --locked python -m harness --api https://clearfea.triyalabs.com`. The API's route is off unless `VERIFY_TOKEN` (32+ characters) is set.
- `make dev` seeds two local test users (`alice` / `alice-local`, `bob` / `bob-local`, ADR-022); alice is the admin (`ADMIN_EMAIL=alice@clearfea.test` in `.dev.vars`) and sees **Admin** in the status bar. The live site signs in with Google instead (`AUTH_MODE=google`, ADR-097). Sign in at http://localhost:5173/app and use "Queue a no-op job" to see a job go from queued to succeeded. `pnpm --filter @clearfea/api db:seed` re-seeds them.
- `make verify` needs the same running Docker daemon and `BUILD_CA` as `make dev`; it leaves `make dev`'s data alone and can run beside it. Logs and `results.md`/`results.json` go to a temporary folder it names (or `VERIFY_OUT`). A case is a folder in `verification/cases/` (layout in `verification/README.md`).
- After changing the deck generator or the result reader, also run the exact checks that the platform path cannot see: `cd worker && uv run python spikes/deck_check/check.py` (ADR-029), `spikes/solve_check/check.py` (ADR-030), `spikes/support_check/check.py` (ADR-039), `spikes/load_check/check.py` (ADR-040) and, for thermal decks, `spikes/heat_check/check.py` (ADR-064) and, for modal decks, `spikes/modal_check/check.py` (ADR-070, SPOOLES; `--size` in mm); they need `ccx` and Gmsh's system libraries on the host. Deck snapshots live in `worker/tests/snapshots/deck/`; a missing one is written only with `CLEARFEA_WRITE_SNAPSHOTS=1`.
- `cd worker && uv run python benchmarks/solver/bench.py --out DIR` re-runs the M2.11 solver benchmark (ADR-048; options in `worker/benchmarks/solver/README.md`); it adds rows to `results.json`. Hours of CPU for the full range; needs `ccx` and Gmsh's system libraries on the host.
- `cd verification && uv run --project ../worker --locked python -m harness.limits` runs a model at each solver's element limit through a running `make dev` (M9.1, ADR-093; `--api`, `--out DIR`, case keys such as `pastix-2 modal-spooles-1`). About four hours for all ten, most of it the modal 10-node run; it needs the 16 GB machine the limits are for.
- The run estimator and the element limits per solver (ADR-049, ADR-063) are fitted from the job-step benchmark: with the worker image's `ccx` (`worker/ccx/build.sh`) first on PATH, `cd worker && uv run python benchmarks/solver/steps.py --out DIR --solver pastix 25000:2 ...` adds rows to `steps.json` (one solver per call; about 3 hours for the committed set, mostly SPOOLES and iterative scaling), modal rows come from the same script with `--solver spooles --analysis modal --modes 1` and `--modes 100` (M6.3, ADR-072; about 7 hours), then `uv run python benchmarks/solver/fit.py` rewrites `packages/spec/estimator.json`, bumping its version when a coefficient changes. `make test` fails when the file is not the fit of the data, and when `uv run python benchmarks/solver/check.py` (M8.9, ADR-081) finds a benchmark row whose estimated cost is outside the margin. Never edit `estimator.json` by hand.
- `make e2e` runs the Playwright browser tests (`apps/web/e2e`, E-01 to E-09) through a fresh API on :8789, a worker container (Compose project `clearfea-e2e`) and a dev server on :5174 (ADR-036); it needs the same Docker daemon and `BUILD_CA` as `make verify` and Playwright's Chromium once (`pnpm --filter @clearfea/web exec playwright install chromium`; the cloud environment has it). Report, traces, screenshots and E-05's Word and PDF report go to the folder it names (or `E2E_OUT`); extra arguments go to Playwright when it is run as `infra/e2e.sh` (for example `CLEARFEA_BUILD_CA=/root/.ccr/ca-bundle.crt infra/e2e.sh e07`), since `make` takes them as targets.

## When unsure

- A product question that `docs/DECISIONS.md` does not answer: ask the maintainer. Do not guess.
- A technical choice with more than one reasonable answer: pick the simpler one, record it as an ADR, and say so in the handoff notes.
- CalculiX or Gmsh behaviour: check their documentation or run a small experiment. Do not rely on memory for keyword syntax.
