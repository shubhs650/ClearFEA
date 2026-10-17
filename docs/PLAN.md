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
| M9 | Gate | Size targets, laptop verification, acceptance cases, outside trial |

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

- [ ] M7.1 Report options: sections, saved views, title block, company name, logo.
- [ ] M7.2 Figure capture in the browser: one per load and support, plus selected result views.
- [ ] M7.3 DOCX assembly with all sections in `DECISIONS.md`.
- [ ] M7.4 PDF output matching the DOCX.
- [ ] M7.5 Standing statements: analysis-tool positioning, versions, verification link, tied-interface note. No verdict wording anywhere.
- [ ] M7.6 Values printed in the report's chosen unit system.

**Exit:** the maintainer would hand the report for a verification case to a reviewer.

## M8: Platform

- [ ] M8.1 Wallet page: balance, ledger, per-run cost.
- [ ] M8.2 Running-job view: stage, elapsed time, cost so far against estimate, live log, cancel.
- [ ] M8.3 Stop limit per run with a default multiplier and user override.
- [ ] M8.4 Failure classification end to end, with category and reason shown on the run.
- [ ] M8.5 Simulated machine sizes on localhost (thread count, memory limit); out-of-memory path tested.
- [ ] M8.6 Storage accounting per user, free quota, retention of raw output, pin, regenerate by rerun.
- [ ] M8.7 Read-only share link per run, revocable.
- [ ] M8.8 Data isolation tests across every route and file key.
- [ ] M8.9 Estimator check: predicted against measured on the benchmark set.
- [ ] M8.10 Self-hosting mode flag: wallet informational.

**Exit:** ledger reconciles exactly over the full verification suite; isolation tests pass.

## M9: Gate

- [ ] M9.1 Run a model at each solver's element limit (ADR-063) in the development environment; fix what breaks. (The 2-million-element target was dropped by ADR-063.)
- [ ] M9.2 Set up and run on the laptop; demonstrate the laptop tier; fix viewer performance.
- [ ] M9.3 User guide for the main flow; self-hosting instructions.
- [ ] M9.4 Build the two acceptance models as original geometry that can be published.
- [ ] M9.5 Acceptance case A: nozzle, shell and pad under pressure and nozzle loads. Hand checks and FreeCAD FEM comparison.
- [ ] M9.6 Acceptance case B: thermal stress. Hand checks and FreeCAD FEM comparison.
- [ ] M9.7 Publish the verification results page.
- [ ] M9.8 Outside trial: two or three engineers complete the tutorial case unaided over a screen share; fix the top problems found.
- [ ] M9.9 Walk the "Phase 0 is done when" checklist in `DECISIONS.md` and record the outcome.

**Exit:** all eight gate conditions met.

## After Phase 0

Not planned in detail yet. In order: shells, face splitting, stress linearisation, run comparison, geometry revisions, nonlinear milestone. Phase 1 (cloud beta) planning starts when M8 is complete: deployment to Cloudflare, machine launch on AWS, real authentication, guided overlay, email notifications, beta recruitment.

## Working method

- One task is one branch and one pull request where practical.
- A task is complete when its code is merged, its tests exist, and `PROGRESS.md` is updated.
- If a task turns out much larger than expected, stop, split it in this file, and note why in `PROGRESS.md`.
- Milestones close only after a full verification run and a full end-to-end run are green.
