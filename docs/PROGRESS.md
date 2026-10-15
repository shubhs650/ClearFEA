# Progress

Current state of the project. Update this file at the end of every working session.

## Now

- **Phase:** 0 (localhost prototype)
- **Current milestone:** M0 Bootstrap
- **Next task:** close M0 (all tasks done; M0 exit checked in M0.9), then M1.1
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
- [x] M0.9 Seeded test users and session login

### M1 Thin slice

- [x] M1.1 Spike: face identity chain
- [x] M1.2 Upload a STEP file; import job writes `topology.json` and the display mesh; unit detected and confirmed by the user
- [x] M1.6 `mesh` job with a global size; mesh shown in the viewer with element count
- [x] M1.7 Deck generator v1 with snapshot tests
- [x] M1.8 `solve` job: run CalculiX, stream the log, parse displacement and stress

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
> M0.8 (2026-10-14): `.github/workflows/fast.yml` runs on every pull request. Job `make test` runs `make install` then `make test` on `ubuntu-24.04` (Node 22, pnpm from `packageManager`, uv 0.11.32, Python 3.12, pnpm and uv caches); sign-offs are checked by the DCO GitHub App, which was already installed. Actions are pinned by commit SHA and the token is read-only (ADR-021, accepted). `.github/workflows/nightly.yml` runs at 02:00 UTC and by hand but only prints that no suites exist yet; replace its step when `make verify` (M1.13) lands. To require these checks, the maintainer adds `make test` and `DCO` as required status checks in branch protection for `main`. The first CI run (PR #9) took 34 s for `make test`.
>
> M0.9 (2026-10-14): two seeded test users, `alice` / `alice-local` and `bob` / `bob-local` (`apps/api/seed/test-users.sql`, applied by `db:seed`, which `pnpm --filter @clearfea/api dev` runs after the migrations). Migration 0003 adds `users.password_hash`. `POST`/`GET`/`DELETE /api/session` sign in, report and sign out with a signed, stateless cookie keyed by `SESSION_SECRET` in `apps/api/.dev.vars` (ADR-022, accepted); `infra/dev.sh` adds a random `SESSION_SECRET` to an older `.dev.vars` that lacks one. Signed-in routes use `requireUser` from `apps/api/src/session/`. Since M0's exit needs it, M0.9 also adds `POST /api/jobs` (noop only), `GET /api/jobs` and `GET /api/jobs/:id`, owner-scoped, with route tests that user B cannot read or list user A's jobs. The web app shows a sign-in form until someone is signed in, then the shell with a "Worker check" section in the settings pane that queues a no-op job and polls every 2 s while it is active; the status bar names the user and has Sign out. M0 exit checked with `make dev` in the cloud session and headless Chromium: sign in as alice, queue, Queued then Succeeded, worker log shows the claim; bob sees no jobs. The `readBody` helper moved from `internal.ts` to `src/body.ts` and now requires `Content-Type: application/json` (the worker already sends it). Not done here, on purpose: login rate limiting, revocable sessions and a projects route (M1). The sign-in form, the worker-check section and the jobs API shapes are new public surface; the worker-check section is meant to be replaced or moved once real job types exist.
>
> M1.1 (2026-10-14): the face identity spike is `worker/spikes/face_identity/` (script only; run command and result table in its README); findings are ADR-023 (accepted). The chain in `ARCHITECTURE.md` section 3 holds on all three models in mm, m and in, for first- and second-order tetrahedra. Confirmed: Gmsh does not report the STEP file's declared unit, so `step_units.py` reads it from the file; M1.2 should move it into the worker with unit tests. Import with `Geometry.OCCTargetUnit = "M"` (Gmsh's default is millimetres), and apply a user-corrected unit by re-importing with `Geometry.OCCScaling`, never `occ.dilate` (it turns faces into B-splines and moves areas by up to 0.3 percent). Not covered: CalculiX face numbering (M1.7), multiple bodies (M4), files from commercial CAD. To run Gmsh on the cloud host, `apt-get install libglu1-mesa libxrender1 libxcursor1 libxft2 libxinerama1 libgl1` first. numpy is not a worker dependency; the spike uses `uv run --with numpy==2.3.4`.
>
> M1.2 (2026-10-14): STEP upload, the `import` job and unit confirmation (ADR-024, accepted under Shubham's standing M1 instruction, pending his review). Upload in the web app's settings pane ("Geometry"), or `POST /api/geometries?name=…` with an `application/octet-stream` body (100 MB limit). The worker (`clearfea_worker/geometry/`) reads the unit with `step_units.py` (moved from the spike, now also reporting OpenCASCADE's reading factor), imports in metres, and uploads `topology.json` (schema `Topology` in `packages/spec/schemas/geometry.schema.json`) and `display.bin` (`packages/spec/display-mesh.md`; each face owns its vertex run). A geometry goes `importing` → `needs_unit` or `unconfirmed` → `ready`; choosing a unit other than the one the topology was made at re-imports with `OCCScaling`. Claimed jobs now carry `params` and `transfers`; locally the transfer URLs are `/internal/jobs/:id/files/:name?worker=…` (`apps/api/src/jobs/files.ts`). The worker image gets `units.json` through `--build-context spec=packages/spec` (the Makefile and Compose pass it). Checked end to end with `make dev` and headless Chromium: a mm file detected and confirmed, a file with no unit set to inches and re-imported (screenshots in the project's `m1.2/` folder). For M1.3: fetch `GET /api/geometries/:id/display` and `/topology`; positions are metres, so scale the camera from `size`. For M1.4/M1.5: lock the unit once a simulation references the geometry (today it can be changed while `ready`), and give geometries a project (`project_id` is null). Not done, on purpose: the heartbeat-timeout sweep (a worker that dies mid-import leaves the geometry `importing`), isolating Gmsh in a child process against crashes on malformed files, and µm or mixed-unit files, which fail with a request to re-export. The "Worker check" list now shows each job's type, since import jobs appear in it too. CI (`fast.yml`) now installs Gmsh's system libraries, approved by Shubham, so worker tests may load Gmsh.
>
> M1.3 (2026-10-15): the viewer (ADR-025, accepted under Shubham's standing M1 instruction, pending his review). `apps/web/src/viewer/displayMesh.ts` reads and checks `display.bin` and resolves a triangle to its face; `ModelView.ts` is the three.js scene (three 0.186.1, `OrbitControls`); `layout/Viewer.tsx` loads the display mesh and topology for the geometry the Geometry panel shows (status `needs_unit`, `unconfirmed` or `ready`, reloaded when a re-import changes `scaling`). Click toggles a face in the selection, Escape or Clear empties it; the selection is a `Set` of face tags held in `App` and cleared when the geometry changes, so M1.5 can pass it to the support and pressure panels. Component tests mock `ModelView` (jsdom has no WebGL); the scene was checked with `make dev` and headless Chromium using `--use-angle=swiftshader --enable-unsafe-swiftshader` on the M1.1 bracket and flanged pipe (screenshots in the project's `m1.3/` folder). The shared fixture `packages/spec/fixtures/display-two-faces.bin` ties the worker's writer to the web reader. Not done, on purpose: box or shift selection, showing the analysis mesh (M1.6), face areas in the hover line (needs area units, M2.1). The hover line keeps the last face while the user orbits and refreshes on the next pointer move.
>
> M1.4 (2026-10-15): `SimulationSpec` v1 and the simulations API (ADR-026, accepted under Shubham's standing M1 instruction, pending his review). Schema `packages/spec/schemas/simulation.schema.json`; `checkSimulationSpec` and `emptySimulationSpec` in `packages/spec/src/simulation.ts` do what the schema cannot (unit kinds from `units.json`, positive modulus and mesh size, unique ids, material references, tags against `topology.json`); shared fixture `packages/spec/fixtures/simulation-v1.json` is read by the TypeScript tests, the API tests and the worker's Pydantic test. Migration 0005 adds `simulations`; routes are `POST /api/simulations { geometryId, name, spec? }` (geometry must be `ready`; without `spec` it starts empty with every body listed), `GET /api/simulations[?geometryId=]`, `GET /api/simulations/:id`, `PUT /api/simulations/:id/spec` (whole replace). Values may be `null` and face lists empty, so M1.5 can save on every edit and mark incomplete items; the API refuses only wrong content, never missing content (that is M1.12's list). A geometry's unit is locked once a simulation uses it (409 on change, `GeometryView.unitLocked`, the Geometry panel shows a note instead of the unit control). For M1.5: create the simulation when the user starts setup, give new items ids such as `pressure-<n>`, and run `checkSimulationSpec` in the browser before saving to show problems early. For M1.7: a positive pressure pushes towards the body (ADR-026 item 4); refuse repeated face tags, which the Pydantic model does not check. Not done, on purpose: renaming or deleting simulations, concurrent-save detection, projects.
>
> M1.5 (2026-10-15): the simulation tree and setup panels (ADR-027, accepted under Shubham's standing M1 instruction, pending his review). `apps/web/src/setup/useSimulation.ts` opens the geometry's newest simulation (or offers "Start setup", which locks the unit), keeps the spec in state and saves the whole spec 400 ms after the last edit, checked in the browser first. `setup/spec.ts` holds the pure edit helpers and `setupStatus`, the complete / incomplete / error marks; error marks use the new `simulationSpecProblems` in `packages/spec`, which tags each `checkSimulationSpec` problem with its item id. Panels are in `setup/ItemPanels.tsx`, fields in `setup/fields.tsx` (a stand-in quantity input until M2.1; GPa and MPa offered first). Selecting a tree item is `selected` in `App`; opening a support or load puts its faces into the viewer selection, and a new one takes the current selection. The Geometry panel and the worker check now show only when the Geometry row is selected (the Geometry panel stays mounted, since it loads the geometry). Checked with `make dev` and headless Chromium on the M1.1 bracket: upload, confirm, start, material, support, pressure, reload keeps everything (screenshots in the project's `m1.5/` folder). For M1.6: add a Mesh row and panel for `spec.mesh.size` (a length `QuantityField` with `positive`), and its mark in `setupStatus`. For M1.12: `setupStatus` notes are a start for the pre-run list. Not done, on purpose: flushing a pending save when the page closes, renaming or choosing between simulations, a mesh row.
>
> M1.6 (2026-10-15): the `mesh` job and the mesh view (ADR-028, accepted under Shubham's standing M1 instruction, pending his review). The worker's `clearfea_worker/meshing/mesher.py` re-imports `model.step` at the geometry's `scaling`, fails as a platform fault if any face differs from `topology.json`, meshes with 10-node tetrahedra (`Mesh.MeshSizeMax` = the global size; no point or curvature sizes) and writes `mesh.bin` (`packages/spec/volume-mesh.md`, writer and reader in `meshing/volume.py`) and a `display.bin` of the mesh surface. `POST /api/simulations/:id/mesh` queues it with the saved spec's size; `GET /api/simulations/:id/mesh` and `GET /api/meshes/:id[/display]` read it (migration 0006: `meshes`, `simulations.mesh_id`). The Mesh row's panel takes the size (the geometry's unit first) and generates; while the row is open the viewer draws the mesh with element edges and "Mesh: N elements, M nodes". Checked with `make dev` and headless Chromium on the M1.1 bracket: 4 mm gave 12,157 elements, 2.5 mm 43,374; 0.01 mm was refused with the smallest allowed size (screenshots in the project's `m1.6/` folder). For M1.7: read `mesh.bin` with `read_volume_mesh`; elements are in Gmsh's node order (for C3D10 the last two mid-edge nodes swap) and `localFace` uses the corner table in `volume-mesh.md`, so map both to CalculiX and check against its manual; a run should use the simulation's mesh only when its size equals the spec's (`meshIsCurrent` in the web app). Surprise: OpenCASCADE keeps the unit of an earlier import for later STEP writes in the same process, so the test models now set `Geometry.OCCTargetUnit = "MM"` before writing. Not done, on purpose: metering (M1.11), quality summary and local sizes (M2.8), mesh reuse (M2.10), cancelling a mesh, the heartbeat-timeout sweep.
>
> M1.7 (2026-10-15): the deck generator (ADR-029, accepted under Shubham's standing M1 instruction, pending his review). `clearfea_worker/deck/generate_deck(spec, mesh)` returns the CalculiX input text; `deck/elements.py` maps Gmsh's node order and local faces to C3D4/C3D10 (last two mid-edge nodes swap; local faces 0-3 are CalculiX faces 1, 2, 4, 3), `deck/loads/` holds the fixed support (node set of corner and mid-edge nodes) and pressure (`*DLOAD` per element face, value unchanged since CalculiX's positive pressure already pushes into the body). Snapshots in `worker/tests/snapshots/deck/`; a missing one is written only with `CLEARFEA_WRITE_SNAPSHOTS=1`. `worker/spikes/deck_check/check.py` solves a meshed bar with `ccx` (28 checks, all within tolerance: reaction direction for every face and sign, tip displacement p·L/E) until V-01/V-02 and `make verify` exist (M1.13; fold the bar checks into a case there). For M1.8: the deck asks for `U` and `S` in the `.frd` and the total reaction per support set (`S1`, `S2`, … in spec order) in the `.dat`; generate the deck with the simulation's mesh only when the mesh is current, and treat `DeckError` as the user's fault with its message. Surprise: CalculiX's reaction total leaves out the part of a pressure that lands on nodes the support holds (a pressed face touching a fixed face), so reactions do not balance applied loads exactly on such models; M3.2's balance check must sum applied loads over free nodes only, or report the two separately. Not done, on purpose: solver options (M2.11), element order choice (M2.8), and `make verify` (M1.13).
>
> M1.8 (2026-10-15): runs and the `solve` job (ADR-030, accepted under Shubham's standing M1 instruction, pending his review). `POST /api/simulations/:id/runs` freezes the saved spec with the simulation's current ready mesh (migration 0007: `runs`, `job_logs`); `GET /api/simulations/:id/runs`, `GET /api/runs/:id` and `GET /api/runs/:id/log?after=n` read them. The worker's `run_solve` (in `jobs.py`) writes the deck, runs `ccx` through `solver.run_calculix` (child process, line-buffered with `stdbuf`, cancellable), streams its output in heartbeat `log` chunks, uploads `deck.inp`, `solver.log`, `results.frd`, `results.dat` to `owners/<owner>/runs/<id>/`, and reads results with `clearfea_worker/results/` (`read_results` → nodal displacement and stress arrays plus a `SolveResult` summary). The Run row and panel run it, show the stage and the live log, then the largest displacement, von Mises range and reactions. Checked: `worker/spikes/solve_check/check.py` (10 of 10 against closed-form answers) and `make dev` with headless Chromium on the M1.7 bar, mesh to run to figures in the browser (screenshots in the project's `m1.8/` folder; the setup was written through the API, since picking faces was checked in M1.5). For M1.9: `read_results` already returns the nodal fields (`NodalFields`, SI, node index order of `mesh.bin`); write the surface field files from them in `run_solve` and add their uploads to `jobFiles` in `apps/api/src/jobs/files.ts`. For M1.10: the run row holds the frozen spec and mesh id; the deck and log are stored even for a failed run. For M1.13: fold the solve_check cases into V-01/V-02. Surprise: CalculiX 2.21 with SPOOLES solves a model with no supports without a warning and returns huge displacements, so any later support type that can leave rigid-body motion needs its own check. Not done, on purpose: the heartbeat-timeout sweep (a run whose worker dies stays `solving` and blocks the next run), a solver time limit, thread count and memory per machine size, field files (M1.9). Two web tests ("draws a ready mesh…" in `Setup.test.tsx`, "draws the display mesh once…" in `Viewer.test.tsx`) were flaky under load: they read the stand-in scene right after the text appeared, before the effect that hands the mesh to the scene had run. They now wait for the scene, with the same assertions.
>
> Still to watch from the ADR review: browser-captured report figures (ADR-011) mean report generation needs the browser open.

## Parked ideas

Ideas that came up during work and are outside the current milestone. Do not build these without a decision.

- Shrink the worker image (about 990 MB): Mesa and Open MPI pull in LLVM and GPU libraries the worker does not use.

## Log

Newest first. One entry per session: date, what was done, what was learned.

### 2026-10-15

- M1.8: runs with a frozen spec and mesh, `solve` job running CalculiX as a supervised child process, solver log streamed with the heartbeats and shown live in a Run panel, displacement, stress, von Mises and reactions read from the `.frd` and `.dat` files and checked against closed-form answers (ADR-030 accepted under the standing M1 instruction).

- M1.7: deck generator from spec and mesh file to CalculiX input (C3D4/C3D10 mapping, fixed supports, pressures summed per element face, SI conversion through `units.py`), deck snapshot tests, and a solver check of face numbers, pressure sign and stiffness on a meshed bar (ADR-029 accepted under the standing M1 instruction).
- M1.6: `mesh` job (re-import checked against `topology.json`, second-order tetrahedra of one global size, face-to-element map in `mesh.bin`), meshes table and routes, Mesh row and panel, viewer draws the mesh with element edges and counts (ADR-028 accepted under the standing M1 instruction).
- M1.5: simulation tree with complete / incomplete / error marks, settings panels for a material, a fixed support and a pressure that save the spec after each edit, faces taken from the viewer selection (ADR-027 accepted under the standing M1 instruction).
- M1.4: `SimulationSpec` v1 schema with draft-friendly nulls, semantic checks shared by API and web, `simulations` table and owner-scoped routes, geometry unit locked once a simulation uses it (ADR-026 accepted under the standing M1 instruction).
- M1.3: viewer renders the display mesh with three.js, orbits and zooms, highlights the face under the pointer and toggles faces into a selection on click; the display reader is tested against a fixture the worker writes (ADR-025 accepted under the standing M1 instruction).

### 2026-10-14

- M1.2: STEP upload, `import` job writing `topology.json` and the display mesh, unit detected from the file and confirmed or corrected by the user (re-import at the chosen unit), per-job file transfer routes, `units.json` in the worker image (ADR-024 accepted under the standing M1 instruction).
- M1.1: face identity spike on three generated models in three declared units; tags stable across processes, every surface triangle maps to one tetrahedron face and lies on its own face; Gmsh does not report the STEP unit, so the file is read directly (ADR-023 accepted).
- M0.9: seeded test users `alice` and `bob`, session login with a signed cookie (ADR-022 accepted), owner-scoped `/api/jobs` routes, sign-in form and a worker check in the web app; M0 exit (no-op job queued to succeeded from the browser) checked with `make dev`.
- M0.8: GitHub Actions fast tier (`make test`) on every pull request (DCO sign-off left to the already-installed DCO App), nightly workflow placeholder (ADR-021 accepted).
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
