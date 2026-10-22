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

| Part | Phase 0 (localhost) | Live closed beta (M10, ADR-095) |
| --- | --- | --- |
| Frontend | Vite dev server | Static assets of the API's Worker, same origin, at `clearfea.triyalabs.com` |
| API | `wrangler dev` (local Workers runtime) | Cloudflare Workers (Paid plan) |
| Database | Local D1 (SQLite file) | Cloudflare D1 |
| File storage | Local R2 emulation | Cloudflare R2; the worker moves files through presigned R2 URLs |
| Sign-in | Seeded password users (ADR-022) | Better Auth, Google only, admin-managed allowlist |
| Job worker | One long-running Docker container that polls | AWS ECS Fargate tasks running the same image, started by the API when work is queued and stopped after 10 idle minutes |
| Light jobs (import, report) | Same container | Same machines (a fast path such as AWS Lambda is not decided) |

The live set-up is described in section 11 and the maintainer's steps in `DEPLOYMENT.md`.

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
2. **Topology file.** The worker writes `topology.json`: for each body and face, its tag, type (plane, cylinder, other), area, centroid, bounding box and parent body; since M2.8 also each edge's tag, length, bounding box, the faces it bounds and a polyline the viewer draws and picks it by (ADR-045); since M4.1 each body's part name from the STEP assembly tree, when the file gives one (ADR-058). Since M4.2 also the candidate bonds: pairs of faces of different bodies that touch over an area within `bondTolerance`, with contact area and gap (ADR-059). This file is the reference for face and edge identity.
3. **Display mesh.** The worker tessellates each face and writes one binary file with triangles grouped by face tag (`packages/spec/display-mesh.md`). The viewer uses this for rendering and picking, so a click resolves to a face tag.
4. **Spec.** Loads and supports in the `SimulationSpec` reference face tags (and body tags) of a specific geometry id.
5. **Mesh.** Gmsh meshes the same imported geometry, with a global size, the element order and local sizes on faces, edges or bodies as background fields (ADR-045). Each body is meshed on its own: touching bodies keep separate faces and nodes, and bonds join them in the deck (M4.3, ADR-060). Surface elements carry their face tag. The worker writes, for every face tag, the list of volume-element faces lying on it. The mesh file format is `packages/spec/volume-mesh.md` (ADR-028).
6. **Deck.** The deck generator turns face tags into CalculiX node sets and element-face surfaces, and each tied bond's two faces into equations between their nodes.
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
| `users` | Id, name, login, wallet balance (not stored: the last ledger entry's balance, ADR-080) |
| `folders` | A user's folders on the home page: parent folder (null at the top), name, when it went to the trash (ADR-114) |
| `projects` | Name, default unit system, visibility, folder (null at the top of the home), when it went to the trash, when it was last opened, when its thumbnail was stored. A user's first project ("My first project") is made on first use (ADR-038, ADR-114) |
| `geometries` | Project (always one of the owner's; migration 0029's triggers refuse anything else), original file key, length unit as read and as confirmed, import status, counts of bodies and faces |
| `simulations` | Project (always its geometry's), geometry, analysis type, current `SimulationSpec` JSON, spec schema version |
| `meshes` | Geometry, mesh-settings hash, element and node counts, quality summary, file keys |
| `runs` | Simulation, frozen spec JSON, mesh id, machine size, status, estimate, final cost, failure category, software versions, pinned flag, when the raw output was removed, the run it reran (ADR-086) |
| `jobs` | Type (`import`, `mesh`, `solve`, `report`), target record, status, stage, claimed-by, heartbeat, start and end times, metering figures |
| `job_logs` | Job, sequence number, text chunk |
| `ledger_entries` | User, amount, reason, job id, running balance. Append-only |
| `storage_charges` | User, UTC day, bytes stored, allowance, rate and amount of a day's storage charge, and its ledger entry (ADR-086) |
| `materials` | A user's own materials: owner, name (unique per owner), the material as JSON with its source note. The generic library is the reviewed file `packages/spec/library/materials.json`, not rows here (ADR-046) |
| `views` | Saved views of a simulation: name (unique per simulation), camera, hidden bodies and the result display as JSON (`view.schema.json`, ADR-055). The report picks its pictures from them |
| `report_options` | A simulation's report options: sections, saved views for the result plots and the title block as JSON (`report.schema.json`, ADR-074) |
| `report_branding` | A user's company name and logo (type, bytes, pixel size); the logo itself is in R2 (ADR-074) |
| `report_figures` | A run's report figures, drawn in the browser: kind (support, load or view), item id, caption, order, pixel size; the PNGs are in R2 under the run (ADR-011, ADR-075) |
| `share_links` | Run, token hash, revoked flag |
| `machine_sizes` | Name, cores, memory, hourly rate. Configuration |
| `settings` | Free storage quota, retention days, storage rate (M8.6, ADR-086), stop-limit multiplier, queue limits (M11.3, ADR-112), trash retention days (M14.2, ADR-124). Configuration |

Files in R2, keyed by owner and record id:

| File | Kept |
| --- | --- |
| Original STEP file | Permanently |
| `topology.json`, display mesh | Permanently |
| Volume mesh | Permanently while referenced by a run |
| Solver input (`.inp`), solver log | Permanently |
| Viewer result files | Permanently |
| Raw solver output (`.frd`, `.dat`) | Retention period, unless the run is pinned |
| Everything of a project in the trash | Until the trash retention period after it went there (M14.2) |

Since M8.6 (ADR-086) a user's storage is measured by listing these files under `owners/<id>/` (`GET /api/storage`), and a daily sweep (the Worker's cron trigger; `make dev` calls it every hour) removes unpinned raw output past the retention period and charges what is above the free allowance once a day, as a ledger entry with reason `storage`. Since M14.2 (ADR-124) the sweep first purges projects and folders in the trash past the trash retention period: a project's runs, simulations, meshes, geometries and the project row go, with every file under their R2 folders and the project's own (`owners/<id>/projects/<project>/`, the thumbnail); its jobs and ledger entries stay as the record of what was charged. `POST /api/runs/:id/rerun` solves a run's frozen spec on its mesh again as a new run, which regenerates removed raw output.
| Report files and figures | Permanently |
| A user's report logo | Until replaced or removed |

### SimulationSpec

One JSON document describes a complete setup: analysis type, per-body material assignment, bonds, supports, loads, mesh settings, output requests and solver options. Every physical quantity is stored as `{ "value": number, "unit": "MPa" }` exactly as the user typed it. The schema lives in `packages/spec`; TypeScript types and Pydantic models are generated from it.

Version 1 (`packages/spec/schemas/simulation.schema.json`, ADR-026) holds the bodies with their material, isotropic materials, fixed supports, pressures and the global mesh size. Values may be null while the setup is built; `checkSimulationSpec` refuses what is wrong (units of the wrong kind, unknown tags), and pre-run validation lists what is missing. Once a simulation uses a geometry, the geometry's unit is locked. M2 adds supports and loads to the same version (ADR-039 to ADR-044), and M2.8 the element order and local mesh sizes on faces, edges or bodies (ADR-045). Materials from the library or a user's saved materials are copied into the spec with their `source` note (M2.9, ADR-046). Since M4.2 the spec lists every candidate bond of the geometry as detected, accepted or removed; every bond not removed is tied (ADR-059).

A run stores a frozen copy of the spec. Editing a simulation never changes an existing run.

## 5. Units

- **Internal system:** SI base units (m, kg, s, K; N, Pa, J, W). The solver deck is always written in these.
- **Single table:** `packages/spec/units.json` lists every quantity kind (length, pressure, conductivity and so on), its SI unit, and the factor and offset of each allowed unit. Both the Python worker and the TypeScript frontend load this file.
- **Unit systems:** the same table names unit systems (`metric-mm`, `si`, `us-in`), each giving one unit per kind (ADR-038). The project's system is the unit every quantity field offers first and the unit results are shown in. Values are stored as typed whatever the system.
- **Conversion to SI for solving** happens in exactly one place, the Python deck generator. The frontend converts only for display.
- **Temperature:** stored in kelvin. Temperature differences and absolute temperatures are distinct quantity kinds, so that a 50 °C rise is never converted with an offset.
- **Results** are stored in SI and converted on display, which is why display units can change without a rerun. The Run panel can pick a unit per kind over the system's for results only (ADR-056), kept per user in the browser.
- **Reports** print in their own unit system, chosen in the report options and starting as the project's, never the browser's picks; the report job converts through the worker's units module (`clearfea_worker/report/units.py`, ADR-076).
- A shared fixture file of known conversions is tested in both languages.

## 6. Jobs

### Life cycle

```
queued -> claimed -> running -> succeeded
                            \-> failed (user_fault | platform_fault)
                            \-> cancelled
                            \-> stopped_at_limit
```

- The API creates a job row and, for metered jobs, checks the wallet balance against the estimate (not in self-hosting mode, where the wallet is informational, ADR-084).
- A worker calls `POST /internal/jobs/claim` with its worker token and capabilities. The API marks one job claimed, atomically, and returns the job payload (type, target, parameters) plus transfer URLs, one per named input or output file (ADR-024).
- The worker sends a heartbeat every few seconds with stage, progress and new log text. The response tells it whether to cancel or stop.
- Since M8.2 (ADR-085) the owner cancels a run with `POST /api/runs/{id}/cancel`. A queued job ends at once, uncharged. A claimed or running job is marked (`jobs.stop_requested`); its next heartbeat answers `cancel`, the worker stops the solver, keeps the deck and log, and completes with `status: "stopped"` and its metering, and the API ends the job as `cancelled` and charges the time used. Since M8.3 (ADR-087) a run's solve job also carries a stop limit, by default three times the estimated time and never under 30 s; the first heartbeat after the job has had the machine that long sets `stop_requested` to `stopped_at_limit` and answers `stop`, and the job ends the same way as a cancel, as `stopped_at_limit`, charged for its time. While a run solves, its view carries its progress: when the worker took it, the elapsed time and what that time costs so far.
- A job whose heartbeat goes silent past a timeout is marked failed as a platform fault (`worker_lost`), not charged. Since M8.4 (ADR-089) the timeout is the `heartbeat_timeout_seconds` setting (120 s, a placeholder); a worker that asks for a job while it still holds one has restarted, so that job is failed at once. A claim fails the claiming worker's own held jobs first; silent workers' jobs are failed only by the per-minute scheduled handler (M11.3, ADR-112), which `make dev` calls every minute since cron triggers never fire locally. The job is not retried; its owner runs it again.
- On completion the worker uploads outputs and posts a result summary with metering figures.

### Job types

| Type | Input | Output | Metered |
| --- | --- | --- | --- |
| `noop` | Nothing | Nothing; exercises claim, heartbeat and completion (M0) | No |
| `import` | STEP file | `topology.json`, display mesh, detected unit, candidate bonds | No |
| `mesh` | STEP file, mesh settings | Volume mesh, face-to-element map, quality summary, mesh display file | Yes |
| `solve` | Frozen spec, mesh | Deck, log, raw output, viewer result files, reaction table | Yes |
| `report` | Run record, figures, options, logo, `topology.json`, solver log (all frozen in its params when asked for, ADR-077) | DOCX (M7.3); PDF printed from it by LibreOffice (M7.4, ADR-078) | No |

A mesh job is queued only when the user has no ready or still-meshing mesh with the same settings hash: SHA-256 of the geometry, its scaling and the global size, order and local sizes as entered (`meshSettingsText` in `packages/spec`). Otherwise that mesh becomes the simulation's mesh, shared by its simulations and runs, and nothing is meshed or charged again (M2.10, ADR-047).

### Metering

The worker records wall-clock start and end of the billable phase, CPU seconds and peak memory of the Gmsh or CalculiX process. The API computes cost as billable seconds × the hourly rate of the run's machine size ÷ 3600, and writes one ledger entry. Machine start-up and queue time are outside the billable phase.

As built in M1.11 (ADR-033): the billable phase is the job's handler (downloads, work, uploads), sent as `metering.billableMs` with every completion; mesh and solve jobs are billed per started second at the rate their machine size had when they were queued; money is whole micro-credits; the charge is written to the append-only ledger in the same batch that completes the job, and only when the user pays (a success or a user fault). CPU seconds and peak memory are added with the benchmark and estimator (M2.11, M2.12).

On localhost there is one physical machine, so a machine size is simulated: it sets the solver thread count and a memory limit on the solver process. That is enough to test estimates, out-of-memory handling and billing. Machine sizes are rows of `machine_sizes` (name, cores, memory, rate). M2.12 sets the list (small, medium, large, xlarge: 2 to 16 cores, 8 to 64 GiB, placeholder rates in proportion to memory); since M8.5 (ADR-082) each solve job carries its size's cores and memory limit (85 percent of the size's memory, the share the recommendation counts on): the worker holds CalculiX to those processors (it stays on one thread, ADR-048) and kills it as out of memory when its resident memory passes the limit. The worker reports the cause `out_of_memory`; the API decides who pays from the run's frozen estimate. The worker container itself has no memory limit (ADR-088), so the size's limit is the one a solve meets; on localhost the physical machine's memory is the ceiling.

### Failure classification

The worker returns a cause code; the API maps it to who pays.

| Cause | Category |
| --- | --- |
| Pre-run validation failed (caught in the API, no job created) | No charge |
| Solver reports singular matrix or rigid-body motion (the deck generator's rigid-body check, `setup_invalid`; SPOOLES's singular matrix, `singular_matrix`) | User fault |
| Mesher fails on the geometry | User fault |
| Out of memory on a size smaller than recommended | User fault |
| Cancelled by user, or stop limit reached | User pays for time used |
| Out of memory on the recommended size or larger | Platform fault |
| Worker lost, internal error, transfer failure, topology mismatch | Platform fault |
| Any other solver error (the deck is generated, so CalculiX refusing it is ClearFEA's fault) | Platform fault |

As built in M12.2 (ADR-108, ADR-122): a platform fault of the machine rather than the job (`worker_lost`, `container_exited`, `container_start_failed`) queues the job again, uncharged, at most twice; a PaStiX crash is solved again with SPOOLES in the same job when the mesh is within SPOOLES's element limit, and the run's result names the solver that solved it.

As built in M8.4 (ADR-089): the worker sends the category for what it can see; the API decides it for out of memory (ADR-082), a lost worker and a success whose outputs are missing or invalid. A failed run carries `RunView.failure` (category and cause) and the Run panel's run record shows it with what it means for the cost; a cancelled or stopped run has no category, since its status says why it ended and its time is charged. PaStiX and the iterative solvers return a solution for a singular matrix without a word, so only the rigid-body check catches such a setup on them.

### Estimator

A function from mesh statistics (nodes, elements, order, analysis type, number of modes) to predicted memory, run time and cost per machine size, and a recommended size. It starts as a fitted formula with coefficients in a versioned JSON file, calibrated from benchmark runs, and is re-fitted as measured runs accumulate. Recommendations are deliberately conservative on memory, because the platform pays when its recommendation is too small.

As built in M2.12 (ADR-049), per solver since ADR-063: `packages/spec/estimator.json` holds, per analysis type and equation solver, two fitted laws in the mesh's node count, `constant + coefficient × nodes^exponent`: the solver's peak memory (both element orders together) and the solve job's time (per element order since M8.9, ADR-081). `worker/benchmarks/solver/fit.py` writes it from the job-step benchmark (`steps.py`, `steps.json`), and a test fails if the file and the data disagree. `packages/spec/src/estimator.ts` evaluates the laws; `apps/api/src/billing/estimate.ts` prices the time on every machine size with the cost arithmetic of metering and recommends the cheapest size whose usable memory (85 percent) holds the peak times a margin of 1.25. `GET /api/simulations/{id}/estimate` returns it for the current ready mesh and the spec's solver (or `?solver=`); the Run panel shows it with a machine-size choice; a run is queued on the chosen size (else the recommended one) and keeps the estimate in its record. The solver runs on one thread on every size (ADR-048), so the time is the same on each and only memory and rate differ. Element count is not an input; element order picks the time law, since per node a ten-node mesh takes longer to solve (memory is about the same per node). `worker/benchmarks/solver/check.py` checks the estimated cost against the measured cost on every benchmark row (30 percent, or one billed second; ADR-081), and `make test` runs it. Since M6.3 (ADR-072) a modal run has a model of its own, for SPOOLES alone (the one solver a modal setup takes): peak memory and job time are each a part for the mesh plus the number of modes times a part per mode, every part a law in the node count; the estimate is for the modes asked for (`?analysis=` and `?modes=` ask for others than the saved spec's), and the modal element limits are for the most modes a setup may ask for (100). Steady-state thermal and thermal stress runs use the linear static model (ADR-064).

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
| `report` | Assemble DOCX and PDF from run records and figures, with the standing statements of `packages/spec/report-notes.json` filled from the run record and the notes its frozen spec calls for (ADR-062, ADR-073): `content.py` decides what is printed, every value through `units.py` (M7.6), `docx.py` lays it out (ADR-077) and `pdf.py` prints the DOCX to PDF with LibreOffice Writer (ADR-078) |
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
| Bonded interface | Every bond not removed: each node of the face with the finer mesh follows the closest point of the other face, as `*EQUATION` lines in the nodes' own directions (u_s = Σ N_m u_m, master shape functions at that point); not CalculiX's `*TIE`, whose printed nodal forces leave out the tie forces a held node carries (ADR-060) |
| Steady-state thermal analysis | A `*HEAT TRANSFER, STEADY STATE` step on the same C3D10 or C3D4 elements, `*CONDUCTIVITY` per material and no `*ELASTIC`; faces with no thermal load are insulated; the nodal temperatures (`NT`) are the result (ADR-064) |
| Fixed temperature | `*BOUNDARY` on the temperature degree of freedom (11) for every node on the faces, in kelvin; two fixed temperatures that meet at a node with different values are refused (ADR-064) |
| Heat flux, internal heat generation | `*DFLUX`: `Sn` on the element faces of the faces (W/m², positive into the body), `BF` on each picked body's element set (W/m³); fluxes on one face and generations in one body add up (ADR-065) |
| Convection | `*FILM` `Fn` on the element faces, ambient temperature in kelvin and coefficient in W/(m²·K); one per face (ADR-065) |
| Radiation to ambient | `*RADIATE` `Rn` on the element faces, ambient temperature in kelvin and emissivity, with `*PHYSICAL CONSTANTS` (absolute zero 0, Stefan-Boltzmann constant in SI) and every node starting at the mean known temperature, since radiation makes the step nonlinear; one per face (ADR-065) |
| Heat flux and heat flows | `*EL FILE` `HFL`: the nodal heat flux q = −k grad T (W/m²), averaged like the stress. Each thermal load's heat flow is worked out the way CalculiX applies it: a flux, convection and radiation over their element faces (the last two at the solved temperatures, printed to seven digits for their nodes, `NSET=XALL`), a heat generation over its bodies; a fixed temperature's from CalculiX's nodal heat flows `RFL` at its nodes (`NSET=TALL`) with the other loads' heat there taken out. Heat in against heat out goes in the run's summary, measured against half the loads' gross heat flow (ADR-066) |
| Thermal stress | The heat transfer step, then the static step, in one deck; CalculiX carries the solved temperatures into the static step. Every node starts at the setup's stress-free temperature (`*INITIAL CONDITIONS`), which thermal strain is measured from, and the static step is one increment (`1.0, 1.0, 1.0, 1.0`). Materials get both the thermal and the elastic keywords (ADR-067) |
| Bonded interface (thermal) | Every bond not removed also carries heat: each node of the face with the finer mesh takes the temperature of the closest point of the other face, as `*EQUATION` lines on degree of freedom 11 (T_s = Σ N_m T_m, the same weights as the displacement ties); a slave node at a fixed temperature is not tied. CalculiX's `RFL` at a fixed-temperature node leaves out the heat the ties pass to it, so the reader adds it back from the tied nodes' `RFL` (`NSET=TTIED`). Each group of bonded bodies needs one load that sets its temperature (ADR-069) |
| Temperature-dependent properties | A material's tables (conductivity, Young's modulus, Poisson's ratio, expansion) become temperature rows of `*CONDUCTIVITY`, `*ELASTIC` (both properties merged onto every temperature of either table) and `*EXPANSION, ZERO=` the table's reference temperature; used only by analyses that solve temperatures. A conductivity table makes the heat step nonlinear: every node starts at the mean known temperature (or the stress-free one) and the step iterates to `*CONTROLS, PARAMETERS=FIELD` `1e-5, 1e-5` (ADR-068) |
| Modal | A `*FREQUENCY, SOLVER=SPOOLES` step (CalculiX refuses its iterative solvers there, and its PaStiX interface corrupts memory there, ADR-072) with the number of modes, the supports' `*BOUNDARY` lines without values and `*NODE FILE` `U`; `*DENSITY` per material, no loads. A body no support holds is allowed and gives six rigid-body modes near zero, but only with SPOOLES: CalculiX factors K − 1·M, which such a body makes indefinite, and PaStiX then gives wrong frequencies or stops. The reader takes the eigenvalue table of the `.dat` file; `SolveResult.frequencies` holds each mode's frequency in Hz, signed like the eigenvalue (ADR-070). Each mode's shape, the `.frd` file's `DISP` block for it, becomes a field `mode<N>`, scaled so its largest displacement is 1 and signed so the largest component where it moves most is positive (ADR-071) |
| Reactions | The force at each held node (printed node by node for every setup since M3.2), shared between the supports holding it along their own directions (ADR-039). Every load applied at held nodes, uniform pressures included, is taken out first, since CalculiX counts it in RF (ADR-040, ADR-051). An elastic support's reaction is its springs' force from the displacements (ADR-043). A held node that tied nodes follow also gets its share of their tie forces, from the tied nodes' printed forces and the equations' coefficients (ADR-060). Each support's moment is taken about the area centroid of its faces; each load's total force and moment and the balance of loads against reactions go in the run's summary (ADR-051) |

### Solver configuration

- Second-order tetrahedra (`C3D10`) by default; first-order (`C3D4`) selectable with a warning about stiffness.
- The equation solver is the user's choice in the Run panel, PaStiX by default, with SPOOLES and CalculiX's two iterative solvers as options; the iterative ones carry an accuracy note wherever they are chosen or used. It is stored in the spec, written on the deck's `*STATIC` line and frozen with the run (ADR-063).
- Each solver has an element limit per element order on a 16 GiB machine, in `packages/spec/estimator.json`, fitted from the job-step benchmark; the API refuses a run above it and the Run panel lists it as a blocker (ADR-063); a modal run has limits of its own, for 100 modes (ADR-072).
- The CalculiX build is 2.21 from Ubuntu's source package, built with PaStiX by `worker/ccx/build.sh` in the worker image (ADR-010, ADR-063).

### Results pipeline

1. Parse nodal displacement, stress, strain, temperature and heat flux from the solver output.
2. Compute derived fields: von Mises, principal stresses, safety factor against yield (since M3.5: yield strength over von Mises at each node, capped at 15, when every material has a yield strength; ADR-054).
3. Extract the outer surface of each body. Write per-field binary arrays for surface nodes only. This is what the viewer loads first, and it stays small even for the 2-million-element target. Since M1.9 these are `surface.bin` (display mesh format) and `fields.bin` (`packages/spec/result-fields.md`, ADR-031).
4. Write volume data in a chunked binary form for cut planes and probes. Since M3.4 this is `nodes.bin`: every field at every mesh node in the `fields.bin` layout, one block per field, served whole or one field at a time; the mesh itself is the run's `mesh.bin` (ADR-053).
5. Write a summary JSON: min and max per field with locations, reaction table, applied-load totals and the balance check, mode frequencies, solver warnings; for a thermal run the temperature range, the largest heat flux, each thermal load's heat flow and the heat balance (ADR-066).
6. Export (since M3.8, ADR-057): the browser builds CSV files (results at every node, reactions and loads, in the units shown) and a VTK XML file (`.vtu`, the mesh and every field, in SI) from `mesh.bin`, `nodes.bin` and the summary; nothing more is stored per run.

**Cut planes on large models (settled in M3.4, ADR-053).** Every model is cut in the browser, on the main thread, from the run's `mesh.bin` and the fields drawn, fetched one field at a time. Measured on a 2-million-element mesh: a cut takes about a quarter of a second and the first cut downloads about 150 MB (the mesh and one scalar field); there is no server-side slice.

### Compute manager (M12.1)

On the solver host (ADR-106, ADR-107, ADR-121) a compute manager, `python -m clearfea_worker manager` (`worker/clearfea_worker/manager/`), takes the worker's place. It claims through the same route with one worker id per lane (`<host>-solve` for solve jobs, `<host>-light` for the rest), at most one job per lane, and runs each claimed job in a fresh container of the worker image through the Docker Engine API on its socket (`manager/docker.py`, standard library only). The container gets the job in `CLEARFEA_JOB` and runs `python -m clearfea_worker job`, the worker's own `run_job` for that one job, so transfers, heartbeats, cancels, stop limits and the outcome work as before. The container's configuration is one pure function, `manager/containers.py`: user 10001, no capabilities, read-only root, a per-job scratch volume at `/scratch`, memory without swap, a process limit, the lane's CPUs, no published ports. The manager reports a container that ended without reporting as a platform fault (`container_exited`, `out_of_memory` with the container's memory limit as its peak, `job_timeout`, `container_start_failed`) and removes it with its volume, and the API queues the job again when the fault was the machine's (M12.2, ADR-122); after its own restart it follows the containers labelled with its host that still run and clears up the rest. The claim lets users take turns in a lane (ADR-121 item 7).

Settings (environment): the worker's `CLEARFEA_API_URL`, `CLEARFEA_WORKER_TOKEN` and Access pair; `CLEARFEA_HOST_NAME` (default the host name), `CLEARFEA_JOB_IMAGE` (default `clearfea-worker`), `CLEARFEA_JOB_NETWORK` (`bridge`; `host` where the API is on the host's loopback), `CLEARFEA_SOLVE_CPUS` and `CLEARFEA_LIGHT_CPUS` (6 and 1), `CLEARFEA_SOLVE_MEMORY` and `CLEARFEA_LIGHT_MEMORY` (17g and 4g), `CLEARFEA_SOLVE_CPUSET` and `CLEARFEA_LIGHT_CPUSET` (unset: not pinned), `CLEARFEA_JOB_PIDS_LIMIT` (1024), `CLEARFEA_IDLE_POLL_MAX_SECONDS` (15), `CLEARFEA_JOB_MAX_SECONDS` (46800), `CLEARFEA_DOCKER_SOCKET`, `CLEARFEA_SCRATCH_PATH` (unset: the scratch disk is not checked) and `CLEARFEA_SCRATCH_MIN_FREE` (20g; no claims below it, M12.2). Locally `CLEARFEA_RUNNER=manager make verify` (or `make e2e`) runs it in place of the worker. `CLEARFEA_HOST_DISK_PATH` names the disk whose free space the check-ins report (unset: `CLEARFEA_SCRATCH_PATH`, else Docker's data directory when visible, else `/`).

Statistics (M12.3, ADR-109, ADR-123): the API keeps one `job_stats` row per try of a job, started by the claim, moved from stage to stage by the heartbeats and ended with the completion, before a re-queue. The manager samples each job container's Docker statistics every 5 s (`manager/stats.py`) and posts memory, CPU, disk, exit code and the out-of-memory flag to `POST /internal/jobs/{id}/stats` when the container ends; each check-in carries the host's load, kept in `host_stats` for 14 days. The admin reads both at `GET /api/admin/stats/jobs` and `GET /api/admin/stats/host`.

Event log (M13.1, ADR-113, ADR-125): the `events` table holds one row per sign-in or refused sign-in, failed job, job queued again after a machine fault, solver host check-in after a silence (or its first), host silent for 120 s (recorded once by the per-minute cron), compute manager restart (a new `startedAt` in the check-in while the host stays online) and admin action, each with a kind, a level (info, warning, error), the user, job and host it concerns, one plain line and a JSON detail. It is written by `apps/api/src/db/events.ts` from the routes and sweeps where these happen and read by the admin at `GET /api/admin/events` (kind, level, user, since, before, limit). It holds ids, addresses and failure messages for support, never a project's name, model or results.

Admin dashboard (M13.2, M13.3, ADR-113, ADR-127, ADR-128): the admin page's tabs are Overview, Jobs and runs, Users, Events, Settings and Costs. `GET /api/admin/overview` gives the alerts, the solver host with its latest load, whether the queue is paused and each lane's running and waiting jobs; the page checks it again through the polling hook. `PUT /api/admin/queue-paused` sets `settings.queue_paused`: while it is 1 the claim (`claimJob`) hands out nothing and the launcher starts nothing, and new jobs still queue. `GET /api/admin/jobs` lists every user's jobs (`apps/api/src/db/adminJobs.ts`); `GET /api/admin/jobs/{id}/log` reads one's log; `POST /api/admin/jobs/{id}/cancel` ends a queued or held job at once as `cancelled_by_admin`, uncharged, and `POST /api/admin/jobs/{id}/requeue` takes a held job from its worker and queues it again (`apps/api/src/jobs/outcome.ts`), each recorded as an admin action. `GET /api/admin/settings` lists every row of `settings` but `queue_paused` from the catalogue `SETTINGS` (`apps/api/src/db/settings.ts`: group, label, unit and scale, stored range) and `PUT /api/admin/settings/{name}` changes one within its range, recorded as an admin action; `GET /api/admin/costs?month=YYYY-MM` (`apps/api/src/db/costs.ts`) gives a month's jobs, machine time and charges by user and job type with the fixed monthly costs of the solver host and Cloudflare (settings `solver_host_monthly_cents`, `platform_monthly_cents`).

## 8. API

Hono on Cloudflare Workers, TypeScript.

- **Public routes** (`/api/...`): session login, projects and folders (`/api/projects`, `/api/folders`: the home with every folder and project, create, rename, move, duplicate, trash and restore, M14.2, ADR-124; `PUT` and `GET /api/projects/:id/thumbnail`, the project's picture for the home, M14.3, ADR-126; `/api/project`, the user's oldest project outside the trash, is no longer used by the web app), geometries, simulations, meshes, runs, materials, wallet, share links. JSON in and out, validated against the shared schemas.
- **Internal routes** (`/internal/...`): job claim, heartbeat, completion, file transfer. Authenticated by worker token, never by user session.
- **Data-access layer:** every function takes the acting user id and applies `owner_id` filtering. Route handlers do not write SQL.
- **Pre-run validation:** a pure function over the spec and topology that returns a list of problems in plain language (`preRunProblems` in `packages/spec`, ADR-034). The API refuses a run with it before any job is queued, and the UI shows the same list beside the disabled Run button.
- **Billing module:** rate lookup, cost calculation, ledger writes, stop-limit checks on each heartbeat. Physics-critical in the sense that it must be exactly right.
- **Live updates:** the browser polls while a job is active, through one hook (`apps/web/src/jobs/usePolling.ts`, M11.2, ADR-112): first after 2 s, doubling to 30 s while nothing changes, back to 2 s on a change, never sooner than the answer's `retryAfter`, paused in hidden tabs, one request in flight, stopped at a final state. A solving run's check is one GET of the run and one of its log, which says (`more`) whether a second read is needed; a 20-minute solve is about 54 checks (`apps/web/test/usePolling.test.ts`). The polled answers (job, geometry, simulation mesh, run, report) carry the job's `wait`: status, queue position, whether a solver machine is starting, and `retryAfter`. No websockets.
- **Constraints to respect:** Workers have short CPU limits and request-size limits and cannot run native binaries. Large files therefore move directly between the worker container (or browser) and R2 in the cloud, never through a Worker request body.

Authentication in Phase 0 is a seeded user table and a signed session cookie. The session layer is an interface so that real authentication replaces it without touching routes: on the live closed beta Better Auth with Google sign-in sits behind the same `requireUser` (section 11, ADR-095), and the seeded login remains for development and tests.

## 9. Frontend

React, Vite, TypeScript, three.js.

- **Layout:** simulation tree on the left, 3D viewer in the centre, settings panel on the right for the selected tree item, run and status bar along the bottom.
- **Tree items:** geometry, materials, bonds, supports, loads, mesh, runs, and under each run its results and report. Each shows complete, incomplete or error.
- **Viewer:** renders the display mesh with one pickable group per face. Hover highlights a face; click adds it to the active selection. Result mode colours surface nodes from the field arrays with a legend, deformed shape scaling, cut planes and probes. A modal run's mode shape, picked in the Run panel's frequency table, is drawn at a tenth of the model's size and can swing, animated in the vertex shader (ADR-071). Bodies can be hidden in every mode, and the camera, hidden bodies and result display can be saved as named views of the simulation (ADR-055).
- **Quantity input:** one shared component for every physical value (`apps/web/src/units/QuantityInput.tsx`): number field plus unit dropdown, limited to units of the right kind, defaulting to the project system. The system is chosen under the simulation tree.
- **State:** the `SimulationSpec` is the single source of truth for setup. The UI edits it and saves it through the API; nothing about the setup lives only in component state.
- **Desktop only.** Minimum supported width is a laptop screen.

Design direction: quiet and dense enough for engineering work, with the viewer taking most of the screen.

## 10. Security and privacy

- STEP files are untrusted input to a large native parser. The worker container runs as a non-root user, with no network access except the API and storage endpoints, and with CPU, memory and time limits.
- One job at a time per machine in the cloud, each in its own working folder deleted when the job ends. On the closed beta a machine stays 10 minutes after its last job and may take the next user's job (ADR-095 item 7); a fresh machine per job remains the design for a public beta.
- The worker holds no long-lived storage credentials; transfer URLs are scoped to one job and expire.
- Share links carry a random token; only its hash is stored. Since M8.7 (ADR-083) a succeeded run has at most one; it opens the run's results read-only at `/share/<token>` (served by `/api/shared/:token`), never the owner's other records, and a revoked token answers like an unknown one.
- Automated tests prove that user A cannot read, list or modify user B's records or files through any route.
- Secrets come from environment configuration and are never committed.

## 11. Live closed beta (M10)

As decided in ADR-095. Setup steps for the maintainer are in `DEPLOYMENT.md`.

```
 Browser                        Cloudflare: clearfea.triyalabs.com        AWS, one region
+------------------+  HTTPS  +----------------------------------+      +--------------------------+
| landing    /     | <-----> | Worker "clearfea"                |      | ECS cluster on Fargate   |
| workbench  /app  |         |  static assets (web app)         | ---> | standard: 4 vCPU, 16 GB  |
| share /share/... |         |  Hono API /api, /internal        | Run  | large: 8 vCPU, 32 GB     |
+------------------+         |  Better Auth /api/auth (Google)  | Task |   (defined, off)         |
                             |  scheduled handler, each minute  |      | worker image from ECR    |
                             |  D1: records, allowlist, starts  | <--- | claim, heartbeat, done   |
                             |  R2: files                       | <--> | presigned R2 URLs        |
                             +----------------------------------+      +--------------------------+
```

**Request routing.** The Worker's static assets hold the built web app: `/` is the landing page, `/app` the projects home and `/app/p/<id>` a project's workbench (M14.3), `/share/<token>` a shared run; `/api/*` and `/internal/*` run the Worker first. Unknown app paths fall back to the app's page.

**Sign-in** (ADR-097). Better Auth handles `/api/auth/*` with Google as its only provider and D1 for its tables: ClearFEA's own `users` (Google users get their address as login) and `auth_sessions`, `auth_accounts` and `auth_verifications`. Database hooks refuse a user or a session whose verified email is neither `ADMIN_EMAIL` nor on the `allowed_emails` table, and give a new user the sign-up grant (`settings.signup_grant_micro_credits`). `requireUser` reads the Better Auth session and sets `c.var.userId` as before. The admin page (opened from the status bar, admin only) adds and removes allowlist rows, removing a row ends that user's sessions, and lists users with their machine time this month; `/api/admin/*` answers anyone else as an unknown address. `AUTH_MODE=local` (the default) keeps the seeded password login for `make dev`, `make verify` and `make e2e`; the production configuration sets `AUTH_MODE=google`, where the password route refuses. A verification account for live checks signs in with a secret token (M10.9).

**Starting machines** (ADR-100). The launcher (`apps/api/src/launcher/`) runs after a successful request to a route that queues a job (`launchesMachines` in `apps/api/src/jobs/limits.ts`, M11.3, ADR-112), in `waitUntil`, and from the scheduled handler each minute. For each cloud size with queued jobs it starts a machine when no start is pending and no worker of the size made contact in the last 60 seconds, or when the oldest queued job has waited 180 seconds behind busy machines, at most `machine_max_running` at once. It reads the stack's `/clearfea/launch` parameter (cluster, subnets, security group, family per size) from Systems Manager and calls ECS `RunTask` for the family's newest revision with a public IP, adding `CLEARFEA_WORKER_ID=aws-<start id>` and the worker token to the machine's environment; both calls are signed with SigV4 inside the Worker. Each start is a row of `worker_starts` (size, requested at, task ARN or AWS's refusal, first and last contact); the worker's claims and heartbeats write its contact. A start is pending until first contact or `machine_start_wait_seconds`. A queued job fails as a platform fault (`no_machine`, not charged) after three starts since it was queued produced no worker, at once when the site has no launcher key, and when its size is switched off. The monthly machine-hours cap (`settings.machine_hours_cap`, hours from each start to its last contact, UTC months) stops new starts, refuses new runs, reruns and meshes with a plain message, and fails queued jobs no running machine can take (`machine_hours_cap`). The admin page shows the hours, the cap (settable, 0 pauses the solver) and the latest starts.

**Server protections** (M11.3, ADR-112). Jobs run in two lanes, solve (solve jobs) and light (import, mesh, report, no-op). Every route that queues a job first asks `queueRefusal` (`apps/api/src/jobs/limits.ts`), which refuses with 429 and a plain message when the queue holds `queue_total_cap` waiting jobs (20), the user has `queue_waiting_per_user` waiting in the lane (2), or, for a run, the user has queued `runs_per_user_per_day` solve jobs since midnight UTC (30; the verification account is exempt). The check is not atomic with the insert, so two requests at once may pass one job over a limit. A claim passes over a queued job whose owner already has `queue_running_per_user` (1) jobs claimed or running in its lane, so that job waits behind other users' jobs. On the live site `requireUser` counts each signed-in user's requests with the `API_RATE_LIMIT` Workers rate-limiting binding (120 a minute, per Cloudflare location; bound by the production configuration only) and answers 429 with `Retry-After: 60` over it. `stopLimitSeconds` never gives more than 12 hours (`MAX_STOP_SECONDS`).

**The worker on Fargate** (ADR-099). Same image and code as on localhost, with `CLEARFEA_API_URL=https://clearfea.triyalabs.com`, the worker token and its id given by the API when it starts the machine, `CLEARFEA_MACHINE_SIZE` (`medium` for standard, `large`), `CLEARFEA_IDLE_EXIT_SECONDS=600` and `CLEARFEA_MAX_LIFETIME_SECONDS=43200`. Each claim names its size and the API gives it only jobs queued for that size; the default size (standard) also takes the jobs that have no size (import and report; mesh jobs are queued on the default size). It runs one job at a time, exits 10 minutes after its last job, and claims nothing new once it has been up 12 hours, so it exits after the job it holds; ECS then stops the task and billing stops. API errors count as idle time, so a worker that cannot reach the API exits too. Its role has no AWS permissions; it holds only the worker token and the per-job presigned URLs. Ephemeral storage is raised to 50 GiB for raw output.

**The cloud size list** (ADR-099). `machine_sizes.cloud` is `on` for `medium` (standard), `off` for `large`, and null for the sizes only the local worker simulates. With `MACHINES=cloud` (the production configuration) estimates and runs offer only the sizes that are on, and a run asking for one that is off is refused saying so; the admin page switches large on and off, never the default size. Locally (`MACHINES` unset) every size is offered as before and the list changes nothing. Its role has no AWS permissions; it holds only the worker token and the per-job presigned URLs. Ephemeral storage is raised to 50 GiB for raw output.

**VPS mode** (M12.4, ADR-120). With `MACHINES=vps` jobs run on the always-on solver host, whose compute manager checks in through `POST /internal/hosts/check-in` every 30 s (table `hosts`). The launcher does nothing; while no host has checked in for 120 s, every route that queues a job answers 503 and the admin page shows the host offline. The queue position counts the jobs of the job's lane (solve or light), and the wallet shows usage only: no balance refuses work, while metering and the ledger run as before. Sizes are offered as with `MACHINES=cloud`.

**Files.** In production `transfers()` returns presigned R2 S3 URLs (GET for inputs, PUT for outputs, up to 5 GiB each), signed with an R2 API token inside the API (`apps/api/src/jobs/presign.ts`) and valid until the job's stop limit plus an hour, or 24 hours for a job with no stop limit, at most 7 days (ADR-098). Without the R2 token, as under `make dev`, the claim returns the pass-through routes instead. Browser uploads (STEP files up to 100 MB, report figures, logos) stream through the Worker into R2; downloads stream out of R2 through the Worker.

**Deploying.** `.github/workflows/deploy.yml` runs on every push to main, one run at a time:

1. The fast tier (`make test`).
2. Worker image, only when `worker/` or `packages/spec/` changed: build, push to ECR tagged with the commit, register new revisions of both task definitions. Starts after this use the new image; running jobs finish on theirs.
3. Site and API: build the web app, write the production configuration from `wrangler.jsonc` (`deploy:config`, ADR-096), apply D1 migrations (`deploy:migrate`), copy secrets from GitHub to the Worker, `wrangler deploy` (`deploy:worker`).
4. Check that `https://clearfea.triyalabs.com/api/health` reports the new commit.

GitHub authenticates to AWS with an OIDC role and to Cloudflare with an API token. A job-protocol change stays compatible with the previous API or worker for one deploy. Rollback is a redeploy of an earlier commit from the workflow's manual run; D1 Time Travel restores data.

**Costs (closed beta, us-east-1 on-demand, October 2026).** Workers Paid $5 a month; D1 and R2 within the included amounts. Fargate standard about $0.233 an hour of machine time (4 × $0.04048 + 16 × $0.004445), large about $0.466; 20 to 60 machine hours a month is about $5 to $14. ECR storage for ten 2 GB images about $2, logs and public IPv4 time a few cents. No NAT gateway, load balancer or always-on server.

## 12. Later

Not built for the closed beta; the design must not block them.

- **Public beta machines.** A fresh machine per job again, a spot tier (the job model would need a retry after a lost machine), benchmarked limits for large and bigger sizes, and a fast path for light jobs (AWS Lambda running the same image).
- **Staging and previews.** A staging copy of the Worker and D1, and preview URLs for pull requests.
- **Email, payments** replace the remaining stand-ins behind their interfaces.

## 13. Known risks

| Risk | Mitigation |
| --- | --- |
| Face tags drift between import and mesh | Pinned versions, topology comparison on every mesh job, M1 spike |
| Docker unavailable in the development environment | Checked in M0; fallback is running the worker as a plain process with the same code |
| CalculiX direct solver too slow or memory-hungry at the size target | Benchmark task in M2, solver build chosen by data |
| Tied interfaces give poor stresses near bonds | Stated in the report: a run that ties bonds carries the note in `packages/spec/report-notes.json`, with the measured figures, shown under its results and printed by the report (M4.5, ADR-062); verification cases V-11 and V-12 compare bonded bodies with single-body references |
| Remote-load coupling behaves differently from expectation | Dedicated verification cases for force and moment equilibrium and stress distribution |
| Real-world STEP files fail to import or mesh | Collect failing files as test cases (with permission); clear error messages; the beta exists to find these |
| Local R2 and D1 emulation differ from production | Keep storage and database access behind thin interfaces; the live verification run (M10.9) checks the real services |
| A merge breaks the live site for the beta users | The fast tier runs before every deploy; the health check after it; redeploy an earlier commit to roll back; protocol changes stay compatible for one deploy |
| Solver machines left running or a runaway bill | Workers exit after 10 idle minutes and a maximum lifetime; monthly machine-hours cap; AWS Budgets alarm |
