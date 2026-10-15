# Verification and testing

How ClearFEA shows that its answers are right, and which tests run when.

CalculiX is well tested. ClearFEA adds layers where errors can enter: unit conversion, load translation, bonded interfaces and result processing. A mistake in those layers produces a plausible picture and no error message, so each one is checked against known answers.

## Test tiers

| Tier | Runs | Contains | Target time |
| --- | --- | --- | --- |
| Fast | Every pull request, and locally with `make test` | Unit tests, deck snapshot tests, units fixture tests, type checks, lint | Under 5 minutes |
| Nightly | Every night on `main`, and locally with `make verify` and `make e2e` | All verification cases on coarse meshes, all browser end-to-end tests | Under 45 minutes |
| Full | Before a milestone closes, and after any Gmsh or CalculiX version change (`VERIFY_TIER=full`) | All verification cases on fine meshes with tight tolerances, large-model benchmarks | As long as it takes |

Rules:

- A red nightly run is fixed before new feature work.
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
| V-01 | Thick cylinder, internal pressure, one end fixed and one open | Lamé (open ends): von Mises stress and radial displacement at the bore and the outside | M1 |
| V-02 | Cantilever, end load (in M1 a pressure on an end patch of the top face) | Timoshenko beam: tip deflection under the patch load, bending stress at mid-length | M1 |
| V-03 | Plate with central hole in tension | Kirsch factor 3 for a wide plate, with finite-width correction | M2 |
| V-04 | Remote force and moment on a stub | Reactions equal the applied force and moment; bending stress at mid-length from beam theory | M2 |
| V-05 | Tank wall, hydrostatic pressure | Total reaction equals ρg × depth-weighted area; pressure at depth | M2 |
| V-06 | Thin rotating ring | Hoop stress ρω²r² | M2 |
| V-07 | Block on elastic support | Displacement F/(k·A) | M2 |
| V-08 | Bar with ends restrained, uniform temperature rise | Axial stress −EαΔT | M2 |
| V-09 | Symmetry model against full model | Quarter model results equal full model | M2 |
| V-10 | Column under self-weight | Base reaction equals weight; stress ρgh | M2 |
| V-11 | Two bonded blocks against one block | Displacement and stress away from the interface match the single body | M4 |
| V-12 | Bi-material bar in tension | Series stiffness; uniform stress | M4 |
| V-13 | Plane wall conduction | Linear temperature profile; flux kΔT/L | M5 |
| V-14 | Cylinder wall conduction | Logarithmic profile; heat flow 2πkLΔT/ln(ro/ri) | M5 |
| V-15 | Wall with convection on both sides | Flux ΔT/(1/h₁ + L/k + 1/h₂); surface temperatures | M5 |
| V-16 | Heated plate radiating to ambient | Surface temperature from εσ(T⁴ − T∞⁴) balance | M5 |
| V-17 | Slab with internal heat generation | Centre temperature rise q‴L²/2k | M5 |
| V-18 | Thick cylinder, radial temperature gradient | Closed-form thermal stress (Timoshenko and Goodier) | M5 |
| V-19 | Wall with temperature-dependent conductivity | Flux from conductivity at mean temperature (linear k(T)) | M5 |
| V-20 | Cantilever beam frequencies | Euler-Bernoulli, first three bending modes | M6 |
| V-21 | Fixed-fixed beam frequencies | Euler-Bernoulli, first two bending modes | M6 |
| V-22 | Unrestrained body | Six rigid-body modes near zero, first elastic mode against reference | M6 |
| V-23 | NAFEMS LE10, thick plate under pressure | Published target stress at point D; take the value from the NAFEMS document when implementing | M3 |

More published benchmarks (NAFEMS thermal and free-vibration sets) are added as their feature lands. Reference values from publications are cited in `reference.md` and never copied wholesale.

### Coverage matrix

Every gate feature must appear in at least one case. Update this table in the same pull request that adds a feature.

| Feature | Cases |
| --- | --- |
| Fixed support | V-01, V-02, V-03 |
| Prescribed displacement | V-12 |
| Frictionless / symmetry support | V-01, V-09 |
| Elastic support | V-07 |
| Force | V-02, V-12 |
| Pressure | V-01, V-23 |
| Remote force and moment | V-04 |
| Hydrostatic pressure | V-05 |
| Gravity | V-10 |
| Centrifugal load | V-06 |
| Uniform temperature change | V-08 |
| Bonded interface (structural) | V-11, V-12 |
| Bonded interface (thermal) | to be added in M5 |
| Fixed temperature | V-13, V-14 |
| Heat flux | V-16 |
| Convection | V-15 |
| Radiation to ambient | V-16 |
| Internal heat generation | V-17 |
| Thermal stress | V-18 |
| Temperature-dependent properties | V-19 |
| Modal | V-20, V-21, V-22 |
| Reaction balance check | V-04, V-05, V-10 |
| Local mesh refinement | V-03 |
| First-order elements | to be added in M2 |
| Mixed input units | all |

### Automatic checks on every case

Besides its own reference values, every case asserts:

- Reactions balance applied loads within 0.1 percent (structural).
- Heat in equals heat out within 0.1 percent (thermal).
- The solver log contains no unexpected warnings.
- Billable seconds were recorded and one ledger entry was written.

## Published results

From M9, the nightly run writes a results page (case, quantity, reference, computed, percentage error, mesh size, software versions) that is published with the documentation and linked from every report.

## Browser end-to-end tests

Playwright drives the real UI against the local system on tiny models.

| Test | Covers | Added in |
| --- | --- | --- |
| E-01 | Upload, select face, material, support, pressure, mesh, run, see contour | M1 |
| E-02 | Unit entry in mixed units and display-unit switch | M2 |
| E-03 | Multi-body upload, review bonds, run | M4 |
| E-04 | Thermal stress setup and result | M5 |
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

Separate from correctness. A fixed set of models from 100,000 to 2 million elements records mesh time, solve time, peak memory and result-file sizes per solver option and machine size. The estimator is fitted to these numbers, and gate condition 3 (estimate accuracy) is measured on them.
