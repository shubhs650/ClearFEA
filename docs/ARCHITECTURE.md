# Architecture

How ClearFEA is put together. Product scope lives in `DECISIONS.md`; this file covers system design. Technology choices here are recorded as ADRs in `DECISIONS.md` and are marked proposed until the maintainer confirms them.

## 1. Overview

ClearFEA has three parts that talk only over HTTPS.

```
 Browser                      API                           Job worker
+-----------------+     +----------------------+     +------------------------+
| React app       |     | Cloudflare Worker    |     | Python container       |
| three.js viewer | <-> | Hono routes          | <-> | Gmsh  (import, mesh)   |
| units, forms    |     | D1  (records)        |     | CalculiX (solve)       |
+-----------------+     | R2  (files)          |     | result processing      |
                        | billing, estimator   |     | report assembly        |
                        +----------------------+     +------------------------+
```

- The **browser** holds no authority. It edits a setup document, shows geometry and results, and asks the API for everything.
- The **API** owns all records, all permissions, all money and all job state. It never runs heavy computation.
- The **job worker** runs heavy computation and nothing else. It holds no storage credentials and no user sessions. It claims a job, fetches inputs through URLs the API gives it, runs, uploads outputs, and reports back.

The same three parts run on localhost in Phase 0 and in the cloud in Phase 1. Only configuration differs.

| Part | Phase 0 (localhost) | Phase 1 (cloud beta) |
| --- | --- | --- |
| Frontend | Vite dev server | Cloudflare Pages or Workers static assets |
| API | `wrangler dev` (local Workers runtime) | Cloudflare Workers |
| Database | Local D1 (SQLite file) | Cloudflare D1 |
| File storage | Local R2 emulation | Cloudflare R2 |
| Job worker | One long-running Docker container that polls | One fresh AWS machine per job running the same image |
| Light jobs (import, report) | Same container | Fast-start path, for example AWS Lambda with the same image |

## 2. Repository layout

```
apps/web/            React + Vite + TypeScript frontend
apps/api/            Cloudflare Worker (Hono), D1 migrations
worker/              Python package clearfea_worker and Dockerfile
packages/spec/       JSON Schemas, units.json, shared fixtures
verification/        Benchmark cases: geometry, spec, reference values
infra/               docker-compose.yml, later cloud deployment
docs/
```

Tooling: pnpm workspaces for TypeScript, `uv` for Python, a top-level `Makefile` as the single entry point.

## 3. The face identity chain

This is the highest-risk design point. A user clicks a face in the viewer and applies a pressure. That same face must be found in the mesh, written into the solver input as the right element faces, and later used to report reactions.

1. **Import.** Gmsh reads the STEP file with its OpenCASCADE kernel and converts lengths to metres. Each body (volume) and face (surface) gets an integer tag.
2. **Topology file.** The worker writes `topology.json`: for each body and face, its tag, type (plane, cylinder, other), area, centroid, bounding box and parent body; since M2.8 also each edge's tag, length, bounding box, the faces it bounds and a polyline the viewer draws and picks it by (ADR-045). This file is the reference for face and edge identity.
3. **Display mesh.** The worker tessellates each face and writes one binary file with triangles grouped by face tag (`packages/spec/display-mesh.md`). The viewer uses this for rendering and picking, so a click resolves to a face tag.
4. **Spec.** Loads and supports in the `SimulationSpec` reference face tags (and body tags) of a specific geometry id.
5. **Mesh.** Gmsh meshes the same imported geometry, with a global size, the element order and local sizes on faces, edges or bodies as background fields (ADR-045). Surface elements carry their face tag. The worker writes, for every face tag, the list of volume-element faces lying on it. The mesh file format is `packages/spec/volume-mesh.md` (ADR-028).
6. **Deck.** The deck generator turns face tags into CalculiX node sets and element-face surfaces.
7. **Results.** Reaction sums and face-based result tables use the same sets.

Rules that keep the chain intact:

- Gmsh and OpenCASCADE versions are pinned. Tags are only guaranteed stable for the same file with the same versions.
- The mesh job re-imports the STEP file and compares each face's area and centroid (and each edge's length, box and faces) against `topology.json`. Any mismatch fails the job as a platform fault.
- A geometry record is immutable. A new upload is a new geometry with new tags.

Milestone M1 starts with a spike that proves this chain on three models before any UI is built on it.

## 4. Data model

D1 tables (SQLite). Every table except configuration has `owner_id`.

| Table | Holds |
| --- | --- |
| `users` | Id, name, login, wallet balance (derived from ledger, cached) |
| `projects` | Name, default unit system, visibility. Phase 0 makes one per user on first use (ADR-038) |
| `geometries` | Project, original file key, length unit as read and as confirmed, import status, counts of bodies and faces |
| `simulations` | Project, geometry, analysis type, current `SimulationSpec` JSON, spec schema version |
| `meshes` | Geometry, mesh-settings hash, element and node counts, quality summary, file keys |
| `runs` | Simulation, frozen spec JSON, mesh id, machine size, status, estimate, final cost, failure category, software versions, pinned flag |
| `jobs` | Type (`import`, `mesh`, `solve`, `report`), target record, status, stage, claimed-by, heartbeat, start and end times, metering figures |
| `job_logs` | Job, sequence number, text chunk |
| `ledger_entries` | User, amount, reason, job id, running balance. Append-only |
| `materials` | A user's own materials: owner, name (unique per owner), the material as JSON with its source note. The generic library is the reviewed file `packages/spec/library/materials.json`, not rows here (ADR-046) |
| `share_links` | Run, token hash, revoked flag |
| `machine_sizes` | Name, cores, memory, hourly rate. Configuration |
| `settings` | Free storage quota, retention days, stop-limit multiplier. Configuration |

Files in R2, keyed by owner and record id:

| File | Kept |
| --- | --- |
| Original STEP file | Permanently |
| `topology.json`, display mesh | Permanently |
| Volume mesh | Permanently while referenced by a run |
| Solver input (`.inp`), solver log | Permanently |
| Viewer result files | Permanently |
| Raw solver output (`.frd`, `.dat`) | Retention period, unless the run is pinned |
| Report files and figures | Permanently |

### SimulationSpec

One JSON document describes a complete setup: analysis type, per-body material assignment, bonds, supports, loads, mesh settings, output requests and solver options. Every physical quantity is stored as `{ "value": number, "unit": "MPa" }` exactly as the user typed it. The schema lives in `packages/spec`; TypeScript types and Pydantic models are generated from it.

Version 1 (`packages/spec/schemas/simulation.schema.json`, ADR-026) holds the bodies with their material, isotropic materials, fixed supports, pressures and the global mesh size. Values may be null while the setup is built; `checkSimulationSpec` refuses what is wrong (units of the wrong kind, unknown tags), and pre-run validation lists what is missing. Once a simulation uses a geometry, the geometry's unit is locked. M2 adds supports and loads to the same version (ADR-039 to ADR-044), and M2.8 the element order and local mesh sizes on faces, edges or bodies (ADR-045). Materials from the library or a user's saved materials are copied into the spec with their `source` note (M2.9, ADR-046).

A run stores a frozen copy of the spec. Editing a simulation never changes an existing run.

## 5. Units

- **Internal system:** SI base units (m, kg, s, K; N, Pa, J, W). The solver deck is always written in these.
- **Single table:** `packages/spec/units.json` lists every quantity kind (length, pressure, conductivity and so on), its SI unit, and the factor and offset of each allowed unit. Both the Python worker and the TypeScript frontend load this file.
- **Unit systems:** the same table names unit systems (`metric-mm`, `si`, `us-in`), each giving one unit per kind (ADR-038). The project's system is the unit every quantity field offers first and the unit results are shown in. Values are stored as typed whatever the system.
- **Conversion to SI for solving** happens in exactly one place, the Python deck generator. The frontend converts only for display.
- **Temperature:** stored in kelvin. Temperature differences and absolute temperatures are distinct quantity kinds, so that a 50 °C rise is never converted with an offset.
- **Results** are stored in SI and converted on display, which is why display units can change without a rerun.
- A shared fixture file of known conversions is tested in both languages.

## 6. Jobs

### Life cycle

```
queued -> claimed -> running -> succeeded
                            \-> failed (user_fault | platform_fault)
                            \-> cancelled
                            \-> stopped_at_limit
```

- The API creates a job row and, for metered jobs, checks the wallet balance against the estimate.
- A worker calls `POST /internal/jobs/claim` with its worker token and capabilities. The API marks one job claimed, atomically, and returns the job payload (type, target, parameters) plus transfer URLs, one per named input or output file (ADR-024).
- The worker sends a heartbeat every few seconds with stage, progress and new log text. The response tells it whether to cancel or stop.
- A job whose heartbeat goes silent past a timeout is marked failed as a platform fault and may be retried.
- On completion the worker uploads outputs and posts a result summary with metering figures.

### Job types

| Type | Input | Output | Metered |
| --- | --- | --- | --- |
| `noop` | Nothing | Nothing; exercises claim, heartbeat and completion (M0) | No |
| `import` | STEP file | `topology.json`, display mesh, detected unit, candidate bonds | No |
| `mesh` | STEP file, mesh settings | Volume mesh, face-to-element map, quality summary, mesh display file | Yes |
| `solve` | Frozen spec, mesh | Deck, log, raw output, viewer result files, reaction table | Yes |
| `report` | Run records, figures, options | PDF and DOCX | No |

A mesh job is queued only when the user has no ready or still-meshing mesh with the same settings hash: SHA-256 of the geometry, its scaling and the global size, order and local sizes as entered (`meshSettingsText` in `packages/spec`). Otherwise that mesh becomes the simulation's mesh, shared by its simulations and runs, and nothing is meshed or charged again (M2.10, ADR-047).

### Metering

The worker records wall-clock start and end of the billable phase, CPU seconds and peak memory of the Gmsh or CalculiX process. The API computes cost as billable seconds × the hourly rate of the run's machine size ÷ 3600, and writes one ledger entry. Machine start-up and queue time are outside the billable phase.

As built in M1.11 (ADR-033): the billable phase is the job's handler (downloads, work, uploads), sent as `metering.billableMs` with every completion; mesh and solve jobs are billed per started second at the rate their machine size had when they were queued; money is whole micro-credits; the charge is written to the append-only ledger in the same batch that completes the job, and only when the user pays (a success or a user fault). CPU seconds and peak memory are added with the benchmark and estimator (M2.11, M2.12).

On localhost there is one physical machine, so a machine size is simulated: it sets the solver thread count and a memory limit on the solver process. That is enough to test estimates, out-of-memory handling and billing. Machine sizes are rows of `machine_sizes` (name, cores, memory, rate). M2.12 sets the list (small, medium, large, xlarge: 2 to 16 cores, 8 to 64 GiB, placeholder rates in proportion to memory); the thread count and memory limit that simulate a size come with M8.5.

### Failure classification

The worker returns a cause code; the API maps it to who pays.

| Cause | Category |
| --- | --- |
| Pre-run validation failed (caught in the API, no job created) | No charge |
| Solver reports singular matrix or rigid-body motion | User fault |
| Mesher fails on the geometry | User fault |
| Out of memory on a size smaller than recommended | User fault |
| Cancelled by user, or stop limit reached | User pays for time used |
| Out of memory on the recommended size or larger | Platform fault |
| Worker lost, internal error, transfer failure, topology mismatch | Platform fault |

### Estimator

A function from mesh statistics (nodes, elements, order, analysis type, number of modes) to predicted memory, run time and cost per machine size, and a recommended size. It starts as a fitted formula with coefficients in a versioned JSON file, calibrated from benchmark runs, and is re-fitted as measured runs accumulate. Recommendations are deliberately conservative on memory, because the platform pays when its recommendation is too small.

As built in M2.12 (ADR-049): `packages/spec/estimator.json` holds, per analysis type, two fitted laws in the mesh's node count, `constant + coefficient × nodes^exponent`: the solver's peak memory and the solve job's time. `worker/benchmarks/solver/fit.py` writes it from the job-step benchmark (`steps.py`, `steps.json`), and a test fails if the file and the data disagree. `packages/spec/src/estimator.ts` evaluates the laws; `apps/api/src/billing/estimate.ts` prices the time on every machine size with the cost arithmetic of metering and recommends the cheapest size whose usable memory (85 percent) holds the peak times a margin of 1.25. `GET /api/simulations/{id}/estimate` returns it for the current ready mesh; the Run panel shows it with a machine-size choice; a run is queued on the chosen size (else the recommended one) and keeps the estimate in its record. The solver runs on one thread on every size (ADR-048), so the time is the same on each and only memory and rate differ. Element count, order and modes are not inputs yet: per node, first- and second-order meshes measured about the same, and modal runs come with M6.3.

## 7. Worker internals

Python package `clearfea_worker`:

| Module | Responsibility |
| --- | --- |
| `runner` | Claim loop, heartbeats, transfers, process supervision, metering |
| `geometry` | STEP import, topology extraction, tessellation, bond detection |
| `meshing` | Gmsh meshing with global and local sizes, quality summary, face-to-element map |
| `deck` | Pure function: spec + mesh → CalculiX input text. Physics-critical |
| `deck.loads` | Translation of each load and support type. Physics-critical |
| `results` | Parse `.frd` and `.dat`, derive fields, reaction sums, write viewer files. Physics-critical |
| `report` | Assemble DOCX and PDF from run records and figures |
| `units` | Load `units.json`, convert to SI |

### Load and support translation

Planned CalculiX mapping. Keyword details must be confirmed against the CalculiX manual and by verification cases, not taken from this table on trust.

| ClearFEA item | CalculiX approach |
| --- | --- |
| Fixed support, prescribed displacement | `*BOUNDARY` on the face's node set (fixed); a prescribed displacement's components through the per-node constraint groups below (ADR-039) |
| Frictionless / symmetry support | Every support becomes constraints u·d = v per node; nodes with the same holds form a group, held by `*BOUNDARY` on global degrees of freedom or, for directions off the axes, through a `*TRANSFORM` of the group (one per node). Supports that disagree at a shared node, and supports that leave a rigid-body motion free, are refused (ADR-039). Planar faces only at the gate |
| Elastic support | Normal only (a Winkler foundation): a grounded `SPRING1` per node and face, along the node's share of the face normal ∫ N n dA, stiffness k ∫ N dA, through an `*ORIENTATION` unless along an axis; its reaction is −Σ k_i d_i (d_i · u_i) from the nodes' printed displacements (ADR-043) |
| Force on a face | A uniform traction F / A over all the load's faces, written as consistent nodal loads (`*CLOAD`) that sum to F (ADR-040) |
| Pressure | `*DLOAD` on element faces |
| Remote force and moment | The force and moment at the reference point carried to the faces as the statically equivalent linear traction F/A + α × (x − c), J α = M + (P − c) × F (a distributing connection with weights by area), written as consistent nodal loads (`*CLOAD`) that add up to F with the moment M about P; no reference node (ADR-041) |
| Hydrostatic pressure | p = ρ g · (x − s) below the free surface through s, zero above it, pushing into the body; written as consistent nodal loads (`*CLOAD`), with element faces the surface crosses split until the kink is followed closely (ADR-042) |
| Gravity, centrifugal | `*DLOAD` `GRAV` and `CENTRIF` on each body's element set, with `*DENSITY` per material; gravity loads added into one vector, one centrifugal load per setup (ADR-040) |
| Uniform temperature change | Initial and final temperature fields: every node at 0 in `*INITIAL CONDITIONS, TYPE=TEMPERATURE` and at the change in the step's `*TEMPERATURE`, with `*EXPANSION` per material; the change counts from the stress-free state and applies no nodal load (ADR-044) |
| Bonded interface | `*TIE` between the two surfaces |
| Fixed temperature | `*BOUNDARY` on the temperature degree of freedom |
| Heat flux, internal heat generation | `*DFLUX` |
| Convection | `*FILM` |
| Radiation to ambient | `*RADIATE` with the absolute-zero and Stefan-Boltzmann constants set for SI |
| Thermal stress | Heat transfer step followed by a static step in one deck |
| Modal | `*FREQUENCY` step |
| Reactions | Reaction force totals per support node set when all supports are fixed; otherwise the force at each held node, shared between the supports holding it along their own directions (ADR-039). Force, remote, hydrostatic and body loads applied at held nodes are taken out first, since CalculiX counts them in RF (ADR-040). An elastic support's reaction is its springs' force from the displacements (ADR-043) |

### Solver configuration

- Second-order tetrahedra (`C3D10`) by default; first-order (`C3D4`) selectable with a warning about stiffness.
- Linear solver choice (direct or iterative) is made by the platform from model size and analysis type, shown to the user and recorded in the run.
- The CalculiX build for production is chosen by benchmark (ADR-010).

### Results pipeline

1. Parse nodal displacement, stress, strain, temperature and heat flux from the solver output.
2. Compute derived fields: von Mises, principal stresses, safety factor against yield.
3. Extract the outer surface of each body. Write per-field binary arrays for surface nodes only. This is what the viewer loads first, and it stays small even for the 2-million-element target. Since M1.9 these are `surface.bin` (display mesh format) and `fields.bin` (`packages/spec/result-fields.md`, ADR-031).
4. Write volume data in a chunked binary form for cut planes and probes.
5. Write a summary JSON: min and max per field with locations, reaction table, applied-load totals and the balance check, mode frequencies, solver warnings.

**Open design question: cut planes on large models.** Small and medium models can be sliced in the browser from the volume file in a web worker. For the largest models the volume file may be too big to download comfortably, and a server-side slice needs a machine. This is to be settled by measurement in M3; record the outcome as an ADR.

## 8. API

Hono on Cloudflare Workers, TypeScript.

- **Public routes** (`/api/...`): session login, projects, geometries, simulations, meshes, runs, materials, wallet, share links. JSON in and out, validated against the shared schemas.
- **Internal routes** (`/internal/...`): job claim, heartbeat, completion, file transfer. Authenticated by worker token, never by user session.
- **Data-access layer:** every function takes the acting user id and applies `owner_id` filtering. Route handlers do not write SQL.
- **Pre-run validation:** a pure function over the spec and topology that returns a list of problems in plain language (`preRunProblems` in `packages/spec`, ADR-034). The API refuses a run with it before any job is queued, and the UI shows the same list beside the disabled Run button.
- **Billing module:** rate lookup, cost calculation, ledger writes, stop-limit checks on each heartbeat. Physics-critical in the sense that it must be exactly right.
- **Live updates:** the browser polls job status and log every couple of seconds while a job is active. No websockets at the gate.
- **Constraints to respect:** Workers have short CPU limits and request-size limits and cannot run native binaries. Large files therefore move directly between the worker container (or browser) and R2 in the cloud, never through a Worker request body.

Authentication in Phase 0 is a seeded user table and a signed session cookie. The session layer is an interface so that real authentication replaces it in Phase 1 without touching routes.

## 9. Frontend

React, Vite, TypeScript, three.js.

- **Layout:** simulation tree on the left, 3D viewer in the centre, settings panel on the right for the selected tree item, run and status bar along the bottom.
- **Tree items:** geometry, materials, bonds, supports, loads, mesh, runs, and under each run its results and report. Each shows complete, incomplete or error.
- **Viewer:** renders the display mesh with one pickable group per face. Hover highlights a face; click adds it to the active selection. Result mode colours surface nodes from the field arrays with a legend, deformed shape scaling, cut planes and probes.
- **Quantity input:** one shared component for every physical value (`apps/web/src/units/QuantityInput.tsx`): number field plus unit dropdown, limited to units of the right kind, defaulting to the project system. The system is chosen under the simulation tree.
- **State:** the `SimulationSpec` is the single source of truth for setup. The UI edits it and saves it through the API; nothing about the setup lives only in component state.
- **Desktop only.** Minimum supported width is a laptop screen.

Design direction: quiet and dense enough for engineering work, with the viewer taking most of the screen.

## 10. Security and privacy

- STEP files are untrusted input to a large native parser. The worker container runs as a non-root user, with no network access except the API and storage endpoints, and with CPU, memory and time limits.
- One job per machine in the cloud, so one user's data never shares a machine with another's.
- The worker holds no long-lived storage credentials; transfer URLs are scoped to one job and expire.
- Share links carry a random token; only its hash is stored.
- Automated tests prove that user A cannot read, list or modify user B's records or files through any route.
- Secrets come from environment configuration and are never committed.

## 11. Phase 1 notes

Not built in Phase 0, but the design must not block them.

- **Machine launch.** When a metered job is queued, a launcher starts one machine of the requested size with the worker image and the job id; the machine claims that job, runs it and terminates. Candidates: AWS Batch, ECS on EC2, or direct instance launch. Decide in Phase 1 from cost and start-up time.
- **Fast path for light jobs.** Import and report jobs need to start in seconds. Candidate: AWS Lambda running the same container image.
- **Spot tier.** The job model already supports retry after a lost machine, which is what a spot tier needs.
- **Real authentication, email, payments** replace the Phase 0 stand-ins behind their interfaces.

## 12. Known risks

| Risk | Mitigation |
| --- | --- |
| Face tags drift between import and mesh | Pinned versions, topology comparison on every mesh job, M1 spike |
| Docker unavailable in the development environment | Checked in M0; fallback is running the worker as a plain process with the same code |
| CalculiX direct solver too slow or memory-hungry at the size target | Benchmark task in M2, solver build chosen by data |
| Tied interfaces give poor stresses near bonds | Stated in the report; verification case comparing a bonded pair with a single body |
| Remote-load coupling behaves differently from expectation | Dedicated verification cases for force and moment equilibrium and stress distribution |
| Real-world STEP files fail to import or mesh | Collect failing files as test cases (with permission); clear error messages; the beta exists to find these |
| Local R2 and D1 emulation differ from production | Keep storage and database access behind thin interfaces; deploy a staging copy early in Phase 1 |
