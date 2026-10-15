# Decisions

Product decisions for ClearFEA, from the interview of 2026-10-13, followed by a log of architecture decision records (ADRs). This file is the source of truth for scope. Change it only through a pull request that explains why.

## Purpose and users

- ClearFEA is an online FEA platform in the style of SimScale, with published compute-based pricing. It is a community project that aims to break even.
- It is a fresh project, separate from the earlier Code_Aster platform idea.
- **Primary user:** working engineers without a licence (freelancers, small-firm and EPC engineers). They know FEA basics and need a trustworthy result and a report.
- **Acceptance test:** the maintainer can run his own static-equipment work on it.
- **Name:** ClearFEA. Domain, GitHub organisation and trademark checks are still open.

## Scope at the Phase 0 gate

| Area | Decision |
| --- | --- |
| Analyses | Linear static, modal, steady-state thermal, thermal stress (thermal result applied to a static run) |
| Elements | Solids only: second-order tetrahedra by default, first-order selectable |
| Geometry input | STEP only. Units read from the file and confirmed by the user. No editing |
| Assemblies | Multi-body. Each body meshed separately; touching faces auto-detected and tied. User reviews and can remove bonds. One material per body |
| Structural loads and supports | Fixed support, prescribed displacement, frictionless/symmetry support, elastic (spring) support, force, pressure, remote force and moment, hydrostatic pressure, gravity, centrifugal load, uniform temperature change |
| Thermal loads | Fixed temperature, heat flux, convection, radiation to ambient, internal heat generation |
| Meshing | Global size or fineness slider, local size on faces, edges or bodies, element order. Meshing is a separate visible step with element count and quality summary |
| Estimate | Size, memory, time and cost estimate before every run |
| Materials | 20 to 30 generic library materials with sources shown, custom user materials reusable across projects, temperature-dependent property tables, yield strength for the safety-factor plot |
| Units | Per-field unit choice with a project default. One internal consistent system. Display units switchable without rerunning |
| Results | Displacement, von Mises, principal stresses and components, strain, temperature, heat flux, deformed shape, mode animation, min/max, probes, cut planes, hide/show bodies, safety factor against yield, reaction forces and moments with a balance check, CSV and VTK export |
| Report | PDF and Word. Sections: project and revision, geometry and units, materials, mesh statistics, each load and support with a picture, solver settings and versions, result plots, reaction check, min/max tables, run warnings. User selects sections and saved views; title block, company name, logo |
| Solver input | Generated input file, solver log, solver version and mesh are viewable and downloadable. Not editable |
| Interface | SimScale-style workbench: simulation tree, central 3D viewer, settings panel. Status mark per tree item. Run disabled with a plain list of what is missing |
| Model size | Design target about 2 million second-order tetrahedra. Laptop tier about 300,000 to 500,000 with the direct solver. Viewer shows outer surface and cut planes, never the full volume mesh |

## Platform decisions

- **Prototype shape.** Cloud-shaped and run locally: web frontend, an API written for Cloudflare Workers (run in its local emulator with local D1 and R2), and a separate containerised job worker. The same container runs on AWS in Phase 1.
- **Where compute runs.** STEP import and meshing run on the server in the worker container. Import is free. Meshing is metered at the same rate as solving.
- **Data structure.** Project → simulations → runs. A run is a frozen snapshot of setup, mesh, solver input, log, results and cost. Meshes are reused across runs when mesh settings are unchanged.
- **Accounts in Phase 0.** Every record has an owner. Simple local login with two or three seeded test users. No email, no password reset.
- **Running jobs.** Stage, elapsed time, running cost against estimate, live solver log, cancel button, automatic stop limit per run (a multiple of the estimate, user adjustable). Jobs continue when the browser is closed.
- **Privacy.** Private by default. Read-only share link per run, revocable. Opt-in public gallery. Uploaded geometry is used only to run the user's jobs. Operator access only for support the user requested.
- **Self-hosting.** First-class and documented, using the same one-command setup. Wallet and metering off or informational. Community-only support.
- **Positioning.** A general-purpose analysis tool. Reports carry software and solver versions and a link to verification results. The platform never prints a pass/fail or code-compliance verdict.

## Pricing decisions

- **Unit of charge.** Machine-seconds on a short published list of machine sizes, each with a published hourly rate. Billed per second while the job occupies the machine. Queue waiting and machine start-up are not billed.
- **Mark-up.** Internal, not published. Rates are set from beta cost data to cross break-even.
- **Size recommendation.** The platform recommends a machine size from the mesh estimate. The user may override it.
- **Failed runs.** The user pays for time used when the cause is their setup or choice (under-constrained model, mesh failure on their geometry, out of memory on a size they chose against the recommendation, cancellation). The platform absorbs its own faults (machine lost, internal error, storage or queue failure, out of memory on a size it recommended). Each failed run shows its category and reason.
- **Pre-run checks.** Free validation before any machine is used: model restrained, every body has a material, loads reference existing faces.
- **Storage.** Free allowance per user. Lightweight items (geometry, setup, solver input, logs, report, viewer data) kept permanently. Raw solver output removed after a fixed period unless the run is pinned; it can be regenerated by rerunning. Storage above the allowance charged at a published rate.
- **Phase 0 wallet.** Real metering and a real ledger with play-money balances. No payment provider.
- **Beta.** Free, with a per-user monthly credit grant and a global budget cap that stops new runs when reached.
- **Beta compute.** One fresh on-demand machine per job, destroyed afterwards. Designed so that a cheaper spot tier can be added.

## Process decisions

- **Licence.** AGPL v3.
- **Contributions.** Developer Certificate of Origin sign-off on every commit. No contributor licence agreement.
- **Repository.** Public from the first commit. Decisions and roadmap live in the repository.
- **Workflow.** All work on branches, merged through pull requests.
- **Test tiers.** Pull requests run unit and snapshot tests, type checks and lint. Physics verification and browser tests run nightly and at milestones.
- **Verification.** Automated benchmark suite through the full platform path, with results and errors published. Every load and support type has at least one case.
- **Build order.** Thin end-to-end slice first, then widening milestones (see `PLAN.md`).
- **Acceptance cases.** (A) Nozzle-to-shell junction with reinforcing pad under pressure and nozzle loads. (B) Thermal stress in a component with a through-wall temperature gradient. Run at the end of Phase 0. Checked against hand calculations and an independent FreeCAD FEM setup.
- **Beta.** Invite-only, 10 to 20 engineers, 8 to 12 weeks, with stated goals.

## Phase 0 is done when

1. Both acceptance cases are completed entirely through the UI on the laptop (i5 10th gen class, 16 GB RAM), with reactions balanced, results within tolerance of hand checks and the FreeCAD run, and a report fit to hand to a reviewer.
2. The full verification suite is green, with every gate load and support type covered.
3. Cost estimates are within the agreed margin of measured cost on the benchmark set, and the wallet ledger reconciles exactly.
4. The 2-million-element target is demonstrated in the development environment, and the laptop tier on the laptop, with a responsive viewer.
5. A fresh clone starts the whole system with one documented command.
6. Data isolation between test users is proven by automated tests.
7. A short user guide covers the main flow.
8. Two or three outside engineers complete a provided tutorial case unaided.

Working tolerances, to be tuned from benchmark data: results within 5 percent of the FreeCAD run on a matching mesh; cost estimates within 30 percent of measured cost.

## After the gate

In order:

1. Shells from surface bodies with user-assigned thickness
2. Face splitting
3. Stress linearisation (membrane, bending, peak) along a path
4. Run comparison table for mesh convergence
5. Geometry revisions that carry loads over to a new STEP version
6. Nonlinear milestone: contact, elastic-plastic materials, large deformation, buckling

Before or during the beta: first-run guided overlay, email notifications, real authentication.

After the beta: team workspaces, user-defined acceptance checks in reports, bring-your-own-input jobs as a separate job type, real payments, spot-priced economy tier.

## Non-goals for Phase 0 and the beta

1. No fluid simulation, electromagnetics or other physics.
2. No nonlinear analysis: contact, plasticity, large deformation, buckling.
3. No transient thermal or dynamic response analysis.
4. No shells, beams or mixed-element models.
5. No geometry creation or editing.
6. No IGES, STL or mesh import.
7. No hexahedral meshing or adaptive refinement.
8. No editing of solver input, and no bring-your-own-input jobs.
9. No built-in code compliance checks or bundled code material data.
10. No team workspaces, real-time collaboration or comments.
11. No real payments, invoices or spot-priced tier.
12. No public API, scripting or CAD plug-ins. The internal API is kept clean so a public one is cheap later.
13. No mobile or tablet layout for setup.
14. No interface languages other than English.
15. No optimisation, parametric studies or fatigue.

## Open items

- Domain, GitHub organisation and trademark checks for the name.
- Confirm Docker runs on the laptop. The Claude Code cloud environment was confirmed in M0.1 (ADR-012).
- Free storage quota, retention period, machine size list and rates: configuration values, set from benchmark and beta data.
- Lawyer review of terms of service before real payments are taken.

---

## Architecture decision records

Add new records at the bottom. Format: number, date, status (proposed, accepted, superseded), decision, reason. Records marked **proposed** were chosen by Claude during kickoff and await the maintainer's confirmation; treat them as the working assumption until changed.

### ADR-001: Monorepo with three deployable parts
2026-10-13 · accepted 2026-10-14

`apps/web` (frontend), `apps/api` (Cloudflare Worker), `worker` (Python container), plus `packages/spec` for shared schemas. One repository keeps the spec, the deck generator and the UI in step.

### ADR-002: Gmsh as both geometry importer and mesher
2026-10-13 · accepted 2026-10-14

Gmsh, through its OpenCASCADE kernel, reads the STEP file, supplies the display tessellation and produces the mesh. One tool owns face identity from import to mesh, which is the riskiest chain in the product. Gmsh is GPL, compatible with AGPL.

### ADR-003: SI base units as the internal system
2026-10-13 · accepted 2026-10-14

All stored and solved quantities are in m, kg, s, K. Gmsh converts STEP geometry to metres at import. One rule with no exceptions is easier to keep correct than a mm-tonne system. Entered values are stored with their unit as typed; conversion uses one shared table.

### ADR-004: Jobs table with a claim API instead of a managed queue
2026-10-13 · accepted 2026-10-14

Jobs live in D1. The worker claims work over HTTPS from the API. This behaves identically on localhost and in the cloud, and avoids depending on local emulation of Cloudflare Queues. A managed queue may still trigger machine launches in Phase 1.

### ADR-005: Worker moves files through transfer URLs issued by the API
2026-10-13 · accepted 2026-10-14

The worker never holds storage credentials. For each job the API issues upload and download URLs. Locally these point at API pass-through endpoints; in the cloud they are presigned R2 URLs, which avoids Worker body-size limits.

### ADR-006: SimulationSpec as a versioned JSON document
2026-10-13 · accepted 2026-10-14

A simulation's setup is one JSON document validated by JSON Schema in `packages/spec`. TypeScript types and Pydantic models are generated from the schema. Runs store a frozen copy.

### ADR-007: React, Vite, TypeScript and three.js for the frontend
2026-10-13 · accepted 2026-10-14

Widely used, well supported by Claude Code, and three.js is sufficient for surface rendering with per-face picking.

### ADR-008: Hono on Cloudflare Workers with D1 and R2
2026-10-13 · accepted 2026-10-14

Matches the deployment target in the brief. Wrangler's local mode provides D1 and R2 on localhost.

### ADR-009: Python for the worker
2026-10-13 · accepted 2026-10-14

Gmsh has a first-class Python API, and Python has mature libraries for numerical work and document generation.

### ADR-010: Start with the distribution CalculiX build; choose the production solver build by benchmark
2026-10-13 · accepted 2026-10-14

Milestone M1 uses a packaged `ccx` (SPOOLES). A benchmark task in M2 compares SPOOLES, PaStiX and the iterative solver for speed and memory, then fixes the build for the 2-million-element target. Building CalculiX with PaStiX is known to be fiddly, so it is isolated as its own task.

### ADR-011: Report figures are captured in the browser
2026-10-13 · accepted 2026-10-14

Report pictures are rendered by the same three.js viewer and uploaded as images when the user generates a report. One renderer keeps reports consistent with what the user saw. The cost is that report generation needs the browser open.

### ADR-012: Docker runs in the cloud environment; the worker stays a container
2026-10-14 · accepted 2026-10-14

M0.1 found that Docker works in the Claude Code cloud environment, so the plain-process fallback is not needed and the worker stays a container as in `ARCHITECTURE.md`. Three conditions apply there. The daemon is not started for us, so a session starts `dockerd` in the background before using Docker. Anonymous pulls from Docker Hub fail with HTTP 429, so base images are named through the public `mirror.gcr.io/library/` mirror, which serves the same official images and needs no account, so it works on the laptop too. HTTPS traffic leaves through a proxy with its own certificate authority, so a build that downloads over HTTPS (pip) reads that certificate from an optional BuildKit secret (`--secret id=extra_ca`) at build time; the certificate is never copied into an image layer or the repository, and builds without the secret work unchanged on the laptop.

### ADR-013: Python tooling lives in `worker/`; versions pinned per workspace
2026-10-14 · accepted 2026-10-14

The `uv` project is `worker/pyproject.toml` with its own `uv.lock`, not a uv workspace at the repository root, because the worker is the only Python package. Python is pinned to 3.12 there (`.python-version`, `requires-python`), and dev tools (pytest, ruff) are pinned to exact versions. TypeScript packages are a pnpm workspace (`apps/*`, `packages/*`) with pnpm pinned through `packageManager`. If verification scripts later need their own Python package, the root becomes a uv workspace with `worker` as a member.

### ADR-014: API tests run inside the Workers runtime against local D1 and R2
2026-10-14 · accepted 2026-10-14

API tests use Vitest with `@cloudflare/vitest-plugin` (the renamed `@cloudflare/vitest-pool-workers`), which runs each test file in the same `workerd` runtime and with the same D1 and R2 emulation as `wrangler dev`, configured from `apps/api/wrangler.jsonc`. Migrations from `apps/api/migrations` are applied before each test file, and storage is isolated per test, so tests need no running server and no mocks of D1 or R2. The alternative, mocking the bindings in Node, is simpler to set up but would not catch SQL or binding behaviour that differs from the real runtime. TypeScript dependencies are pinned to exact versions, and the plugin, `wrangler` and `@cloudflare/workers-types` are chosen so they share one `workerd` build. pnpm's default supply-chain policy refuses packages published in the last day, so new versions are taken only after that delay rather than by adding exclusions.

### ADR-015: Worker image on Ubuntu 24.04 with CalculiX 2.21 and Gmsh 4.15.2
2026-10-14 · accepted 2026-10-14

The worker image is built on `ubuntu:24.04`, pinned by digest and pulled through `mirror.gcr.io` (ADR-012). Its system Python is 3.12, matching ADR-013. CalculiX is the distribution package `calculix-ccx=2.21-1` from the noble release pocket, which does not change after release, so the pin stays installable. Gmsh is the PyPI wheel `gmsh==4.15.2`, recorded in `worker/uv.lock` so the host and the image install the same file; the wheel bundles its own OpenCASCADE. M0.1 probed `python:3.12-slim-bookworm`, but Debian bookworm ships CalculiX 2.20 and Debian trixie has no `calculix-ccx` package at all, while the Claude Code cloud host is Ubuntu 24.04 with 2.21. Choosing the same base as the host means a case run locally in a session and in the container uses the same solver build. Cost: the image is about 990 MB, mostly LLVM and GPU libraries pulled in by Mesa (for Gmsh's `libGLU` dependency) and by Open MPI (a `calculix-ccx` dependency), against about 490 MB for the bookworm probe. Image size is a gate target (M9), not an M0 one.

### ADR-016: Worker authenticates with a shared token; on Linux it uses host networking locally
2026-10-14 · accepted 2026-10-14

The `/internal` routes accept a bearer token compared against the API's `WORKER_TOKEN` secret (`apps/api/.dev.vars` locally, a Workers secret in the cloud); the worker sends it from `CLEARFEA_WORKER_TOKEN`. One shared token is the simplest thing that keeps user sessions and worker access apart; per-machine tokens can replace it in Phase 1 when machines are launched per job. Worker data-access functions are scoped to the claiming worker's id rather than a user id, because the worker serves every owner; they can only touch jobs that worker has claimed. Locally, `wrangler dev` listens on loopback only. Docker Desktop forwards `host.docker.internal` to the host's loopback, but Docker Engine on Linux does not, so `infra/docker-compose.linux.yml` puts the worker on the host network instead of exposing the API on every interface.


### ADR-017: Schema code generation and runtime validation in `packages/spec`
2026-10-14 · accepted 2026-10-14

Schemas are JSON Schema draft 2020-12, one file per area, with the messages of an area under `$defs`. TypeScript types come from `json-schema-to-typescript`; a small script adds a typed `validateX` function for every schema and definition and a `XValues` list for every enum. Runtime validation in TypeScript uses `@cfworker/json-schema`, because it interprets schemas without generating code, which Cloudflare Workers forbid (Ajv compiles validators with `new Function` unless its validators are pre-built in a separate step). Pydantic v2 models for the worker come from `datamodel-code-generator`, with snake_case fields aliased to the camelCase wire names. Generated files are committed rather than built on install, so the worker image and the apps need no generation step, and `make test` regenerates both into a scratch location and fails if the committed files differ (`make spec` rewrites them). The alternative of generating at build time keeps generated code out of review but adds a build step to every consumer, including the Docker image.

### ADR-018: Units table format
2026-10-14 · accepted 2026-10-14

`packages/spec/units.json` maps each quantity kind to its SI unit and to the allowed units, each with a `factor`, an optional `offset` (value in SI = value × factor + offset) and a `definition` naming where the factor comes from, so a reviewer can check every number. The table is versioned. Unit symbols are case-sensitive keys (`MPa`, not `mpa`). Both loaders refuse a table whose SI unit is not listed with factor 1 and no offset. Factors that are not exact in binary (psi, ksi) are written as the double nearest the exact value. M0.6 defines length (m, cm, mm, in, ft), force (N, kN, MN, lbf, kip) and pressure (Pa, kPa, MPa, GPa, bar, psi, ksi); later kinds are added with the feature that needs them. A shared fixture of hand-worked conversions is run in both languages in both directions with a relative tolerance of 1e-12.

### ADR-019: Biome is the one TypeScript lint tool
2026-10-14 · accepted 2026-10-14

All TypeScript and JavaScript in `apps/` and `packages/` is linted by Biome (`@biomejs/biome`, pinned) with its recommended rules, from one `biome.json` at the root; `make lint` and `make test` run it with warnings treated as errors. Generated code in `packages/spec/src/generated` is excluded. Biome is one dependency and one config file and needs no plugins for TypeScript or React. The alternative, ESLint with typescript-eslint and the React plugins, has more rules (including type-aware ones) but needs several packages kept in step and a slower run. Formatting is not enforced for now: turning on Biome's formatter would rewrite most existing files, so it is a separate decision. If a rule Biome lacks is needed later, ESLint can be added for that rule alone.

### ADR-020: `make dev` is a shell script that supervises three processes
2026-10-14 · accepted 2026-10-14

`make dev` runs `infra/dev.sh`, which starts `wrangler dev` and Vite on the host and the worker through Docker Compose, prefixes each line of output with the service name, and stops all three when any one exits or on Ctrl-C. It checks first that dependencies are installed, Docker is reachable and ports 8787 and 5173 are free, and says what to do if not. It creates `apps/api/.dev.vars` from the example when missing and passes its `WORKER_TOKEN` to the worker, so the two cannot disagree (ADR-016). On Linux without Docker Desktop it adds the host-networking override. A plain Bash script needs no new dependency; the alternatives were an npm process runner such as `concurrently` (one more package and it does not manage the Compose service) or running the API and web app in Compose too (slower reloads, and `wrangler dev` state would live in a container).

### ADR-021: CI runs `make test` on GitHub Actions with pinned actions; the DCO App checks sign-offs
2026-10-14 · accepted 2026-10-14

`.github/workflows/fast.yml` runs on every pull request: one job runs `make install` and `make test` on `ubuntu-24.04`, so CI and a contributor's machine run the same commands and there is no second list of checks to keep in step. Every third-party action is pinned to a full commit SHA with the version in a comment, because a tag can be moved to different code, and the workflow token is read-only. Node 22, pnpm (from `packageManager`), uv 0.11.32 and Python 3.12 match the cloud session. DCO sign-off is checked by the DCO GitHub App, which is already installed on the repository; an in-repo script doing the same check was written and then dropped at the maintainer's choice so each pull request has one sign-off check. `.github/workflows/nightly.yml` is a scheduled placeholder that does nothing until `make verify` (M1.13) and `make e2e` (M1.14) exist.

### ADR-022: Phase 0 login is a seeded password table and a stateless signed cookie
2026-10-14 · accepted 2026-10-14

Two test users, `alice` and `bob`, are seeded into the local D1 from `apps/api/seed/test-users.sql` by `pnpm --filter @clearfea/api db:seed`, which `pnpm --filter @clearfea/api dev` (and so `make dev`) runs after the migrations. The seed is not a migration, so it can never reach a cloud database. Their passwords (`alice-local`, `bob-local`) are documented in the seed file: they protect nothing but local test data. Migration 0003 adds `users.password_hash`, PBKDF2-SHA256 with 100 000 iterations and a random salt through Web Crypto, because Workers have no bcrypt or scrypt and cap PBKDF2 at 100 000 iterations. `POST /api/session` checks the password and sets an `HttpOnly`, `SameSite=Lax` cookie holding the user id and an expiry seven days out, signed with HMAC-SHA256 under `SESSION_SECRET` from `apps/api/.dev.vars`; `Secure` is added when the API is reached over HTTPS. The cookie is stateless: there is no sessions table, so signing out clears the cookie but cannot revoke a copied one before it expires, which is acceptable for local test users. Every signed-in route goes through one middleware (`requireUser` in `apps/api/src/session/`), which also checks that the user still exists, and puts the user id in the request context; routes never read the cookie, so real authentication replaces that module in Phase 1 without touching them. Public request bodies must be sent as `application/json`, which a cross-site HTML form cannot do without a preflight the API never grants. A wrong password and an unknown login get the same answer and take the same time. The alternatives were a user picker with no password (simpler, but nothing to test the login path against) and a sessions table (revocable, but one more table and a lookup the stateless cookie avoids).

### ADR-023: Face identity chain confirmed; the import job reads the STEP length unit itself
2026-10-14 · accepted 2026-10-14

The M1.1 spike (`worker/spikes/face_identity/`) ran the chain in `ARCHITECTURE.md` section 3 on a block, a flanged pipe with filleted joints and bolt holes, and a filleted L bracket with holes, each declared in mm, m and in, with every step in its own process. Gmsh 4.15.2, OpenCASCADE 7.8, one thread. Results and the method are in the spike's README. Findings, and what M1.2 and M1.6 should build on them:

1. **Gmsh does not report the file's length unit.** It converts coordinates to `Geometry.OCCTargetUnit` correctly, but neither the API nor its log names the unit the file declared. The import job therefore reads it from the STEP data section: the length unit referenced by `GLOBAL_UNIT_ASSIGNED_CONTEXT`, either `SI_UNIT` on `METRE` (no prefix, `CENTI`, `MILLI`) or a `CONVERSION_BASED_UNIT` named `INCH` or `FOOT`. Only the unit's symbol is taken from the file and factors come from `units.json`; a conversion-based unit's own factor is cross-checked against the table and refused if they differ. No declared unit, several different ones, or an unsupported one (for example micrometres) gives no detected unit, and the user must choose one before the geometry can be used. Nothing is guessed.
2. **Import with `Geometry.OCCTargetUnit = "M"`.** Gmsh's default is OpenCASCADE's millimetres, so ADR-003's "Gmsh converts STEP geometry to metres" holds only with this option set. With it, the m and in variants matched the mm model scaled by the `units.json` factor to 1e-15.
3. **A unit the user corrects is applied by re-importing with `Geometry.OCCScaling`**, the ratio of the confirmed to the declared factor, not by scaling after import. `occ.dilate` turns every face into a B-spline approximation: face types change and areas move by up to 0.3 percent. Re-importing with `OCCScaling` keeps tags, types, areas and centroids to 1e-15. The geometry record stores the declared unit, the confirmed unit and the scaling, and every later job imports with the same options.
4. **Face tags are stable across processes.** Re-importing the same file in a fresh process gave the same tags with identical areas, centroids, types and parent bodies (difference 0), so the mesh job's comparison with `topology.json` can use a tight tolerance (1e-9 of the model size).
5. **Face-to-element mapping is a lookup.** Gmsh's surface triangles share nodes with the tetrahedra, so each surface triangle matches the boundary tetrahedron face with the same corner nodes. For first- and second-order meshes of all nine inputs, every surface triangle found its tetrahedron face, every boundary tetrahedron face had a face tag, and every mapped face lay on its own CAD face and closer to it than to any other face.
6. **The display mesh is a separate, curvature-sized surface mesh** of the same import, stored as float32 positions with triangles grouped by face tag. Read back, every triangle lay on its own face.

Not covered, for later tasks: CalculiX's face numbering of C3D4 and C3D10 elements (the spike records Gmsh's local face index; M1.7 maps it and checks it against the CalculiX manual), multiple bodies and the tag renumbering that `fragment` causes (M4), and STEP files exported by commercial CAD systems (the test files were written by OpenCASCADE with the unit entity edited). Meshing was run single-threaded; the same input gave the same element count in separate processes and repeated runs, but the same shape declared in different units gave slightly different meshes (842 to 864 tetrahedra for the block), so a mesh is reproducible only for the same imported geometry. The spike uses numpy through `uv run --with`; adding it as a worker dependency is left to the task that first needs it in job code.

### ADR-024: The import job applies the STEP unit through OpenCASCADE's reading factor; jobs move files through per-job transfer routes
2026-10-14 · Accepted (auto-approved under Shubham's standing M1 instruction, pending his later review)

M1.2 turns ADR-023 into the `import` job, the geometry routes and the upload panel. Decisions it needed:

1. **Reading factor.** To apply a unit the user chooses, the job must know how OpenCASCADE scaled the file when it read it as it is. Experiments with Gmsh 4.15.2 and OpenCASCADE 7.8.1: a file that declares no length unit is read as if its coordinates were already in the target unit (100 in the file became 100 m with `OCCTargetUnit = "M"` and 100 mm with `"MM"`), and a conversion-based unit is applied with the file's own factor even when its name is unknown or its factor disagrees with `units.json` (a unit named `WIDGET` defined as 25 mm was read as 25 mm). The import job records this reading factor (metres per file coordinate) and applies a chosen unit by re-importing with `Geometry.OCCScaling` = the chosen unit's factor from `units.json` ÷ the reading factor. So the user can choose the unit for a file with no unit, an unknown named unit or a disagreeing inch, as ADR-023 asks. Two cases have no known reading factor and fail as the user's fault, asking for a re-export in a supported unit: an SI prefix the units table does not list (for example micrometres, which OpenCASCADE applies but for which ClearFEA has no factor without hard-coding one), and a file declaring several different length units. This narrows ADR-023 point 1, which let the user choose in every case. `worker/tests/test_geometry_import.py` pins the no-unit behaviour, so a Gmsh or OpenCASCADE upgrade that changes it fails the fast tier.
2. **Geometry life cycle.** `importing` → `needs_unit` (no detected unit) or `unconfirmed` (detected) → `ready` once the user confirms; `failed` with a plain-language problem. Confirming the unit the topology was made at needs no job; any other unit queues a re-import, and only the geometry's latest import job may update it, so a late answer from an older job is ignored. Until simulations reference faces (M1.4), the unit of a ready geometry can still be changed; M1.4 or M1.5 must lock it once a simulation uses the geometry. Projects have no routes yet, so a geometry's `project_id` is null for now and the web app shows the user's most recent geometry.
3. **Upload.** `POST /api/geometries?name=…` takes the file as the raw body with `Content-Type: application/octet-stream`, which a cross-site HTML form cannot send without a preflight the API never grants (the same protection as ADR-022's JSON rule). The alternative, a multipart form, would need a CSRF token. Files are limited to 100 MB, the Workers request-body limit; larger files will need direct-to-storage upload in Phase 1. The API checks only that the body starts with `ISO-10303-21`; everything else is the worker's job.
4. **Transfers (ADR-005 in practice).** A claimed job now carries `params` and `transfers` (`name`, `direction`, `url`). In Phase 0 the URLs point at `GET`/`PUT /internal/jobs/:id/files/:name?worker=<id>`, which need the worker token, accept only the worker holding the job, and only the names its type defines (`apps/api/src/jobs/files.ts`). The worker sends its token only to the API's own `/internal/` URLs, so presigned storage URLs can replace these in Phase 1 without a worker change. Files are stored under `owners/<owner>/geometries/<id>/` as `model.step`, `topology.json` and `display.bin`. A succeeded import whose result does not match `ImportResult` or whose outputs are missing is recorded as a platform fault, so a geometry never becomes ready on outputs the viewer cannot read. Failed jobs may carry a `failureMessage` for the user next to the cause code.
5. **Display mesh format.** Version 1 is `packages/spec/display-mesh.md`. Unlike the spike's file, each face owns its run of vertices, so the viewer can shade a face smoothly and keep a sharp edge between faces.
6. **Gmsh in CI.** The fast tier now installs the system libraries the Gmsh wheel loads (the same list as `worker/Dockerfile`), because the import tests run Gmsh; Shubham approved this CI change in the M1.2 thread.
7. **Units table in the worker image.** The image copies `packages/spec/units.json` from a named build context (`--build-context spec=packages/spec`, `additional_contexts` in Compose), so the build context stays `worker/` and the table stays single.

Not done here: a heartbeat timeout that fails a job whose worker died (an import whose worker crashes leaves its geometry `importing`), and running Gmsh in a child process so a crash on a malformed file cannot take the worker down. Both are worth doing before files from outside the project are imported.

### ADR-025: The viewer draws the display mesh as one three.js mesh coloured per face; a click toggles a face in the selection
2026-10-15 · Accepted (auto-approved under Shubham's standing M1 instruction, pending his later review)

M1.3 adds the viewer (`apps/web/src/layout/Viewer.tsx`, `apps/web/src/viewer/`). Choices it needed:

1. **three.js 0.186.1 with its own `OrbitControls`**, no React wrapper (react-three-fiber would be a second way to describe the scene for one canvas). `ModelView` owns the scene and is driven from React by `setMesh`, `setSelection` and two callbacks, `onHover` and `onPick`; the selection itself is React state in `App`, so M1.5's settings panels can read and set it. Renders happen on demand (a camera change, a colour change, a resize), not in a loop.
2. **One mesh for the whole model, coloured per vertex.** ARCHITECTURE section 9 says "one pickable group per face"; because each face owns its run of vertices and triangles in `display.bin` (ADR-024 point 5), a single `BufferGeometry` gives the same picking with one draw call. A ray hit's triangle index resolves to its face tag by binary search over the faces' triangle ranges, and hover or selection repaints only that face's vertex colours. Face outlines are the triangle edges that only one triangle of their face uses, drawn as line segments over the faces.
3. **Interaction.** Left-drag orbits, right-drag pans, the wheel zooms (OrbitControls' defaults). A press released within 4 px is a click: clicking a face adds it to the selection and clicking it again removes it; clicking empty space does nothing, so a missed click never loses a selection; Escape or the Clear button empties it. "Reset view" frames the model from an isometric direction, with camera near and far planes taken from the model's bounding sphere, since positions are metres and models range from millimetres to metres. The hover line names the face tag and its surface type from `topology.json`; areas wait for M2.1's area units.
4. **The reader checks the file.** `parseDisplayMesh` refuses an unknown version (asking the user to reload) and any file whose sizes, face order, triangle ranges or vertex indices are inconsistent (asking for a re-upload), rather than drawing garbage. `packages/spec/fixtures/display-two-faces.bin` is written byte for byte by the worker's writer (checked in `worker/tests/test_display.py`) and read by the TypeScript reader's tests, so the two sides cannot drift apart. The web app's tests read it through Node's `fs`, which needs `@types/node`; only `apps/web/test/fixtures.ts` references those types.
5. **No WebGL in the tests.** jsdom has none, so component tests replace `ModelView` with a recording stand-in and drive hover and pick through its callbacks; the three.js code itself was checked with `make dev` and headless Chromium (SwiftShader) on the M1.1 bracket and flanged pipe. A browser that cannot create a WebGL context gets a plain message saying to turn on hardware acceleration.

### ADR-026: SimulationSpec v1 is a draft-friendly document with inline materials; a used geometry's unit is locked
2026-10-15 · Accepted (auto-approved under Shubham's standing M1 instruction, pending his later review)

M1.4 defines `SimulationSpec` version 1 (`packages/spec/schemas/simulation.schema.json`) and the routes that store it. Choices it needed:

1. **Shape.** `{ version: 1, analysis: "linear_static", geometryId, bodies, materials, supports, loads, mesh }`. `bodies` lists every body of the geometry once with the id of its material (ARCHITECTURE section 4's "per-body material assignment"). Materials (`isotropic_elastic`: Young's modulus, Poisson's ratio), supports (`fixed`) and loads (`pressure`) are arrays of items with a client-chosen `id`, unique across the spec, a `name` and a `type`, so later types join the same arrays (a `oneOf` per array once there are two). `mesh` holds the global `size`. Density, element order and solver options are left out until a task needs them (gravity in M2.3, element order in M2.8); adding a field is a schema change like any other.
2. **Quantities** are `{ value, unit }` as typed (ARCHITECTURE section 4). The schema cannot list the units of a kind without copying `units.json`, so it only requires a unit string; `checkSimulationSpec` in `packages/spec/src/simulation.ts` refuses a unit that is not of the field's kind (Young's modulus and pressure: pressure; mesh size: length), using the one table. Poisson's ratio is a plain number in (-1, 0.5), which the schema checks.
3. **Draft-friendly.** Every value may be `null` and every face list empty, so the M1.5 panels can save each edit and the tree can mark items incomplete. Saving refuses only what is wrong, not what is missing: a malformed document, a unit of the wrong kind, a zero or negative modulus or mesh size, a repeated id, a body assigned a material that is not listed, a body or face tag the geometry does not have, or a geometry body missing from `bodies`. What a run still needs is pre-run validation (M1.12).
4. **Pressure sign.** A positive pressure pushes on the face towards the body, as a fluid does; negative is suction. The deck generator (M1.7) must map this to CalculiX's convention and a verification case must prove it.
5. **Materials are copied into the spec**, not referenced, so a run's frozen spec (ADR-006) never changes when a library or custom material does (M2.9 copies from the library into the spec).
6. **Storage and routes.** Migration 0005 adds `simulations` (owner, geometry, name, `analysis_type`, `spec_version`, the spec as JSON). `POST /api/simulations { geometryId, name, spec? }` needs a `ready` geometry and starts from an empty spec listing the geometry's bodies when `spec` is left out (the verification harness, M1.13, can pass a whole spec). `GET /api/simulations[?geometryId=]`, `GET /api/simulations/:id` and `PUT /api/simulations/:id/spec` (whole-document replace, last write wins) complete the set; a spec cannot move to another geometry. Each save reads the geometry's `topology.json` to check tags.
7. **Unit lock.** Once a simulation uses a geometry its unit can no longer change, since a re-import at another scale would move every face the spec refers to: `POST /api/geometries/:id/unit` answers 409 for any other unit, `GeometryView.unitLocked` tells the web app to hide the unit control, and the database refuses to delete a geometry a simulation uses. This settles the open point in ADR-024 item 2. The unit can still be changed until the first simulation is created; the insert and the unit change each check the other in their own statement.

Not done here: a Python counterpart of `checkSimulationSpec` (the Pydantic model checks the shape; the deck generator, M1.7, converts units through `units.py`, which refuses a unit of the wrong kind, and should also refuse repeated faces, which Pydantic does not check), optimistic concurrency on saves, renaming and deleting simulations, and projects.

### ADR-027: The setup tree marks each item from the spec; panels save the whole spec shortly after each edit
2026-10-15 · Accepted (auto-approved under Shubham's standing M1 instruction, pending his later review)

M1.5 adds the simulation tree and the settings panels for a material, a fixed support and a pressure (`apps/web/src/layout/SimulationTree.tsx`, `apps/web/src/setup/`). Choices it needed:

1. **Tree.** Geometry, then Materials, Supports and Loads with their items; mesh and runs join when M1.6 and M1.8 give them something to show. Each row has a mark: complete (filled dot), incomplete (ring) or error (red dot), and its reasons as the row's tooltip and at the top of its panel. Error marks come from `simulationSpecProblems` in `packages/spec/src/simulation.ts`, the same checks as `checkSimulationSpec` with the item each problem belongs to, so the API and the tree cannot disagree. Incomplete means a value is null or a face list empty, or a group is empty, or a body has no material. The plain list beside the Run button stays M1.12's.
2. **Starting a setup is a button.** A ready geometry shows "Start setup", which creates the simulation and so locks the geometry's unit (ADR-026 item 7); the panel says so before the click. The web app opens the geometry's newest simulation; choosing between several, and renaming, come with projects.
3. **Saving.** The spec lives in React state only between an edit and its save: each edit replaces the spec, and the whole spec is saved with `PUT /api/simulations/:id/spec` 400 ms after the last edit, one save at a time, in order. The browser checks the spec against the schema and `checkSimulationSpec` first and does not send one the API would refuse; the tree's last line says "All changes saved", "Saving…" or "Not saved:" with the reason. An edit made less than 400 ms before the geometry changes or the tab closes can be lost; a flush on page hide is left for later.
4. **Fields hold what is typed.** A number field reports a value only when its text is a number in range, so a half-typed `1e` or a Poisson's ratio of 0.7 stays in the field with a plain message and never reaches the spec. Young's modulus must be greater than zero. Quantities are stored as typed (`{ value, unit }`); the quantity field is a stand-in for M2.1's shared component and offers GPa for a modulus and MPa for a pressure until M2.1 brings the project's default unit system.
5. **Faces come from the viewer's selection.** A new support or pressure takes the faces selected in the viewer; opening an item shows its faces as the viewer's selection; "Use the selected faces" replaces an item's faces with the selection. The first material is assigned to every body that has none, which covers the one-body case of M1.
6. **Ids** are `material-<n>`, `fixed-<n>` and `pressure-<n>` with the smallest free `n`; names start as "Material 1", "Fixed support 1", "Pressure 1" and can be edited. Deleting a material leaves its bodies without one.


### ADR-028: The mesh job meshes the confirmed geometry with second-order tetrahedra of one global size and writes its own mesh file
2026-10-15 · Accepted (auto-approved under Shubham's standing M1 instruction, pending his later review)

M1.6 adds the `mesh` job (`worker/clearfea_worker/meshing/`), the `meshes` table and routes, and the Mesh item of the setup tree. Choices it needed:

1. **Second-order tetrahedra only, for now.** Every Phase 0 mesh is 10-node tetrahedra (`ElementOrder` 2, CalculiX C3D10) until M2.8 offers the choice; first-order tetrahedra are too stiff for stress results. Mid-edge nodes lie on the curved CAD faces (`Mesh.SecondOrderLinear = 0`). The order travels in the job parameters and the mesh file, so M2.8 adds a field, not a format.
2. **One global size.** `Mesh.MeshSizeMax` is the size the user entered; sizes from CAD points and from curvature are off, so the size field means what it says (local sizes are M2.8). Gmsh runs single-threaded, as in the import (ADR-023). The size is stored and sent as typed (`{ value, unit }`) and converted to metres by the worker through `units.py`.
3. **Face identity is checked before meshing.** The job re-imports `model.step` with the geometry's `scaling` and compares every face's area, centroid, Gmsh type and parent bodies, and each body's faces, with `topology.json` at a relative tolerance of 1e-9 (ADR-023 item 4). Any difference fails the job as a platform fault (`topology_mismatch`), per ARCHITECTURE section 3.
4. **Own mesh file.** `mesh.bin` (`packages/spec/volume-mesh.md`) holds float64 node positions, the elements by body in Gmsh's node order, and for each face tag its element faces as (element, local face) pairs, found by matching each surface triangle's corner nodes to a tetrahedron face (ADR-023 item 5). The deck generator (M1.7) reads it without Gmsh and maps Gmsh's node order and local faces to CalculiX's. The viewer gets a separate `display.bin` of the mesh's surface in the display mesh format (corner nodes only), so the existing reader, picking and face colouring work unchanged.
5. **Guards.** A size whose estimate (6 × volume ÷ size³, on the high side of the 4.5 measured) exceeds 2,000,000 elements, the design target in DECISIONS, is refused before meshing as the user's fault, with the smallest size that passes, rounded up. Elements with a zero or negative scaled Jacobian, and a Gmsh failure, are also the user's fault, with a request to try a smaller size. No quality summary yet (M2.8).
6. **Records.** A mesh row holds the geometry, the size as typed, the order, status (`meshing`, `ready`, `failed`), counts and its job; files are `owners/<owner>/meshes/<id>/`. `simulations.mesh_id` points at the simulation's latest mesh. `POST /api/simulations/:id/mesh` meshes with the size of the saved spec (the panel's button waits for "All changes saved") and is refused while that simulation's mesh is still being made; every request makes a new mesh until reuse by settings hash (M2.10). Mesh shapes live in `simulation.schema.json`, because the code generators do not resolve references between schema files and the shapes need `Quantity`.
7. **Showing it.** The tree gains a Mesh row: incomplete until a size is entered and a mesh exists for that size, incomplete while meshing, error with the reason when meshing failed. The panel offers the geometry's own unit first. While the Mesh row is open and the latest mesh is ready, the viewer draws the mesh surface with every element edge and "Mesh: N elements, M nodes"; switching between geometry and mesh keeps the camera. Meshing is not metered until M1.11 and cannot be cancelled yet.

### ADR-029: The deck generator writes one deterministic CalculiX deck from the spec and the mesh file
2026-10-15 · Accepted (auto-approved under Shubham's standing M1 instruction, pending his later review)

M1.7 adds the deck generator (`worker/clearfea_worker/deck/`), a pure function `generate_deck(spec, mesh) -> str` from a `SimulationSpec` and a `mesh.bin` (ADR-028). Choices it needed:

1. **Element mapping from the manual, checked by solving.** CalculiX numbers C3D10 mid-edge nodes on edges 1-2, 2-3, 3-1, 1-4, 2-4, 3-4, so Gmsh's last two mid-edge nodes swap (with Gmsh's own order CalculiX stops on a non-positive Jacobian). Gmsh local faces 0, 1, 2, 3 are CalculiX faces 1, 2, 4, 3 (manual section 7.43: 1-2-3, 1-4-2, 2-4-3, 3-4-1). Both tables are derived in `deck/elements.py` from the manual's lists rather than typed in, and tested geometrically.
2. **Pressure sign.** A positive CalculiX pressure pushes against the face's outward normal, which is ADR-026's convention, so the entered value is written unchanged. Shown by solving: positive pressure on each face of a bar gives a reaction of +p·A·n and shortens the bar by p·L/E (`worker/spikes/deck_check/`, 28 checks). That script stands in until V-01 and V-02 run under `make verify` (M1.13).
3. **Deck layout.** All mesh nodes (`NALL`), one element set per body (`B<tag>`), one node set per fixed support (`S<n>`, all corner and mid-edge nodes on its faces), one material per spec material that a body uses (`M<n>`, n its place in the spec), `*SOLID SECTION` per body, one `*STATIC` step with `*BOUNDARY <set>, 1, 3` per support and one `*DLOAD <element>, P<face>, <Pa>` line per loaded element face. Pressures from several loads on the same element face are added into one line, since the analysis is linear and CalculiX's handling of two lines for one face is not something to rely on. Outputs: `U` to the `.frd`, `S` per element to the `.frd`, and the total reaction of each support set to the `.dat`. Comments name each item's id, name and the entered value beside its SI value, so a reader can trace the deck back to the setup. Set names use positions, not ids, because ids may contain characters CalculiX set names should not.
4. **Determinism.** Numbers are written as Python's shortest round-trip text (`repr`), lines in a fixed order, so the same inputs give the same bytes. `DECK_FORMAT = 1` is written into the deck's first line and changes whenever the text for the same inputs does. Snapshot tests (`worker/tests/test_deck.py`, `worker/tests/snapshots/deck/`) cover a hand-made two-element mesh as C3D10 and C3D4 with the shared spec fixture, and a two-body case in US units with overlapping pressures. A missing snapshot is written only with `CLEARFEA_WRITE_SNAPSHOTS=1`; an existing one is never overwritten by the test.
5. **Refusals.** The generator raises `DeckError` with a plain-language message for anything it cannot translate: no supports, a support or load without faces, a face listed twice, a face or body the mesh does not have, a missing value, a unit of the wrong kind, a Young's modulus of zero or less, a body without a material, and mesh nodes outside every element. M1.12's pre-run list should catch these first; the generator still refuses rather than write a deck that does not match the setup.
6. **Solver options left at CalculiX's defaults** (the default direct solver of the build) until the solver benchmark (M2.11) fixes them.


### ADR-030: The solve job runs CalculiX as a supervised child process, streams its console log with the heartbeats, and reads nodal results from the ASCII `.frd`
2026-10-15 · Accepted (auto-approved under Shubham's standing M1 instruction, pending his later review)

M1.8 adds runs, the `solve` job, the solver log and the result reader (`worker/clearfea_worker/results/`, physics-critical). Choices it needed:

1. **Runs freeze their inputs from the start.** Migration 0007 adds `runs` (simulation, mesh, the spec as saved when the run started, status `solving` → `succeeded` or `failed`, plain-language problem, result summary, job) and `job_logs`. `POST /api/simulations/:id/runs` needs the simulation's mesh to be ready and made at the saved spec's size, refuses a second run while one solves, and queues a `solve` job whose parameters (`SolveParams`) carry the frozen spec and the mesh id. The worker writes the deck from those two alone, so editing the simulation never reaches a run. Files go under `owners/<owner>/runs/<id>/`: `deck.inp`, `solver.log`, `results.frd`, `results.dat`; the deck and log are uploaded even when the solver stops, so a failed run can be inspected (shown in M1.10). Versions beyond CalculiX's, machine size and cost come with M1.10 and M1.11. Whether the setup is complete is the deck generator's call (`DeckError` becomes a user fault with its message) until M1.12's pre-run list.
2. **CalculiX runs as a child process.** `solver.run_calculix` starts `ccx -i job` in the job's work folder through `stdbuf -oL` (so its output arrives by line rather than in pipe-buffer blocks), passes each line on, keeps the whole output in `solver.log`, and on a cancel from the API terminates it (killed after 5 s). A solver crash ends only the child. A non-zero exit or any `*ERROR` line is a platform fault (`solver_error`, with the first error line), because the deck is generated, not typed. Checked by experiment: CalculiX 2.21 stops with exit status 201 on an input error, but with SPOOLES it solves a model with no supports without any warning and returns nonsense displacements; nothing in M1 can produce that (every support is a fixed face), but the frictionless supports of M2.2 will need their own check for rigid-body motion.
3. **Log streaming through the heartbeats.** `HeartbeatRequest` gains an optional `log` string (at most 65,536 characters): the text written since the previous heartbeat, appended to `job_logs` as one numbered chunk. The worker sends what is queued with each heartbeat (several posts if it must catch up), puts text back if a post fails, flushes the rest before completing, and stops streaming after 1,000,000 characters with one note, since the full log is uploaded as a file. `GET /api/runs/:id/log?after=n` returns the text after chunk n and the n to ask with next; the Run panel polls it with the run every 2 s while the run solves (ARCHITECTURE section 8: polling, no websockets).
4. **Results from the ASCII `.frd`.** The reader takes the last `DISP` and `STRESS` blocks, finds components by their names in the `-5` lines (skipping the derived `ALL` entry), reads node numbers in the short (5-digit) or long (10-digit) format from the block header, joins `-2` continuation lines, and refuses a binary file, a node outside the mesh, a node with no value or the wrong number of values, and non-finite numbers. Values carry the six significant digits CalculiX writes (`E12.5`), enough for display and for the verification tolerances so far. Stresses are CalculiX's nodal values (extrapolated from the integration points and averaged between elements); von Mises is derived from them. Reaction totals come from the `.dat` lines CalculiX writes for each support set (`S<n>` in spec order, now named in one place, `deck.support_set_names`).
5. **Result summary.** A succeeded run stores a `SolveResult`: node count, the largest displacement magnitude and the smallest and largest von Mises stress, each with its node and position, the total reaction of every support, and the CalculiX version, all in SI. The Run panel shows them in the geometry's length unit, MPa and N (fixed until M2.1), numbers only. Field files for the viewer are M1.9.
6. **Checked with the solver.** `worker/spikes/solve_check/` runs these steps on the M1.7 bar: uniform compression with Poisson's ratio 0 (σxx = −p at every node, other components zero, von Mises p, tip displacement p·L/E, reaction p·A), Poisson's ratio 0.3 (mid-length stress p, largest von Mises at the clamp) and a cantilever under pressure (tip deflection within 1 percent of Timoshenko beam theory; reaction equal to the load less the part on held nodes, as M1.7 found). 10 of 10 checks pass. It stands in until V-01, V-02 and `make verify` (M1.13).

Not done here: a heartbeat-timeout sweep for jobs whose worker died (a run whose worker is lost stays `solving`, and blocks the next run of that simulation), a time limit on the solver, and the solver's thread count and memory limit per machine size (M1.11, M2.11).

### ADR-031: The solve job writes the mesh surface and per-vertex result fields for the viewer, which draws nine banded contours with an auto-scaled deformed shape
2026-10-15 · Accepted (auto-approved under Shubham's standing M1 instruction, pending his later review)

M1.9 adds the viewer's result files (`worker/clearfea_worker/results/surface.py`, physics-critical) and the result view. Choices it needed:

1. **Two files per run, written by the solve job.** `surface.bin` is the mesh's outer surface in the existing display mesh format, built from the element faces mesh.bin lists per face tag (so it is the run's own mesh, frozen with the run, and face tags still resolve). Each element face is turned to face away from its element's fourth corner, and a 10-node face is split into four triangles through its mid-edge nodes, so every surface node is drawn and curved faces stay curved. `fields.bin` (`packages/spec/result-fields.md`) holds a value per vertex of that surface: a small table of named fields with their `units.json` kind and component count, then float32 values in SI. Version 1 has `displacement` (3 components) and `vonMises`. No value is interpolated or recomputed for display: each vertex takes its node's value from the result reader. Served by `GET /api/runs/:id/surface` and `/fields` once the run has succeeded (409 before, 404 for another user's run). Runs solved before M1.9 have no such files and say so (run again).
2. **Surface only, as the architecture plans.** Contours and the legend cover the outer surface. The legend's range is the surface's, which for von Mises can be narrower than the summary's minimum when the smallest value is inside the body; the Run panel's figures stay the whole-mesh extremes. Volume data for cut planes and probes is M3.
3. **Nine sharp bands, blue to red.** The model is coloured through a nine-texel texture sampled without blending, with each vertex's position in the range as its texture coordinate, so band edges are exact isolines rather than blended colours. The legend lists each band's range in display units (geometry's length unit, MPa until M2.1), numbers only. A field with one value everywhere shows in the middle band.
4. **Deformed shape: undeformed, true scale, or exaggerated (the default).** The exaggerated scale makes the largest displacement about 5 percent of the model's diagonal, rounded down to 1, 2 or 5 times a power of ten, and never below 1; the legend states the scale. A custom scale, animation and the undeformed outline are M3 results tools.
5. **Results are looked at, not picked.** While the Run row shows results the viewer does not change the face selection on a click (hover still names the face), and the selection bar gives way to the legend. Quantity and shape are chosen in the Run panel and kept while the app is open.

Checked with the solver: `worker/spikes/solve_check/` now also writes and reads back the viewer files on the cantilever (surface area equal to the bar's, every triangle facing outwards, largest surface displacement and von Mises equal to the summary's within float32 precision), 13 of 13 checks.

### ADR-032: A run records the versions that produced it and the files its job stored; the deck and log are served as plain text to view or download
2026-10-15 · Accepted (auto-approved under Shubham's standing M1 instruction, pending his later review)

M1.10 completes the run record (ARCHITECTURE section 4: spec, mesh, deck, versions) and makes the solver input and log viewable and downloadable (DECISIONS "Solver input"). Choices it needed:

1. **Workers report their versions when they claim a job.** `ClaimRequest.software` (`WorkerSoftware` in `jobs.schema.json`) carries the worker's ClearFEA version, its deck format (`DECK_FORMAT`), CalculiX and Gmsh, and the API stores it on the job (`jobs.software`, migration 0008). It is optional, so a worker that sends none still works and its versions show as not recorded. Claim time was chosen over completion so the versions are known even for a job that never completes.
2. **The ClearFEA version names the source commit.** It is the package version with the commit after a `+` (for example `0.0.0+a8e7a19`, `-dirty` when the tree had changes), taken from `git describe --always --dirty` by `make worker-image` and `make dev` and baked into the image as `CLEARFEA_COMMIT` (the last layer, so a new commit rebuilds only that). The package version alone stays `0.0.0` until releases exist.
3. **The run stores its own copy of the versions** (`runs.software`, `RunSoftware`): Gmsh and OpenCASCADE from the mesh's own job when the run is created, then ClearFEA, deck format and CalculiX from the solving worker when its job ends, succeeded or failed. Gmsh is the mesh's version, not the solving worker's, because the mesh is what Gmsh made. Runs from before M1.10 show every version as not recorded; `SolveResult.software.calculix` stays for them.
4. **The mesh is referenced, not copied.** `RunView.mesh` (size, order, node and element counts) is read from the run's mesh row, which does not change once ready and cannot be deleted while a run uses it (`ON DELETE RESTRICT`). The mesh itself is downloadable as part of the deck, which lists every node and element in CalculiX's own format; a separate mesh export is M3.8.
5. **The frozen spec is shown, and a changed setup is pointed out.** `RunView.spec` is the setup as saved when the run started. The Run panel compares it with the current setup by content (key order ignored) and says when they differ, so results are never read as belonging to an edited setup.
6. **The run lists its stored files.** When the solve job ends, the API checks which of the run's six files exist and stores their names (`runs.files`). A run the solver stopped on keeps its deck and log; a run that stopped before the solver started (for example a setup the deck generator refuses) has neither, and says so.
7. **Deck and log are served as plain text.** `GET /api/runs/:id/files/deck.inp` and `/solver.log` answer `text/plain; charset=utf-8` with `nosniff` and a `sandbox` content security policy, because the deck carries names the user typed; `?download=1` makes it an attachment named `clearfea-run-<first 8 of id>-<file>`. Other run files are not served here. The Run panel links to both (view opens a new tab), so the browser streams large decks itself instead of the app holding them in memory. While the run solves, the live log stays in the panel; the stored files appear when it has finished (409 before, 404 for another user's run).

### ADR-033: Jobs are metered by the worker's handler time, billed per started second at the rate fixed when queued, and charged in whole micro-credits in the same batch that completes them
2026-10-15 · Accepted (auto-approved under Shubham's standing M1 instruction, pending his later review)

M1.11 adds metering and the ledger (ARCHITECTURE section 6, "Metering"; DECISIONS "Unit of charge" and "Phase 0 wallet"). Choices it needed:

1. **The billable phase is the job's handler.** The worker measures wall-clock time with a monotonic clock from the start to the end of the job's handler, which covers its downloads, the meshing or solving, and its uploads: the time the job occupies the machine. Claiming, queue time and the worker's start-up are outside it. Every completion carries `metering.billableMs` (whole milliseconds, rounded up; `Metering` in `jobs.schema.json`), and the API refuses a completion without it. CPU seconds and peak memory are not recorded yet; the solver benchmark (M2.11) and the estimator (M2.12) add them when they need them.
2. **Only mesh and solve jobs are charged.** Import is free (DECISIONS "Where compute runs"); noop and report are not metered. Every job still records its measured time (`jobs.billable_ms`).
3. **Per-second billing rounds up.** Billed seconds are the measured time rounded up to whole seconds; cost is billed seconds × hourly rate ÷ 3600, rounded to the nearest micro-credit (halves up), in integer arithmetic (`apps/api/src/billing/cost.ts`).
4. **Money is whole micro-credits.** Play money is counted in credits (DECISIONS speaks of a credit grant) and stored as integers of one millionth of a credit, so sums are exact and the ledger reconciles to the unit. The web app shows credits with up to six decimals. What a credit is worth in real money is decided with real payments, after the beta.
5. **Machine sizes are a configuration table.** Migration 0009 adds `machine_sizes` (name, rate in micro-credits per hour, one default) with one row, `local`, at a placeholder 1 credit per hour until beta cost data sets real rates. A metered job takes the default size and copies its rate when it is queued, so a later rate change applies only to new jobs. Thread count and memory limits per size come with the estimator and machine-size choice (M2.12).
6. **Who pays follows the failure classification.** A succeeded job and a job that failed through the user's setup (`user_fault`) are charged; a fault in ClearFEA (`platform_fault`, including a success the API turns into one because outputs are missing) is not, though its time is recorded. Cancelled jobs report nothing yet, so they are not charged; the cancel button and stop limit (M8.2) settle that.
7. **The ledger is append-only and written with the completion.** `ledger_entries` holds the owner, the amount (a charge is negative), the owner's running balance after the entry, the reason (the job type) and the job, which is unique, so a job is charged at most once. The charge is inserted only while the worker still holds the job, in the same D1 batch as the update that completes it, so a job is completed and charged together or not at all. Nothing updates or deletes an entry. Balances start at 0 and may go below it: credit grants, the wallet page and refusing runs on a low balance come with the estimate (M2.12) and the wallet (M8.1).
8. **The run shows its machine and cost.** `RunView.machine` (size and rate, from the solve job) and `RunView.cost` (billed seconds, amount, whether charged; null while solving) are read from the run's job, whose metering columns are written once when it ends. The Run panel's run record shows both; runs from before M1.11 say they were not metered. The mesh job's charge is in the ledger but not shown in the Mesh panel until the wallet page (M8.1).
