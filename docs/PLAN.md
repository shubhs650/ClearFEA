# Plan

Phase 0 builds a fully working prototype on localhost. It starts with a thin end-to-end slice and widens in steps. Every milestone ends in a usable state, with its verification cases passing.

Task status is tracked in `PROGRESS.md`. Scope questions are answered by `DECISIONS.md`.

## Milestone summary

| # | Milestone | Ends with |
| --- | --- | --- |
| M0 | Bootstrap | One command starts an empty but connected system; CI fast tier runs |
| M1 | Thin slice | STEP upload to stress contour for a single body, metered |
| M2 | Structural setup | Full structural load set, units, local mesh control, materials |
| M3 | Results tools | Engineering result set, reaction check, export |
| M4 | Assemblies | Multi-body models with reviewed bonds |
| M5 | Thermal | Steady thermal and thermal stress, temperature-dependent materials |
| M6 | Modal | Natural frequencies and mode shapes |
| M7 | Report | PDF and Word report |
| M8 | Platform | Wallet, estimates, stop limit, storage rules, share links, isolation tests |
| M9 | Gate | Size targets, acceptance cases, outside trial |
| M10 | Live closed beta | ClearFEA live at clearfea.triyalabs.com for invited engineers; merges deploy themselves (ADR-095) |
| M11 | Fix the live beta | Machines, deploys and checks get through Cloudflare Access; polling backs off; queue limits |
| M12 | Solver on the VPS | Every job runs on one always-on VPS in a limited container, with retries and per-run statistics |
| M13 | Admin dashboard | Overview, jobs and runs, users, events, settings and costs, with CSV and Excel export |
| M14 | Projects home | Projects, folders, recent items and trash per user |
| M15 | Workbench tree and flow | SimScale-style tree, many meshes and runs per simulation, job status, profile page |
| M16 | Coordinate systems and browser geometry | Local coordinate systems; STEP preview in the browser |
| M17 | Results ribbon, polish and relaunch | Animation and a full results ribbon; design pass; colleagues back |

## M0: Bootstrap

**Goal:** a repository in which every later task has a place to go.

- [ ] M0.1 Confirm Docker works in the Claude Code cloud environment. If it does not, record the fallback (worker as a plain process) as an ADR.
- [ ] M0.2 Create the monorepo layout from `ARCHITECTURE.md` section 2 with pnpm workspaces, `uv` and a top-level `Makefile`.
- [ ] M0.3 API skeleton: Hono on `wrangler dev`, local D1 with a first migration (`users`, `projects`), local R2 binding, health route.
- [ ] M0.4 Web skeleton: Vite, React, TypeScript, three-pane layout shell, calls the health route.
- [ ] M0.5 Worker skeleton: Python package, Dockerfile with pinned Gmsh and CalculiX, claim loop that completes a no-op job.
- [ ] M0.6 `packages/spec`: first JSON Schema, type generation for TypeScript and Pydantic, `units.json` with length, force and pressure.
- [ ] M0.7 `make dev`, `make test`; fill in the Commands section of `CLAUDE.md`.
- [ ] M0.8 GitHub Actions: fast tier on pull requests (unit, snapshot, types, lint), DCO check, nightly workflow placeholder.
- [ ] M0.9 Seed two test users and a session login.

**Exit:** a fresh clone, one command, a page in the browser that shows a no-op job going from queued to succeeded.

## M1: Thin slice

**Goal:** prove the whole chain on the narrowest real case: one body, one material, fixed support, pressure, linear static.

- [ ] M1.1 **Spike: face identity chain.** Script only, no UI. For three STEP models (a block, a flanged pipe, a part with fillets and holes): import, write topology, tessellate, mesh, and show that every face tag maps to the right element faces. Record findings as an ADR.
- [ ] M1.2 Upload a STEP file; `import` job writes `topology.json` and the display mesh; unit detected and confirmed by the user.
- [ ] M1.3 Viewer: render the display mesh, orbit, zoom, hover and click to select faces.
- [ ] M1.4 `SimulationSpec` v1: one body, one isotropic material, fixed support, pressure, global mesh size.
- [ ] M1.5 Simulation tree with status marks; settings panels for material, fixed support and pressure.
- [ ] M1.6 `mesh` job with a global size; mesh shown in the viewer with element count.
- [ ] M1.7 Deck generator v1 with snapshot tests.
- [ ] M1.8 `solve` job: run CalculiX, stream the log, parse displacement and stress.
- [ ] M1.9 Surface result files; viewer shows displacement and von Mises contours with a legend and deformed shape.
- [ ] M1.10 Run record frozen with spec, mesh, deck, versions; deck and log viewable and downloadable.
- [ ] M1.11 Metering: billable seconds recorded and a ledger entry written at a configured rate.
- [ ] M1.12 Pre-run validation with a plain-language list beside the Run button.
- [ ] M1.13 First verification cases and the `make verify` harness.
- [ ] M1.14 One browser end-to-end test of the full slice on a tiny model.

**Verification added:** V-01 thick cylinder under internal pressure, V-02 cantilever with end pressure load.

**Exit:** the maintainer uploads a STEP part and reaches a stress plot without touching a file by hand.

## M2: Structural setup

**Goal:** everything needed to set up a real single-body structural job.

- [ ] M2.1 Complete `units.json`; quantity input component; project default system; fixture tests in both languages.
- [ ] M2.2 Prescribed displacement and frictionless/symmetry support (planar faces).
- [ ] M2.3 Force on a face; gravity; centrifugal load.
- [ ] M2.4 Remote force and moment through a reference point.
- [ ] M2.5 Hydrostatic pressure (fluid density, free-surface level, direction).
- [ ] M2.6 Elastic support.
- [ ] M2.7 Uniform temperature change.
- [ ] M2.8 Local mesh sizes on faces, edges and bodies; element order choice; quality summary.
- [ ] M2.9 Material library (generic values with sources), custom materials saved per user.
- [ ] M2.10 Mesh reuse across runs by settings hash.
- [ ] M2.11 **Benchmark: solver build.** Compare SPOOLES, PaStiX and the iterative solver for time and memory from 100,000 to 2 million elements. Fix the production build. Record as an ADR.
- [ ] M2.12 Estimator v1 fitted from the benchmark data; estimate shown before run; machine size recommendation.

**Verification added:** V-03 plate with hole, V-04 remote force and moment equilibrium, V-05 hydrostatic tank wall, V-06 rotating ring, V-07 spring-supported block, V-08 constrained thermal expansion, V-09 symmetry model against full model, V-10 gravity self-weight.

**Exit:** every structural load and support in `DECISIONS.md` can be applied through the UI and has a passing case.

## M3: Results tools

- [ ] M3.1 Principal stresses, stress and strain components.
- [ ] M3.2 Reaction forces and moments per support; applied-load totals; balance check shown on every result.
- [ ] M3.3 Min/max markers and probe at a picked point.
- [ ] M3.4 Cut planes. Settle the large-model approach by measurement and record an ADR.
- [ ] M3.5 Safety factor against yield.
- [ ] M3.6 Hide/show bodies; saved views.
- [ ] M3.7 Display-unit switching for results without rerun.
- [ ] M3.8 CSV and VTK export.

**Exit:** the balance check closes on all verification cases, and results can be inspected inside the model.

## M4: Assemblies

- [ ] M4.1 Multi-body import: bodies listed, per-body material assignment.
- [ ] M4.2 Bond detection between touching faces with a tolerance; bond list with accept and remove; highlight in the viewer.
- [ ] M4.3 Per-body meshing; tie constraints in the deck.
- [ ] M4.4 Validation: unbonded or unrestrained bodies reported before run.
- [ ] M4.5 Report text noting reduced stress accuracy at tied interfaces (stored for M7).

**Verification added:** V-11 two bonded blocks against one block, V-12 bi-material bar.

**Exit:** a three-body model (shell section, nozzle, pad) runs with balanced reactions.

## M5: Thermal

- [ ] M5.1 Steady-state thermal analysis type; thermal material properties.
- [ ] M5.2 Fixed temperature, heat flux, convection, radiation to ambient, internal heat generation.
- [ ] M5.3 Temperature and heat-flux results; heat balance check (heat in against heat out).
- [ ] M5.4 Thermal stress: thermal step then static step; temperature field visible in the structural result.
- [ ] M5.5 Temperature-dependent property tables in materials, UI and deck.
- [ ] M5.6 Thermal bonds across tied interfaces.

**Verification added:** V-13 plane wall conduction, V-14 cylinder wall conduction, V-15 wall with convection both sides, V-16 radiating plate, V-17 internal generation slab, V-18 thick cylinder thermal stress, V-19 temperature-dependent conductivity, V-27 two-layer tube wall (bonded layers, M5.6).

**Exit:** a hot-inside, cool-outside thick component gives a temperature profile and thermal stress matching closed-form values.

## M6: Modal

- [x] M6.1 Modal analysis type: number of modes, supports only.
- [x] M6.2 Frequency table; mode shape display and animation.
- [x] M6.3 Estimator terms for modal runs.

**Verification added:** V-20 cantilever beam frequencies, V-21 fixed-fixed beam frequencies (VERIFICATION.md's case; corrected from "simply supported plate" in M6.1), V-22 free-free check (rigid-body modes near zero).

**Exit:** first frequencies match references within tolerance.

## M7: Report

- [x] M7.1 Report options: sections, saved views, title block, company name, logo.
- [x] M7.2 Figure capture in the browser: one per load and support, plus selected result views.
- [x] M7.3 DOCX assembly with all sections in `DECISIONS.md`.
- [x] M7.4 PDF output matching the DOCX.
- [x] M7.5 Standing statements: analysis-tool positioning, versions, verification link, tied-interface note. No verdict wording anywhere.
- [x] M7.6 Values printed in the report's chosen unit system.

**Exit:** the maintainer would hand the report for a verification case to a reviewer.

## M8: Platform

- [x] M8.1 Wallet page: balance, ledger, per-run cost.
- [x] M8.2 Running-job view: stage, elapsed time, cost so far against estimate, live log, cancel.
- [x] M8.3 Stop limit per run with a default multiplier and user override.
- [x] M8.4 Failure classification end to end, with category and reason shown on the run.
- [x] M8.5 Simulated machine sizes on localhost (thread count, memory limit); out-of-memory path tested.
- [x] M8.6 Storage accounting per user, free quota, retention of raw output, pin, regenerate by rerun.
- [x] M8.7 Read-only share link per run, revocable.
- [x] M8.8 Data isolation tests across every route and file key.
- [x] M8.9 Estimator check: predicted against measured on the benchmark set.
- [x] M8.10 Self-hosting mode flag: wallet informational.

**Exit:** ledger reconciles exactly over the full verification suite; isolation tests pass.

## M9: Gate

- [x] M9.1 Run a model at each solver's element limit (ADR-063) in the development environment; fix what breaks. (The 2-million-element target was dropped by ADR-063.)
- ~~M9.2 Set up and run on the laptop; demonstrate the laptop tier; fix viewer performance.~~ Removed by the maintainer on 2026-10-21: the gate has no local laptop requirement (ADR-095 item 12, amended). He ran it on Windows on 2026-10-19; the 16 GB checks ran on the live standard machine (M10.9).
- [x] M9.3 User guide for the main flow; self-hosting instructions.
- [x] M9.4 Build the two acceptance models as original geometry that can be published.
- [x] M9.5 Acceptance case A: nozzle, shell and pad under pressure and nozzle loads. Hand checks and FreeCAD FEM comparison.
- [x] M9.6 Acceptance case B: thermal stress. Hand checks and FreeCAD FEM comparison.
- [x] M9.7 Publish the verification results page.
- [x] M9.8 Outside trial: two or three engineers complete the tutorial case unaided over a screen share; fix the top problems found.
- [x] M9.9 Walk the "Phase 0 is done when" checklist in `DECISIONS.md` and record the outcome.
- [x] M9.10 Supports on edges (fixed and prescribed displacement, picked in the viewer) and V-23, NAFEMS LE10, in `make verify` (ADR-105). Added 2026-10-21 at the maintainer's request, since V-23 was listed but needed a support on an edge.

**Exit:** all eight gate conditions met. Since ADR-095, gate items 1 and 4 are met on the live standard machine and item 8 by the invited colleagues on the live site; since 2026-10-21 there is no laptop run (M9.2 removed), and M9 closes after them.

## M10: Live closed beta

**Goal:** the prototype runs live at `clearfea.triyalabs.com` for two or three invited engineers, with nothing to install, and every merge to main reaches the site and the solver machines on its own (ADR-095). Added 2026-10-19 by the maintainer's decision to replace self-hosting with a hosted closed beta for the outside trial. M9 stays open: M9.2, M9.8 and M9.9 are done on the live site once M10 has put it there.

The maintainer's setup steps (Cloudflare, Google, AWS, GitHub secrets) are in `DEPLOYMENT.md`; each task says which ones it needs.

- [ ] M10.1 Production Worker: one Worker serves the built web app as static assets and the API on one origin, with the custom domain `clearfea.triyalabs.com`; `/` for the landing page, `/app` for the workbench, `/share/<token>` as now; production D1 and R2; `/api/health` reports the deployed commit. First deploy by hand from the workflow of M10.2. Needs: Cloudflare account ID and deploy token.
- [ ] M10.2 Deploy workflow for the site and API (`.github/workflows/deploy.yml`): on every push to main, the fast tier, D1 migrations, secrets copied from GitHub to the Worker, `wrangler deploy`, and a health check of the new commit. A CI configuration change, covered by the maintainer's go-ahead for M10.
- [ ] M10.3 Google sign-in with Better Auth: allowlist table, admin email from configuration, refusal checked at user and session creation, an admin page to add and remove addresses and see users; the seeded password login only under `AUTH_MODE=local`; isolation tests extended to the new routes. Needs: Google OAuth client, `BETTER_AUTH_SECRET`, `ADMIN_EMAIL`.
- [ ] M10.4 Landing page at `/`: what ClearFEA does, how it works, the analyses, verification results, open source, closed beta notice and Sign in with Google; light and dark; screenshots for review. Polished, not bare.
- [ ] M10.5 Job files through presigned R2 URLs in production (up to 5 GiB, valid until the stop limit plus a margin); STEP uploads streamed to R2; pass-through routes kept for `make dev`. Needs: R2 API token.
- [ ] M10.6 Worker cloud mode: machine size from the environment, claims only jobs for its size (light jobs on standard), exits after 10 idle minutes and after a maximum lifetime; cloud size list standard (on) and large (defined, off).
- [ ] M10.7 AWS: the CloudFormation template (`infra/aws/clearfea.yaml`) and the launcher in the API: `RunTask` when work is queued and no worker of its size is alive, start records, a start retried by the scheduled handler, a job failed as a platform fault after three starts without a worker, the monthly machine-hours cap. Needs: AWS account, stack created, launcher access key.
- [ ] M10.8 Deploy workflow for the worker: when `worker/` or `packages/spec/` changed, build the image, push it to ECR and register new task definition revisions before the API deploys.
- [ ] M10.9 Live checks: a verification account that signs in with a secret token, a workflow that runs the quick verification tier against the live site, acceptance cases A and B through the UI on the live standard machine, and a model at each solver's element limit on it (gate items 1 and 4).
- [ ] M10.10 Beta onboarding: the user guide for the live site (sign-in, no install), an admin guide (inviting, removing, switching on the large size, costs), and the first colleagues invited by the maintainer. Then M9.8 and M9.9.

Order: M10.1, then M10.2; M10.3 to M10.6 after it (M10.3 and M10.4 both change the web app's entry, so in sequence); M10.7 after M10.5 and M10.6; then M10.8, M10.9 and M10.10.

**Verification added:** none. Physics, solver numerics, tolerances and the verification cases are unchanged; M10.9 runs the existing cases through the live site.

**Exit:** an invited colleague signs in with Google at `clearfea.triyalabs.com` and completes the tutorial to a report with nothing installed; an address not on the allowlist is refused; the solver machine stops after its idle time and AWS shows no running task; a merge to main reaches the live site and, for a worker change, the next solver machine without a manual step; the quick verification tier is green against the live site.

## Closed beta redesign (M11 to M17)

**Approved by Shubham on 2026-10-22, with an autodrive for these milestones.** Shubham asked for a redesign of the closed beta after the colleagues' first feedback and the AWS bill (thread "Closed beta redesign plan"): the solver moves from AWS Fargate to one always-on Contabo VPS (8 vCPU, 24 GB) run by a compute manager, Cloudflare Access hides the site until the public beta, the admin page becomes a dashboard, and the workbench gets a projects home and a SimScale-style tree. ADR-106 to ADR-119 are accepted. His answers: AWS off until production and its resources deleted; a Contabo Cloud VPS 8 on a monthly plan that nothing creates or replaces automatically; the repository stays private; Access stays for the closed beta; alerts on the dashboard only; the PaStiX to SPOOLES retry; statistics only for support; any change makes a new run; usage shown, nothing charged against a balance; the starting limits as proposed.

Two threads at a time: thread A takes M11.1, M12, M13 and M16; thread B takes M11.2, M11.3, M14, M15 and M17. Colleagues come back once M12 and M14 are done.

### M11: Fix the live beta

**Goal:** the live site's machines, deploys and checks get through Cloudflare Access, and the browser and API stop asking the server more than they need to.

- [x] M11.1 Cloudflare Access service token (ADR-111): the worker sends `CF-Access-Client-Id` and `CF-Access-Client-Secret` and treats a non-JSON answer as "blocked by Access" with back-off instead of crashing; the deploy health check, the Live checks workflow and the verification harness send them too; the web app says when the Access sign-in has expired; `deploy.yml` stops building and registering the AWS solver image, since AWS is being deleted. Needs: the service token, a Service Auth policy and two GitHub secrets.
- [x] M11.2 Polling discipline (ADR-112): one shared polling hook (2 s doubling to 30 s, paused in hidden tabs, one request in flight, stops at a final state) replaces the geometry, mesh, run and report timers; the job status answer carries the queue position and a `retryAfter` hint; the machine-wait poll folds into it.
- [x] M11.3 Server protections (ADR-112): the launcher runs only after routes that queue a job; the lost-job sweep only in the per-minute cron; per-user and total queue limits; Workers rate limiting on `/api`; the limits as settings.

Order: M11.1 and M11.2 in parallel, M11.3 after M11.2. Fixing the AWS launcher (stopping a machine that never checks in, counting it as running, pausing starts after a failure streak) is parked until AWS returns for production, with the maintainer's review.

**Exit:** deploy and Live checks green behind Access; a 20-minute solve costs about 60 status requests from one tab. (At the M11 close, 2026-10-22: the Live checks' cases all import, mesh and solve, and with AWS off nothing on the live site takes a job until M12.7, so their run behind Access is checked by M12's exit, which runs the quick tier and cases A and B on the VPS through the same service token.)

### M12: Solver on the VPS

**Goal:** every job runs on one always-on VPS in its own container with limits, crashes are handled and recorded, and each run keeps its statistics (ADR-106 to ADR-110).

- [ ] M12.1 Compute manager: claims jobs through the existing API, one hardened container per job through the Docker API (non-root, no capabilities, read-only root, process and memory limits), a light lane (import, mesh, report; 1 vCPU, 4 GB) and a solve lane (6 vCPU, 17 GB), one job per lane, a fairness rule between users, reattach or stop its containers after its own restart.
- [x] M12.2 Crash handling and retries (ADR-108): attempts per job; platform faults re-queued at most twice and not charged; out of memory recorded with peak memory; a PaStiX crash retried once with SPOOLES under SPOOLES's limit, the run record naming the solver used.
- [x] M12.3 Statistics (ADR-109): `job_stats` (queue wait, stage times, nodes, elements, degrees of freedom, solver, peak memory, CPU, disk, exit, attempt, host, image) and `host_stats` (every 30 s, kept 14 days); internal routes; sampling in the manager.
- [x] M12.4 API VPS mode: `MACHINES=vps`, solver online or offline from host check-ins, a plain refusal when the host has not checked in for 2 minutes, queue position in job status; the wallet shows usage only and refuses nothing for its balance (ADR-106 item 6).
- [ ] M12.5 VPS setup as code (ADR-110): `infra/vps/` (bootstrap script, systemd unit, environment template, image updater); `deploy.yml` stores the worker image as an archive in R2 (ADR-110); the redeploy guide in `DEPLOYMENT.md`, with a manual restart when the VPS stops (nothing creates a new VPS). Needs: the VPS ordered with the maintainer's SSH key.
- [ ] M12.6 Benchmark on the VPS: job-step benchmark, estimator refit, element limits per solver for the solve lane, Gmsh memory for the light lane, the hourly rate for metering.
- [ ] M12.7 Go live on the VPS: production on `MACHINES=vps`; Live checks quick tier, acceptance cases A and B and the limit models against it; AWS stays off.

Order: M12.1 and M12.4 in parallel; M12.2 and M12.3 after M12.1; M12.5 after them; then M12.6 and M12.7.

**Exit:** a colleague's import, mesh and solve run on the VPS with no machine start; a run killed from outside is re-queued and finishes; the admin can read each run's statistics; the quick tier and cases A and B are green on the VPS.

### M13: Admin dashboard

**Goal:** the admin sees and controls the beta from one dashboard and exports any table (ADR-113).

- [x] M13.1 Events table: sign-ins and refusals, job failures and retries, manager and host events, admin actions as an audit trail.
- [ ] M13.2 Dashboard shell with the Overview (host, lanes, queue, alerts, pause and resume), Jobs and runs (statistics, cancel, re-queue, log) and Events tabs.
- [x] M13.3 Users, Settings and Costs tabs; every setting editable and logged as an event.
- [x] M13.4 CSV and Excel (.xlsx) export of every table, by date range.
- [ ] M13.5 Alerts on the dashboard: solver host offline (restart it by hand), disk low, out of memory, repeated platform failures.

After M12.3.

### M14: Projects home

**Goal:** each user has a home with projects, folders, recent items and trash (ADR-114).

- [x] M14.1 Data model: `folders`; projects gain a folder, `deleted_at`, `last_opened_at` and a thumbnail; geometries and simulations always belong to a project; each user's existing work moves into "My first project"; owner-scoped access and isolation tests.
- [x] M14.2 API: create, rename, move and duplicate folders and projects; trash and restore; purge after the retention period in the storage sweep, with R2 deletes.
- [x] M14.3 Home page: Recent, My projects with the folder tree, Trash; grid and list, sort, search, info panel, thumbnails from the viewer; `/app` opens the home, `/app/p/<id>` the workbench.
- [x] M14.4 Browser test E-10 for the home page and trash.

Independent of M12.

### M15: Workbench tree and flow

**Goal:** the SimScale-style flow: geometry, simulation, coordinate systems, materials, boundary conditions, many meshes, many runs, results per run, with live job status (ADR-115).

- [ ] M15.1 Tree restructure (geometries, simulations and their items) and a job status strip for the project.
- [ ] M15.2 Many named meshes per simulation; a run picks one; reuse by settings hash stays.
- [ ] M15.3 Many runs per simulation, each with its mesh and simulation control; any change followed by Run makes a new run; the run list shows what changed from the previous run and its maximum values.
- [ ] M15.4 Profile page: name and picture, default units and title block, wallet history, storage, sessions, data download.
- [ ] M15.5 Browser tests E-01 to E-10 moved to the new tree.

After M14.

### M16: Coordinate systems and browser geometry

**Goal:** local coordinate systems for loads, supports and results, and an instant STEP preview in the browser (ADR-116, ADR-117).

- [ ] M16.1 Cartesian local coordinate systems for load and support directions: spec version bump, UI, deck generator, verification cases and coverage rows. Physics-critical.
- [ ] M16.2 Result components in a local Cartesian or cylindrical system, with a thick-cylinder verification case. Physics-critical.
- [ ] M16.3 STEP preview in the browser (occt-import-js, pinned, in a web worker) with checks before upload; the server import stays the face authority and meshing stays on the server.
- [ ] M16.4 Spike, report only: does the browser's face numbering match Gmsh's on every test model?

M16.1 then M16.2; M16.3 and M16.4 beside them.

### M17: Results ribbon, polish and relaunch

**Goal:** a full results ribbon with animation, a consistent visual design, and the colleagues invited back (ADR-118, ADR-119).

- [ ] M17.1 Ribbon layout, legend control (fixed range, bands, colour map), statistics panel.
- [ ] M17.2 Animation of the deformed shape and of modes; screenshot and video capture.
- [ ] M17.3 Iso-surface and threshold filter.
- [ ] M17.4 Design pass: tokens, icons, empty states, loading skeletons, toasts; screenshots for review.
- [ ] M17.5 Relaunch: user and admin guides updated, colleagues invited back.

**Verification added across M11 to M17:** M16 adds cases for local coordinate systems; the rest changes no physics. Every milestone closes on a green phase-end run on main.

## After Phase 0

Not planned in detail yet. In order: shells, face splitting, stress linearisation, run comparison, geometry revisions, nonlinear milestone. Deployment to Cloudflare, machine launch on AWS and real authentication moved into M10 for the closed beta (ADR-095). The public beta (more users, guided overlay, email notifications, recruitment, real payments) is planned after M10.

## Working method

- One task is one branch and one pull request where practical.
- A task is complete when its code is merged, its tests exist, and `PROGRESS.md` is updated.
- If a task turns out much larger than expected, stop, split it in this file, and note why in `PROGRESS.md`.
- Milestones close only after a full verification run and a full end-to-end run are green.
