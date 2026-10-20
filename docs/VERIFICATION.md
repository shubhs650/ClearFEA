# Verification and testing

How ClearFEA shows that its answers are right, and which tests run when.

CalculiX is well tested. ClearFEA adds layers where errors can enter: unit conversion, load translation, bonded interfaces and result processing. A mistake in those layers produces a plausible picture and no error message, so each one is checked against known answers.

## Test tiers

| Tier | Runs | Contains | Target time |
| --- | --- | --- | --- |
| Fast | Every pull request, and locally with `make test` | Unit tests, deck snapshot tests, units fixture tests, type checks, lint | Under 5 minutes |
| Nightly | Locally with `make verify` and `make e2e`; not scheduled in CI (ADR-037) | All verification cases on coarse meshes, all browser end-to-end tests | Under 45 minutes |
| Phase end | In CI when a milestone tag such as `m1-complete` is pushed, by hand from the Actions tab, and on pull requests that change the workflow or its scripts (`.github/workflows/phase-end.yml`, ADR-037) | All verification cases on the full tier and all browser end-to-end tests | Under an hour |
| Full | Before a milestone closes (the phase-end run), and after any Gmsh or CalculiX version change (`VERIFY_TIER=full`) | All verification cases on fine meshes with tight tolerances, large-model benchmarks | As long as it takes |

Rules:

- A milestone closes, once its tasks have merged, on a green phase-end run on `main`: started by pushing an `m<N>-complete` tag, or by hand from the Actions tab on `main` at the full tier, with the run linked in `docs/PROGRESS.md`. A red run is fixed before the next milestone starts, and the run is repeated on the fixing commit.
- A red phase-end or local verification run is fixed before new feature work.
- Before opening a pull request that touches a physics-critical module, run the affected cases locally and paste the result table into the description.
- Tolerances are never loosened to make a case pass without a written reason in the case file.
- Data isolation between users (M8.8) is tested in the fast tier by `apps/api/test/isolation.test.ts`. Every route the API serves must have a row in its `ROUTES` table, so a new route fails `make test` until the sweep covers it.

## Deck snapshot tests

For each verification case and for a set of small synthetic specs, the generated CalculiX input is compared with a stored known-good file. No solver runs. This catches most load-translation and unit errors in milliseconds.

A snapshot may be updated only when the pull request explains why the new deck is correct.

## Verification cases

Each case runs through the full platform path: the harness uploads a STEP file to the API, creates a simulation from a spec, meshes, solves, and reads the result summary. The browser UI is not involved; end-to-end tests cover that separately.

### Case layout

```
verification/cases/V-01-thick-cylinder/
  case.yaml        id, title, analysis type, features covered, named faces, mesh size per tier, checks, tolerances per tier
  geometry.py      script that builds the STEP file (no binary files in the repository)
  spec.json        SimulationSpec, faces by name, with values in deliberately mixed units
  reference.md     derivation of the reference values with source
```

Each check in `case.yaml` names a quantity, where it is evaluated (a face and a box on it), the reference value and the tolerance for the coarse and full tiers. Faces are named by their bounding box, never by tag. The full format is in `verification/README.md`; the harness is ADR-035. Specs use mixed input units on purpose (for example pressure in bar, length in mm, force in kN) so that unit conversion is exercised in every case.

Stress is checked away from supports and load application points unless the case is specifically about a concentration.

### Case list

| Id | Case | Reference | Added in |
| --- | --- | --- | --- |
| V-01 | Thick cylinder, internal pressure, one end fixed and one open | Lamé (open ends): von Mises stress and radial displacement at the bore and the outside; hoop stress as σ1, shear stress and tensor shear strain at 45° (M3.1) | M1 |
| V-02 | Cantilever, end load: a force on an end patch of the top face (a pressure until M2.3) | Timoshenko beam: tip deflection under the patch load, bending stress at mid-length; clamp reaction | M1 |
| V-03 | Plate with central hole in tension: an eighth on three symmetry planes (ν = 0), d/W = 0.1, a local mesh size on the hole | Kirsch factor 3 for a wide plate, with Howland's finite-width correction (Ktg = 3.025): peak stress at the side of the hole; uniform stress at the pulled end | M2 |
| V-04 | Remote force and moment on a round stub: an axial force through a point off the axis, a torque and a bending moment | Saint-Venant extension, bending and torsion: von Mises on top, underneath and on the side along the middle, which carry the remote point's lever; clamp reaction equals the force; the clamp's reaction moment about its centre (torque and bending with the point's lever, M3.2) | M2 |
| V-05 | Tank wall strip clamped at its base, water against one side up to 100 mm below its top (ν = 0) | Base reaction ρ g b H²/2 (ρg × depth-weighted area); bending stress from the cubic moment ρ g b (H − z)³/6 at two depths; top deflection of a cantilever under a triangular load | M2 |
| V-06 | Thin rotating ring: a quarter on three symmetry planes | Plane stress rotating disc (hoop stress ρω²r² in the thin limit): hoop stress and radial growth on both faces; hoop force ρω²t(b³ − a³)/3 across each cut | M2 |
| V-07 | Block on an elastic support, pressed by a force on its top, sliding stopped by two symmetry planes | Base settlement F/(k·A), top displacement adding F·H/(E·A), uniform stress F/A, foundation reaction F | M2 |
| V-08 | Bar with ends restrained (frictionless ends, two symmetry planes), uniform temperature rise | Axial stress −EαΔT (von Mises, σxx, σ3 and end reactions ±EαΔT·A); sideways growth and total strain (1 + ν)αΔT | M2 |
| V-09 | Symmetry model against full model: a quarter of V-01's tube on leaning symmetry planes and a frictionless base | Quarter model results equal the full tube's Lamé values; hoop force p·a·L on each cut plane | M2 |
| V-10 | Column under self-weight, standing on a fixed base | Base reaction equals weight; stress ρg(h − z) on the side and, from the values at every node, inside at a quarter of the height (M3.4); top shortening ρgh²/2E | M2 |
| V-11 | Two bonded blocks against one block: V-02's cantilever cut across at x = 3 in into two bodies, the root block meshed finer | V-02's single-body Timoshenko values: tip deflection, bending stress 2 in past the bond, clamp reaction through the bond | M4 |
| V-12 | Bi-material bar in tension: a quarter of a bar of two materials with the same ν/E bonded end to end, on symmetry planes crossing the bond, meshed differently each side | Series stiffness: end displacement σ(L1/E1 + L2/E2); uniform stress F/A and strain σ/E in each body; equal sideways contraction; end reaction | M4 |
| V-13 | Plane wall conduction | Linear temperature profile; flux kΔT/L | M5 |
| V-14 | Cylinder wall conduction: a quarter of a thick tube, hot bore, cool outside | Logarithmic profile at three radii; radial heat flux; heat flow 2πkLΔT/ln(ro/ri) in at the bore and out at the outside | M5 (written with M5.6) |
| V-15 | Wall with convection on both sides | Flux ΔT/(1/h₁ + L/k + 1/h₂); surface temperatures | M5 |
| V-16 | Heated plate radiating to ambient | Surface temperature from εσ(T⁴ − T∞⁴) balance | M5 |
| V-17 | Slab with internal heat generation | Centre temperature rise q‴L²/2k | M5 |
| V-18 | Thick cylinder, radial temperature gradient | Closed-form thermal stress (Timoshenko and Goodier) | M5 |
| V-19 | Wall with temperature-dependent conductivity, elasticity and expansion, held sideways between frictionless walls (M5.5) | Flux from conductivity at mean temperature (linear k(T)) and the exact profile; sideways stress −E(T) ε(T)/(1 − ν(T)) from mean expansion coefficients with their own reference temperature; growth of the free face | M5 |
| V-20 | Cantilever beam frequencies | Euler-Bernoulli, first three bending modes in the stiff direction and first two in the other (800 × 16 × 8 mm steel bar, M6.1), and three mode shapes at mid-span (M6.2) | M6 |
| V-21 | Fixed-fixed beam frequencies | Euler-Bernoulli, first two bending modes in one direction and the first in the other (the same bar, both ends fixed, M6.1) | M6 |
| V-22 | Unrestrained body | Six rigid-body modes near zero (within 0.1 % of mode 7), first two elastic modes against the free-free beam (the same bar, no supports, SPOOLES, M6.1) | M6 |
| V-23 | NAFEMS LE10, thick plate under pressure | Published target stress at point D; take the value from the NAFEMS document when implementing. **Not built**: listed for M3 but no task in `PLAN.md` made it, found at Close M9 (2026-10-20); its supports include a line on an edge, which ClearFEA does not offer, so building or dropping it is the maintainer's decision | M3 |
| V-24 | Quarter bar stretched by prescribed end displacements on two symmetry planes | Uniform stress Eδ/L (von Mises, σxx, σ1), strains δ/L and −νδ/L, lateral contraction νεy, end reaction σA; safety factor against yield Sy/σ (M3.5) | M2 |
| V-25 | V-09's quarter tube with its outside on an elastic support (a stiff sleeve) | Lamé with σr(b) = −k u(b): von Mises and radial displacement at the bore and the outside; the sleeve's and the cut planes' reactions | M2 |
| V-26 | V-24's kind of quarter bar pulled by a force on its end, meshed with first-order (four-node) tetrahedra | Uniform stress F/A, end displacement FL/(EA), lateral contraction νεy, start reaction F (exact for four-node tetrahedra) | M2 |
| V-27 | Two-layer tube wall: a quarter of a tube of two bonded bodies of different conductivity, the outer one meshed finer, hot bore, cool outside (M5.6) | Composite cylinder in series: logarithmic profile in each layer, the bond temperature on both sides, radial heat flux in each layer, heat flow (π/2) L ΔT / Σ ln(r_out/r_in)/k in and out | M5 |

More published benchmarks (NAFEMS thermal and free-vibration sets) are added as their feature lands. Reference values from publications are cited in `reference.md` and never copied wholesale.

### Coverage matrix

Every gate feature must appear in at least one case. Update this table in the same pull request that adds a feature.

| Feature | Cases |
| --- | --- |
| Fixed support | V-01, V-02, V-04, V-05, V-10 |
| Prescribed displacement | V-24, V-12 |
| Frictionless / symmetry support | V-09, V-24, V-06, V-07, V-08, V-25, V-03, V-26 |
| Elastic support | V-07, V-25 |
| Force | V-02, V-12, V-03, V-26 |
| Pressure | V-01, V-09, V-25; acceptance case A (V-23 is not built) |
| Remote force and moment | V-04 |
| Hydrostatic pressure | V-05 |
| Gravity | V-10 |
| Centrifugal load | V-06 |
| Uniform temperature change | V-08 |
| Bonded interface (structural) | V-11, V-12; E-03 runs a bonded two-body model through the UI |
| Bonded interface (thermal) | V-27 (M5.6); `worker/spikes/heat_check` checks a two-body bar at every node, as heat transfer and as thermal stress, and a fixed temperature next to the bond; E-03 runs its bonded model as a thermal stress analysis |
| Steady-state thermal analysis | V-13, V-14, V-15, V-16, V-17, V-27 (and the heat step of V-18) |
| Fixed temperature | V-13, V-17, V-18, V-14, V-27 |
| Heat flux | V-16 |
| Convection | V-15 |
| Radiation to ambient | V-16 |
| Internal heat generation | V-17 |
| Thermal stress | V-18 |
| Temperature-dependent properties | V-19 (conductivity, Young's modulus, Poisson's ratio and expansion tables, M5.5); `worker/spikes/heat_check` checks a conductivity table at every node |
| Modal | V-20, V-21, V-22 (M6.1; all on SPOOLES since M6.3, ADR-072); `worker/spikes/modal_check` solves the same three bars at 4 mm and 2 mm |
| Mode shapes | V-20 (M6.2: first and second bending modes at mid-span, scaled and signed as ADR-071 says); `worker/spikes/modal_check` checks the same three |
| Modal with no support (rigid-body modes) | V-22 |
| Heat flux results | V-13, V-15, V-16, V-17 (heat flux along the wall, M5.3) |
| Heat flows and heat balance check | V-13, V-15, V-16, V-17 (each load's heat flow), V-18; the run's own heat balance on every thermal case (M5.3) |
| Reaction balance check | V-04, V-05, V-06, V-07, V-08, V-10, V-25, V-03, V-26; the run's own balance check, force and moment, on every case (M3.2) |
| Reaction moments | V-04 |
| Local mesh refinement | V-03 |
| First-order elements | V-26 |
| Stress components | V-01, V-08, V-24 |
| Principal stresses | V-01, V-08, V-24 |
| Values inside the body (cut planes) | V-10; E-01 draws a cut |
| Strain components (total strain, tensor shear) | V-01, V-08, V-24 |
| Safety factor against yield | V-24; E-01 shows it |
| Hidden bodies and saved views (display only) | E-01 saves a view and brings it back; viewer unit tests hide bodies |
| CSV and VTK export (stored values, no new physics) | E-01 downloads the node and reaction CSV and the VTK file and checks them against the run's figures; web unit tests check columns, units and the VTK node order |
| Report options (sections, views, title block, company name, logo; no physics) | E-01 sets them with a generated PNG logo, reloads and finds them kept; API and web unit tests check the defaults, section order, view checks, logo checks and owner scoping |
| Report figures (drawn in the browser; no physics) | E-01 draws the support, pressure and cut σ1 view figures, reloads, finds them listed in order and fetches each PNG; API tests check storage, replacement, item checks, PNG and size checks and owner scoping; web unit tests check which figures a report needs, captions, framing and load arrows |
| Word report (stored values printed in the report's units; no new physics) | E-05 makes one through the UI and reads the downloaded DOCX; worker tests check what static, thermal and modal reports print, in two unit systems, and the DOCX layout; API tests check the frozen parameters, transfers and owner scoping |
| PDF report (the Word report printed by LibreOffice; no new physics) | E-05 downloads it through the UI and checks its pages, title and section bookmarks against the DOCX's headings; worker tests check the conversion (a stand-in LibreOffice in the fast tier, the real one where installed); API tests check the download and owner scoping |
| Storage, retention, pins and rerun (no physics; billing: storage charge) | API tests measure storage by kind per user, pin and unpin, run the daily sweep (expired, pinned and recent runs; viewer files kept; idempotent), charge storage above the allowance once a day with the ledger adding up exactly, and rerun a run's frozen setup on its mesh; unit tests check the storage charge's rounding and sizes past 2^53; web tests cover the Run panel's raw output section and the wallet's storage section (ADR-086) |
| Mixed input units | all; E-02 enters them through the UI |

### Automatic checks on every case

Besides its own reference values, every case asserts:

- Reactions balance applied loads within 0.1 percent (structural), both as the harness integrates the loads over the run's surface and as the run's own balance check reports them, force and moment (M3.2, ADR-051).
- Heat in equals heat out within 0.1 percent (thermal, since M5.3): the run's own heat balance, and, where the case has a heat flux or heat generation, the heat those bring in against the case's own integration over the run's surface (ADR-066). A steady-state thermal case has no force balance rows, since it has no forces; a thermal stress case (M5.4) gets both the heat and the force balance rows.
- A modal case (M6.1) has no balance rows, since it has no loads; it checks that the run found the number of modes asked for.
- The solver log contains no unexpected warnings.
- Billable seconds were recorded and one ledger entry was written.

Once over the whole run (M8 exit): the harness user's ledger reconciles exactly. Every running balance is the previous one plus its entry, the wallet's balance is the sum of the ledger, every job charge is its billed seconds at its rate as the platform prices it, every charged run has one entry for exactly the cost its record shows, and no entry other than the seeded grant lacks a job (`verification/harness/ledger.py`, ADR-090). These rows appear in the result table as case "Ledger".

## Published results

[VERIFICATION_RESULTS.md](VERIFICATION_RESULTS.md) lists, for every case and check, the reference, the computed value, the percentage error, the tolerance, the mesh size and the software versions (M9.7, ADR-092). Every report links to it. It is published with the documentation in the repository and states numbers only, with no verdict wording.

It is written by `python -m harness.page` (run from `verification/`) from result tables kept in `verification/results/`, each named with its run in `sources.json`:

- `suite.md`: the verification cases from the phase-end run that closed the latest milestone (ADR-037). To refresh it, download that run's log from the Actions tab and run `python -m harness.page --from-log LOG --to results/suite.md`.
- `acceptance.md`: the two acceptance cases, which the phase-end run does not run, from a local `VERIFY_TIER=full CASES="A B" make verify` (its `results.md`).

Then update `sources.json` and run `python -m harness.page`. `make test` fails when the committed page is not what the committed tables give.

## Browser end-to-end tests

Playwright drives the real UI against the local system on tiny models. `make e2e` runs them through a fresh API, worker and web dev server of their own (`infra/e2e.sh`, ADR-036); the tests live in `apps/web/e2e`. Faces are picked by moving the pointer over the viewer until it names the wanted face, chosen by its bounding box, so a test does not depend on face numbering or camera framing.

| Test | Covers | Added in |
| --- | --- | --- |
| E-01 | Upload, select face, material, support, pressure, mesh, run, see contour, switch to a principal stress and a strain component, read the reactions, load totals and balance, read the min/max markers and probe a node, cut it across x and y with a cut plane, show the safety factor against yield, save a view and bring it back, show the result in other units after a reload, export CSV and VTK files, set the report options with a logo and find them kept after a reload (`e01-thin-slice.e2e.ts`, a 40 × 20 × 10 mm block) | M1 |
| E-02 | Unit entry in mixed units: the US unit system on a millimetre STEP file, each empty field offering the system's unit, Young's modulus in GPa, yield strength in ksi, a pressure in MPa, a force in lbf and the mesh size in mm, each kept as typed through a reload and a change of system; the deck's modulus in Pa, and the load totals and reaction in lbf, then N, against the typed values converted with `units.json`. The display-unit switch is E-01's since M3.7 (`e02-mixed-units.e2e.ts`, E-01's block; signs in as the first test user after E-01) | M2 (written during M6) |
| E-03 | Multi-body upload: bodies listed by part name with a material each, the bond found reviewed and shown, a body held only by a removed bond refused before the run, run with the bond tied, reactions balancing the load carried through the bond, the note on stresses near bonded faces, one body hidden in the result view, then the same setup as a thermal stress analysis whose heat crosses the bond (M5.6) (`e03-multi-body.e2e.ts`, two blocks touching end to end; signs in as the second test user) | M4 (written after the M4 close) |
| E-04 | Thermal stress setup: the analysis type and its stress-free temperature, a material with elastic and thermal values and, since M5.5, conductivity and Young's modulus tables against temperature, a fixed support, a fixed temperature and convection; run, see the von Mises stress on the deformed shape, the highest and lowest temperature, each fixed temperature's heat flow and the heat balance, draw the temperature of the same result and find both the reactions and the heat flows exports (`e04-thermal-stress.e2e.ts`, E-01's block, hot top and cold fixed end; signs in as the second test user) | M5 (M5.4, M5.5) |
| E-05 | Report generation and download: a block set up and solved through the UI, a saved stress view, the title block filled in, "Make the report" drawing the three figures and the worker making the DOCX and its PDF, both downloads named from the title block, the DOCX read back for its cover, its twelve numbered sections in order, its figure captions and pictures and the absence of any verdict, and the PDF for its pages, title and the same twelve sections in its bookmarks (`e05-report.e2e.ts`) | M7 |
| E-06 | Cancel a running job; stop limit reached. Since M8.2: bob sets up the E-01 block at 1 mm, quadratic, on SPOOLES (about two minutes of solving), runs it, sees the stage, the elapsed time ticking against the estimate, the cost so far against the estimated cost and the live log, cancels it, sees "Cancelling…", then the run cancelled with its charge, its deck and log kept, and the charge in the wallet. Since M8.3 the same simulation then runs again with its stop limit at 0.25 × the estimate (the 30 s floor; the run takes about a minute in the worker container): bob sees the limit's time in the form and the running view, the run is stopped there and says so with its charge, its record shows the limit, and the wallet lists it as stopped at its limit (`e06-running-job.e2e.ts`, ADR-085, ADR-087) | M8 (M8.2, M8.3) |
| E-07 | Second user cannot open first user's project or share-revoked link: alice solves a block as in E-01 and makes a read-only link to the run; a browser that is not signed in opens it and sees the results and nothing to change; bob, signed in, gets 404 for alice's geometry, simulation, run and its share link; alice revokes the link and the same browser is told it does not work (`e07-share-link.e2e.ts`, ADR-083) | M8 (M8.7) |
| E-08 | Sign-in and the admin page of the live closed beta: the sign-in screen as the live site shows it (only Sign in with Google), an address that is not invited told so, alice (the admin locally) inviting two addresses, seeing them and the users listed and removing them, switching the large machine size on and off with the default size held on (M10.6), setting the monthly machine-hours limit and seeing that no machine is started locally (M10.7), and bob seeing no Admin with the admin routes answering him 404. Real Google sign-in is checked on the live site (`e08-admin.e2e.ts`, ADR-097, ADR-099, ADR-100) | M10 (M10.3, M10.6, M10.7) |

## Acceptance cases

Run at the end of Phase 0 (M9). They are judged by the maintainer, not automated, though each is also kept as a regression model afterwards.

**A. Nozzle-to-shell junction.** Cylindrical shell section, nozzle and reinforcing pad as three bonded bodies. Internal pressure with end thrust, external force and moment on the nozzle end as a remote load, symmetry or end restraints.

**B. Thermal stress.** A thick component with a hot inside and a cooler outside: steady thermal run with convection, then a static run on that temperature field with temperature-dependent properties.

Checks for each:

1. Completed start to finish in the UI on the laptop, with no file touched by hand.
2. Reaction balance closes.
3. Stress away from discontinuities agrees with hand calculation (membrane stress for A, closed-form through-wall values for B).
4. Local stresses for A compared with a WRC-style calculation, with the difference noted, since the two methods are known to differ.
5. The same model set up independently in FreeCAD's FEM workbench agrees within the working tolerance (5 percent on a matching mesh).
6. The report is one the maintainer would hand to a reviewer.

Both models must be original geometry created for this project, so they can be published in the repository.

The models are in `verification/acceptance/` (M9.4), each a case folder with its geometry script, setup and a `model.md` giving the design and what the hand checks can use: `A-nozzle-on-shell` (a shell of 600 mm inside diameter and 10 mm wall with a nozzle of 166 mm outside diameter and a 330 mm pad, 2 MPa with end thrusts, a piping load on the nozzle, one end held) and `B-flanged-pipe-thermal` (a quarter of a flanged spool with a 50 mm wall, 280 °C fluid inside and cooling outside, temperature-dependent properties, on symmetry planes). `CASES="A B" make verify` runs them; the default suite does not. Case A's six checks were done in M9.5 and are written up in `verification/acceptance/A-nozzle-on-shell/hand_checks.md`, with the WRC-style calculation (`wrc_style.py`), the FreeCAD model (`freecad_model.py`) and the script that compares result files (`compare.py`) beside it. Case B's were done in M9.6 and are written up in `verification/acceptance/B-flanged-pipe-thermal/hand_checks.md`, with the through-wall solution (`through_wall.py`), its FreeCAD model and its comparison script beside it.

## Benchmarks

Separate from correctness. A fixed set of meshes of one block, each solver up to the memory a 16 GB machine allows (ADR-063), records the solve job's step times and the solver's peak memory per solver option and element order (`worker/benchmarks/solver/steps.py`). The estimator is fitted to these numbers, and gate condition 3 (estimate accuracy) is measured on them: `worker/benchmarks/solver/check.py` (M8.9, ADR-081) prices every row as the platform prices a run and requires the estimated cost within 30 percent of the measured cost, or within one billed second, and `make test` runs it. On estimator version 5 all 69 rows pass: linear static PaStiX −14 to +15 percent, SPOOLES −9 to +11, iterative Cholesky −9 to +9, iterative scaling −13 to +24, and modal SPOOLES −14 to +50 percent, the +50 being one second on a 2-second run. `make verify` lists each case's estimated and billed solve seconds beside its result, as information only: CI machines are not the benchmark machine.
