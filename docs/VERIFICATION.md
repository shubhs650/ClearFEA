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
| V-14 | Cylinder wall conduction | Logarithmic profile; heat flow 2πkLΔT/ln(ro/ri) | M5 |
| V-15 | Wall with convection on both sides | Flux ΔT/(1/h₁ + L/k + 1/h₂); surface temperatures | M5 |
| V-16 | Heated plate radiating to ambient | Surface temperature from εσ(T⁴ − T∞⁴) balance | M5 |
| V-17 | Slab with internal heat generation | Centre temperature rise q‴L²/2k | M5 |
| V-18 | Thick cylinder, radial temperature gradient | Closed-form thermal stress (Timoshenko and Goodier) | M5 |
| V-19 | Wall with temperature-dependent conductivity, elasticity and expansion, held sideways between frictionless walls (M5.5) | Flux from conductivity at mean temperature (linear k(T)) and the exact profile; sideways stress −E(T) ε(T)/(1 − ν(T)) from mean expansion coefficients with their own reference temperature; growth of the free face | M5 |
| V-20 | Cantilever beam frequencies | Euler-Bernoulli, first three bending modes | M6 |
| V-21 | Fixed-fixed beam frequencies | Euler-Bernoulli, first two bending modes | M6 |
| V-22 | Unrestrained body | Six rigid-body modes near zero, first elastic mode against reference | M6 |
| V-23 | NAFEMS LE10, thick plate under pressure | Published target stress at point D; take the value from the NAFEMS document when implementing | M3 |
| V-24 | Quarter bar stretched by prescribed end displacements on two symmetry planes | Uniform stress Eδ/L (von Mises, σxx, σ1), strains δ/L and −νδ/L, lateral contraction νεy, end reaction σA; safety factor against yield Sy/σ (M3.5) | M2 |
| V-25 | V-09's quarter tube with its outside on an elastic support (a stiff sleeve) | Lamé with σr(b) = −k u(b): von Mises and radial displacement at the bore and the outside; the sleeve's and the cut planes' reactions | M2 |
| V-26 | V-24's kind of quarter bar pulled by a force on its end, meshed with first-order (four-node) tetrahedra | Uniform stress F/A, end displacement FL/(EA), lateral contraction νεy, start reaction F (exact for four-node tetrahedra) | M2 |

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
| Pressure | V-01, V-23 |
| Remote force and moment | V-04 |
| Hydrostatic pressure | V-05 |
| Gravity | V-10 |
| Centrifugal load | V-06 |
| Uniform temperature change | V-08 |
| Bonded interface (structural) | V-11, V-12; E-03 runs a bonded two-body model through the UI |
| Bonded interface (thermal) | to be added in M5 |
| Steady-state thermal analysis | V-13, V-15, V-16, V-17 (and the heat step of V-18) |
| Fixed temperature | V-13, V-17, V-18, V-14 |
| Heat flux | V-16 |
| Convection | V-15 |
| Radiation to ambient | V-16 |
| Internal heat generation | V-17 |
| Thermal stress | V-18 |
| Temperature-dependent properties | V-19 (conductivity, Young's modulus, Poisson's ratio and expansion tables, M5.5); `worker/spikes/heat_check` checks a conductivity table at every node |
| Modal | V-20, V-21, V-22 |
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
| Mixed input units | all |

### Automatic checks on every case

Besides its own reference values, every case asserts:

- Reactions balance applied loads within 0.1 percent (structural), both as the harness integrates the loads over the run's surface and as the run's own balance check reports them, force and moment (M3.2, ADR-051).
- Heat in equals heat out within 0.1 percent (thermal, since M5.3): the run's own heat balance, and, where the case has a heat flux or heat generation, the heat those bring in against the case's own integration over the run's surface (ADR-066). A steady-state thermal case has no force balance rows, since it has no forces; a thermal stress case (M5.4) gets both the heat and the force balance rows.
- The solver log contains no unexpected warnings.
- Billable seconds were recorded and one ledger entry was written.

## Published results

From M9, the nightly run writes a results page (case, quantity, reference, computed, percentage error, mesh size, software versions) that is published with the documentation and linked from every report.

## Browser end-to-end tests

Playwright drives the real UI against the local system on tiny models. `make e2e` runs them through a fresh API, worker and web dev server of their own (`infra/e2e.sh`, ADR-036); the tests live in `apps/web/e2e`. Faces are picked by moving the pointer over the viewer until it names the wanted face, chosen by its bounding box, so a test does not depend on face numbering or camera framing.

| Test | Covers | Added in |
| --- | --- | --- |
| E-01 | Upload, select face, material, support, pressure, mesh, run, see contour, switch to a principal stress and a strain component, read the reactions, load totals and balance, read the min/max markers and probe a node, cut it across x and y with a cut plane, show the safety factor against yield, save a view and bring it back, show the result in other units after a reload, export CSV and VTK files (`e01-thin-slice.e2e.ts`, a 40 × 20 × 10 mm block) | M1 |
| E-02 | Unit entry in mixed units and display-unit switch | M2 |
| E-03 | Multi-body upload: bodies listed by part name with a material each, the bond found reviewed and shown, a body held only by a removed bond refused before the run, run with the bond tied, reactions balancing the load carried through the bond, the note on stresses near bonded faces, one body hidden in the result view (`e03-multi-body.e2e.ts`, two blocks touching end to end; signs in as the second test user) | M4 (written after the M4 close) |
| E-04 | Thermal stress setup: the analysis type and its stress-free temperature, a material with elastic and thermal values and, since M5.5, conductivity and Young's modulus tables against temperature, a fixed support, a fixed temperature and convection; run, see the von Mises stress on the deformed shape, the highest and lowest temperature, each fixed temperature's heat flow and the heat balance, draw the temperature of the same result and find both the reactions and the heat flows exports (`e04-thermal-stress.e2e.ts`, E-01's block, hot top and cold fixed end; signs in as the second test user) | M5 (M5.4, M5.5) |
| E-05 | Report generation and download | M7 |
| E-06 | Cancel a running job; stop limit reached | M8 |
| E-07 | Second user cannot open first user's project or share-revoked link | M8 |

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

## Benchmarks

Separate from correctness. A fixed set of meshes of one block, each solver up to the memory a 16 GB machine allows (ADR-063), records the solve job's step times and the solver's peak memory per solver option and element order (`worker/benchmarks/solver/steps.py`). The estimator is fitted to these numbers, and gate condition 3 (estimate accuracy) is measured on them.
