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
- Confirm Docker runs in the Claude Code cloud environment and on the laptop.
- Free storage quota, retention period, machine size list and rates: configuration values, set from benchmark and beta data.
- Lawyer review of terms of service before real payments are taken.

---

## Architecture decision records

Add new records at the bottom. Format: number, date, status (proposed, accepted, superseded), decision, reason. Records marked **proposed** were chosen by Claude during kickoff and await the maintainer's confirmation; treat them as the working assumption until changed.

### ADR-001: Monorepo with three deployable parts
2026-10-13 · proposed

`apps/web` (frontend), `apps/api` (Cloudflare Worker), `worker` (Python container), plus `packages/spec` for shared schemas. One repository keeps the spec, the deck generator and the UI in step.

### ADR-002: Gmsh as both geometry importer and mesher
2026-10-13 · proposed

Gmsh, through its OpenCASCADE kernel, reads the STEP file, supplies the display tessellation and produces the mesh. One tool owns face identity from import to mesh, which is the riskiest chain in the product. Gmsh is GPL, compatible with AGPL.

### ADR-003: SI base units as the internal system
2026-10-13 · proposed

All stored and solved quantities are in m, kg, s, K. Gmsh converts STEP geometry to metres at import. One rule with no exceptions is easier to keep correct than a mm-tonne system. Entered values are stored with their unit as typed; conversion uses one shared table.

### ADR-004: Jobs table with a claim API instead of a managed queue
2026-10-13 · proposed

Jobs live in D1. The worker claims work over HTTPS from the API. This behaves identically on localhost and in the cloud, and avoids depending on local emulation of Cloudflare Queues. A managed queue may still trigger machine launches in Phase 1.

### ADR-005: Worker moves files through transfer URLs issued by the API
2026-10-13 · proposed

The worker never holds storage credentials. For each job the API issues upload and download URLs. Locally these point at API pass-through endpoints; in the cloud they are presigned R2 URLs, which avoids Worker body-size limits.

### ADR-006: SimulationSpec as a versioned JSON document
2026-10-13 · proposed

A simulation's setup is one JSON document validated by JSON Schema in `packages/spec`. TypeScript types and Pydantic models are generated from the schema. Runs store a frozen copy.

### ADR-007: React, Vite, TypeScript and three.js for the frontend
2026-10-13 · proposed

Widely used, well supported by Claude Code, and three.js is sufficient for surface rendering with per-face picking.

### ADR-008: Hono on Cloudflare Workers with D1 and R2
2026-10-13 · proposed

Matches the deployment target in the brief. Wrangler's local mode provides D1 and R2 on localhost.

### ADR-009: Python for the worker
2026-10-13 · proposed

Gmsh has a first-class Python API, and Python has mature libraries for numerical work and document generation.

### ADR-010: Start with the distribution CalculiX build; choose the production solver build by benchmark
2026-10-13 · proposed

Milestone M1 uses a packaged `ccx` (SPOOLES). A benchmark task in M2 compares SPOOLES, PaStiX and the iterative solver for speed and memory, then fixes the build for the 2-million-element target. Building CalculiX with PaStiX is known to be fiddly, so it is isolated as its own task.

### ADR-011: Report figures are captured in the browser
2026-10-13 · proposed

Report pictures are rendered by the same three.js viewer and uploaded as images when the user generates a report. One renderer keeps reports consistent with what the user saw. The cost is that report generation needs the browser open.
