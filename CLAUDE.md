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
- Physics verification and browser end-to-end tests run **nightly** and before each milestone is closed. See `docs/VERIFICATION.md`.
- Run the relevant physics cases **locally in the session** before opening a pull request that touches a physics-critical module. Paste the result table in the pull request description.
- A red nightly run is fixed before new feature work.
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
make lint        lint only (Biome for TypeScript, ruff for Python)
make format      format Python code with ruff
make spec        regenerate TypeScript types and Pydantic models from packages/spec/schemas
make worker-image  build the worker image on its own
```

- `make dev` needs a running Docker daemon. In the Claude Code cloud environment start it first with `nohup dockerd > /tmp/dockerd.log 2>&1 &` and run `make dev BUILD_CA=/root/.ccr/ca-bundle.crt` so the image build trusts the proxy (ADR-012). It creates `apps/api/.dev.vars` from the example if missing and passes its `WORKER_TOKEN` to the worker.
- CI (`.github/workflows/fast.yml`) runs `make install` and `make test` on every pull request; the DCO GitHub App checks sign-offs. The nightly workflow is a placeholder until `make verify` exists.
- `make dev` seeds two local test users (`alice` / `alice-local`, `bob` / `bob-local`, ADR-022). Sign in at http://localhost:5173 and use "Queue a no-op job" to see a job go from queued to succeeded. `pnpm --filter @clearfea/api db:seed` re-seeds them.
- Until `make verify` exists, check the deck generator against CalculiX with `cd worker && uv run python spikes/deck_check/check.py` (needs `ccx` and Gmsh's system libraries; ADR-029). Deck snapshots live in `worker/tests/snapshots/deck/`; a missing one is written only with `CLEARFEA_WRITE_SNAPSHOTS=1`.
- Check the result reader against CalculiX the same way with `cd worker && uv run python spikes/solve_check/check.py` (ADR-030).
- Planned, not yet present: `make verify` (physics suite, M1.13) and `make e2e` (browser tests, M1.14).

## When unsure

- A product question that `docs/DECISIONS.md` does not answer: ask the maintainer. Do not guess.
- A technical choice with more than one reasonable answer: pick the simpler one, record it as an ADR, and say so in the handoff notes.
- CalculiX or Gmsh behaviour: check their documentation or run a small experiment. Do not rely on memory for keyword syntax.
