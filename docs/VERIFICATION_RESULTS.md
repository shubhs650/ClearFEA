<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Written by `python -m harness.page` from verification/results/; do not edit. -->

# Verification results

These are the numbers ClearFEA computed for its verification cases: simple models with an analytical or published answer, run through the whole platform (upload, setup, meshing, CalculiX, result reading). For each check the table gives the reference value, the value ClearFEA computed, the difference and the tolerance the case allows. The cases show how closely the software reproduces known answers. They do not show how closely a particular model represents its part, and nothing here compares a result with a design code, standard or acceptance criterion.

How each case is built and where its reference values come from: [VERIFICATION.md](VERIFICATION.md) and the write-up linked under each case.

## Where these numbers come from

- **Verification cases**: the [phase-end run](https://github.com/shubhs650/ClearFEA/actions/runs/39475421085) on `main` at commit 8a665bf on 2026-10-20, which closed M10 (`make verify` in GitHub Actions, ADR-037). Full tier; 26 cases, 307 of 307 checks within tolerance. Software: clearfea 0.0.0+8a665bf, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1.
- **Acceptance cases**: the [Live checks run](https://github.com/shubhs650/ClearFEA/actions/runs/39434864276) on `main` at commit ec3dd18 on 2026-10-20, against the live site https://clearfea.triyalabs.com on its standard solver machine (4 vCPU, 16 GB; ADR-095, ADR-104). The phase-end run does not run them. Full tier; 2 cases, 34 of 34 checks within tolerance. Software: clearfea 0.0.0+ec3dd185675ab368bf069b7c475efb753e1ec628, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1.

To produce the same tables: `VERIFY_TIER=full make verify` for the verification cases and `VERIFY_TIER=full CASES="A B" make verify` for the acceptance cases (verification/README.md).

## Verification cases

The same 26 cases also ran on the live site, https://clearfea.triyalabs.com, on its standard solver machine (4 vCPU, 16 GB) at the coarse tier: 307 of 307 checks within tolerance ([Live checks run 39430740324](https://github.com/shubhs650/ClearFEA/actions/runs/39430740324), commit ec3dd18, 2026-10-20). A model at each solver's element limit (ADR-063) also ran there, all ten to completion ([runs 39439642986](https://github.com/shubhs650/ClearFEA/actions/runs/39439642986) and [39449881370](https://github.com/shubhs650/ClearFEA/actions/runs/39449881370)).

| Case | Mesh | Checks within tolerance |
| --- | --- | --- |
| [V-01 Thick cylinder, internal pressure](#v-01-thick-cylinder-internal-pressure) | 5 mm, 71783 elements, 114238 nodes | 13 of 13 |
| [V-02 Cantilever, end load](#v-02-cantilever-end-load) | 2.5 mm, 50985 elements, 78396 nodes | 9 of 9 |
| [V-03 Plate with central hole in tension](#v-03-plate-with-central-hole-in-tension) | 2.5 mm, 0.25 mm local, 14665 elements, 27880 nodes | 7 of 7 |
| [V-04 Remote force and moment on a stub](#v-04-remote-force-and-moment-on-a-stub) | 2 mm, 82285 elements, 120919 nodes | 11 of 11 |
| [V-05 Tank wall, hydrostatic pressure](#v-05-tank-wall-hydrostatic-pressure) | 5 mm, 38946 elements, 63582 nodes | 9 of 9 |
| [V-06 Thin rotating ring](#v-06-thin-rotating-ring) | 1.25 mm, 19424 elements, 33316 nodes | 11 of 11 |
| [V-07 Block on an elastic support](#v-07-block-on-an-elastic-support) | 5 mm, 9440 elements, 14988 nodes | 9 of 9 |
| [V-08 Bar with ends restrained, uniform temperature rise](#v-08-bar-with-ends-restrained-uniform-temperature-rise) | 2.5 mm, 13496 elements, 23121 nodes | 14 of 14 |
| [V-09 Symmetry model against full model (quarter tube)](#v-09-symmetry-model-against-full-model-quarter-tube) | 5 mm, 6409 elements, 10853 nodes | 13 of 13 |
| [V-10 Column under self-weight](#v-10-column-under-self-weight) | 12.7 mm, 25896 elements, 41153 nodes | 10 of 10 |
| [V-11 Two bonded blocks against one block (cantilever)](#v-11-two-bonded-blocks-against-one-block-cantilever) | 2.5 mm, 1.75 mm local, 80414 elements, 121470 nodes | 9 of 9 |
| [V-12 Bi-material bar in tension](#v-12-bi-material-bar-in-tension) | 2.5 mm, 1.5 mm local, 12527 elements, 21389 nodes | 14 of 14 |
| [V-13 Plane wall conduction](#v-13-plane-wall-conduction) | 2.5 mm, 42818 elements, 63020 nodes | 13 of 13 |
| [V-14 Cylinder wall conduction](#v-14-cylinder-wall-conduction) | 2.5 mm, 10203 elements, 16454 nodes | 10 of 10 |
| [V-15 Wall with convection on both sides](#v-15-wall-with-convection-on-both-sides) | 2.5 mm, 42818 elements, 63020 nodes | 10 of 10 |
| [V-16 Heated plate radiating to ambient](#v-16-heated-plate-radiating-to-ambient) | 2.5 mm, 19913 elements, 32662 nodes | 10 of 10 |
| [V-17 Slab with internal heat generation](#v-17-slab-with-internal-heat-generation) | 2.5 mm, 42818 elements, 63020 nodes | 12 of 12 |
| [V-18 Thick cylinder thermal stress](#v-18-thick-cylinder-thermal-stress) | 2.5 mm, 10203 elements, 16454 nodes | 16 of 16 |
| [V-19 Wall with temperature-dependent properties](#v-19-wall-with-temperature-dependent-properties) | 2.5 mm, 5252 elements, 8618 nodes | 19 of 19 |
| [V-20 Cantilever beam frequencies](#v-20-cantilever-beam-frequencies) | 3 mm, 19577 elements, 36937 nodes | 12 of 12 |
| [V-21 Fixed-fixed beam frequencies](#v-21-fixed-fixed-beam-frequencies) | 3 mm, 19577 elements, 36937 nodes | 7 of 7 |
| [V-22 Unrestrained body](#v-22-unrestrained-body) | 2 mm, 66677 elements, 113748 nodes | 12 of 12 |
| [V-24 Bar stretched by a prescribed displacement](#v-24-bar-stretched-by-a-prescribed-displacement) | 2 mm, 10682 elements, 17747 nodes | 17 of 17 |
| [V-25 Tube in an elastic sleeve (curved elastic support)](#v-25-tube-in-an-elastic-sleeve-curved-elastic-support) | 5 mm, 6409 elements, 10853 nodes | 13 of 13 |
| [V-26 Bar in tension with first-order elements](#v-26-bar-in-tension-with-first-order-elements) | 2 mm, first order, 12839 elements, 3408 nodes | 10 of 10 |
| [V-27 Two-layer tube wall conduction](#v-27-two-layer-tube-wall-conduction) | 2.5 mm, 1 mm local, 85994 elements, 129217 nodes | 12 of 12 |

### V-01 Thick cylinder, internal pressure

Mesh 5 mm, 71783 elements, 114238 nodes; 46 s from upload to result. Reference values: [reference.md](../verification/cases/V-01-thick-cylinder/reference.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | mm | mm |   | equal | yes |
| Hoop-dominated von Mises stress at the bore | 32.187 MPa | 32.06 MPa (939 vertices) | -0.39 % | 1 % | yes |
| von Mises stress at the outside | 16 MPa | 15.974 MPa (1419 vertices) | -0.16 % | 1 % | yes |
| Radial displacement of the bore | 0.0058 mm | 0.0057998 mm (939 vertices) | -0.00 % | 0.5 % | yes |
| Radial displacement of the outside | 0.0048 mm | 0.0047999 mm (1419 vertices) | -0.00 % | 0.5 % | yes |
| Hoop stress at the bore is σ1 | 26 MPa | 26.004 MPa (939 vertices) | +0.02 % | 1 % | yes |
| Hoop stress at the outside is σ1 | 16 MPa | 16.001 MPa (1419 vertices) | +0.01 % | 1 % | yes |
| Shear stress τxy at 45 degrees on the bore | -18 MPa | -17.916 MPa (61 vertices) | -0.47 % | 1 % | yes |
| Shear strain εxy at 45 degrees on the bore (tensor, γxy / 2) | -117 µε | -116.45 µε (61 vertices) | -0.47 % | 1 % | yes |
| Reactions balance the applied load | applied 5.0147e-11, 1.7875e-11, 7.6605e-15 N | reactions 0.00028877, -7.5576e-05, 0.00064602 N | 0.0000 % of 7.5389e+05 N | 0.1 % | yes |
| The run's balance check closes | force and moment | force 9.4e-08 %, moment 1.1e-08 % | 0.0000 % | 0.1 % | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 36 s, charged True, 1 entry |   |   | yes |

### V-02 Cantilever, end load

Mesh 2.5 mm, 50985 elements, 78396 nodes; 30 s from upload to result. Reference values: [reference.md](../verification/cases/V-02-cantilever/reference.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | in | in |   | equal | yes |
| Tip deflection (mean over the free end) | -0.064313 in | -0.063851 in (633 vertices) | -0.72 % | 1.5 % | yes |
| Bending stress on top at mid-length | 13500 psi | 13495 psi (252 vertices) | -0.04 % | 0.5 % | yes |
| Bending stress underneath at mid-length | 13500 psi | 13497 psi (259 vertices) | -0.02 % | 0.5 % | yes |
| Clamp carries the end load | 500 lbf | 500 lbf (support fixed-1) | -0.00 % | 0.1 % | yes |
| Reactions balance the applied load | applied 0, -2224.1, 0 N | reactions 0.00016064, 2224.1, 8.4493e-05 N | 0.0000 % of 2224.1 N | 0.1 % | yes |
| The run's balance check closes | force and moment | force 8.2e-06 %, moment 7.4e-07 % | 0.0000 % | 0.1 % | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 23 s, charged True, 1 entry |   |   | yes |

### V-03 Plate with central hole in tension

Mesh 2.5 mm, 0.25 mm local, 14665 elements, 27880 nodes; 11 s from upload to result. Reference values: [reference.md](../verification/cases/V-03-plate-with-hole/reference.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | mm | mm |   | equal | yes |
| Peak stress at the side of the hole (Kt sigma, Kt = 3.025) | 302.5 MPa | 303.6 MPa (21 vertices) | +0.36 % | 1 % | yes |
| Uniform stress at the pulled end (F / A) | 100 MPa | 99.995 MPa (203 vertices) | -0.01 % | 0.5 % | yes |
| Reactions balance the applied load | applied 12500, 0, 0 N | reactions -12500, -1.1568e-06, -7.8775e-08 N | 0.0000 % of 12500 N | 0.1 % | yes |
| The run's balance check closes | force and moment | force 1.9e-06 %, moment 2.4e-07 % | 0.0000 % | 0.1 % | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 5 s, charged True, 1 entry |   |   | yes |

### V-04 Remote force and moment on a stub

Mesh 2 mm, 82285 elements, 120919 nodes; 61 s from upload to result. Reference values: [reference.md](../verification/cases/V-04-remote-load/reference.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | mm | mm |   | equal | yes |
| Clamp carries the axial force | -6 kN | -6 kN (support clamp) | +0.00 % | 0.1 % | yes |
| Clamp's moment about its centre, torque | -120 N·m | -120 N·m (support clamp) | -0.00 % | 0.1 % | yes |
| Clamp's moment about its centre, bending with the point's lever | -127.79 N·m | -127.79 N·m (support clamp) | -0.00 % | 0.1 % | yes |
| Bending, torsion and tension on top (y = +R) | 55.811 MPa | 55.791 MPa (159 vertices) | -0.04 % | 0.5 % | yes |
| Bending, torsion and tension underneath (y = -R) | 68.933 MPa | 68.892 MPa (157 vertices) | -0.06 % | 0.5 % | yes |
| Torsion and tension on the side (z = +R, no bending) | 40.114 MPa | 40.163 MPa (181 vertices) | +0.12 % | 0.5 % | yes |
| Reactions balance the applied load | applied 6000, 0, 0 N | reactions -6000, 4.4986e-05, 5.5733e-05 N | 0.0000 % of 6000 N | 0.1 % | yes |
| The run's balance check closes | force and moment | force 5.4e-07 %, moment 3.4e-08 % | 0.0000 % | 0.1 % | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 51 s, charged True, 1 entry |   |   | yes |

### V-05 Tank wall, hydrostatic pressure

Mesh 5 mm, 38946 elements, 63582 nodes; 29 s from upload to result. Reference values: [reference.md](../verification/cases/V-05-tank-wall/reference.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | mm | mm |   | equal | yes |
| Base carries the water's push (ρ g b H²/2) | -78.453 N | -78.453 N (support base) | -0.00 % | 0.1 % | yes |
| Bending stress on the dry side at z = 100 mm | 661.95 kPa | 661.69 kPa (209 vertices) | -0.04 % | 0.5 % | yes |
| Bending stress on the dry side at z = 200 mm | 196.13 kPa | 195.94 kPa (213 vertices) | -0.10 % | 0.5 % | yes |
| Top of the wall moves away from the water | 0.094323 mm | 0.094322 mm (469 vertices) | -0.00 % | 0.5 % | yes |
| Reactions balance the applied load | applied 0, 78.453, 0 N | reactions 5.83e-10, -78.453, -9.4618e-06 N | 0.0000 % of 78.453 N | 0.1 % | yes |
| The run's balance check closes | force and moment | force 1.2e-05 %, moment 1.5e-06 % | 0.0000 % | 0.1 % | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 21 s, charged True, 1 entry |   |   | yes |

### V-06 Thin rotating ring

Mesh 1.25 mm, 19424 elements, 33316 nodes; 15 s from upload to result. Reference values: [reference.md](../verification/cases/V-06-rotating-ring/reference.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | mm | mm |   | equal | yes |
| Hoop stress outside, r = b | 72.591 MPa | 72.591 MPa (2861 vertices) | -0.00 % | 0.5 % | yes |
| Hoop stress inside, r = a | 83.223 MPa | 83.221 MPa (2601 vertices) | -0.00 % | 0.5 % | yes |
| Radial growth outside (b σθ/E) | 0.034567 mm | 0.034567 mm (2861 vertices) | -0.00 % | 0.5 % | yes |
| Radial growth inside (a σθ/E) | 0.035667 mm | 0.035666 mm (2601 vertices) | -0.00 % | 0.5 % | yes |
| Hoop force across the cut x = 0 | -3.8882 kN | -3.8882 kN (support cut-x) | -0.00 % | 0.1 % | yes |
| Hoop force across the cut y = 0 | -3.8882 kN | -3.8882 kN (support cut-y) | -0.00 % | 0.1 % | yes |
| Reactions balance the applied load | applied 3888.2, 3888.2, 0 N | reactions -3888.2, -3888.2, 8.7659e-09 N | 0.0003 % of 6107.5 N | 0.1 % | yes |
| The run's balance check closes | force and moment | force 9.1e-07 %, moment 8e-07 % | 0.0000 % | 0.1 % | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 8 s, charged True, 1 entry |   |   | yes |

### V-07 Block on an elastic support

Mesh 5 mm, 9440 elements, 14988 nodes; 9 s from upload to result. Reference values: [reference.md](../verification/cases/V-07-elastic-block/reference.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | mm | mm |   | equal | yes |
| Base settles by F / (k A) | -1.842 mm | -1.842 mm (1209 vertices) | +0.00 % | 0.1 % | yes |
| Top moves by F / (k A) + F H / (E A) | -2.242 mm | -2.242 mm (1209 vertices) | +0.00 % | 0.1 % | yes |
| Uniform compression F / A | 1 MPa | 0.99999 MPa (521 vertices) | -0.00 % | 0.1 % | yes |
| Foundation carries the force | 6 kN | 6 kN (support foundation) | -0.00 % | 0.1 % | yes |
| Reactions balance the applied load | applied 0, 0, -6000 N | reactions 4.5704e-11, 4.8248e-12, 6000 N | 0.0000 % of 6000 N | 0.1 % | yes |
| The run's balance check closes | force and moment | force 1.5e-05 %, moment 6.9e-06 % | 0.0000 % | 0.1 % | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 4 s, charged True, 1 entry |   |   | yes |

### V-08 Bar with ends restrained, uniform temperature rise

Mesh 2.5 mm, 13496 elements, 23121 nodes; 10 s from upload to result. Reference values: [reference.md](../verification/cases/V-08-heated-bar/reference.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | mm | mm |   | equal | yes |
| Uniform axial stress E alpha dT (von Mises) | 116.97 MPa | 116.97 MPa (1841 vertices) | -0.00 % | 0.1 % | yes |
| Start pushes the bar towards +x with E alpha dT A | 23.394 kN | 23.394 kN (support start) | +0.00 % | 0.1 % | yes |
| End pushes the bar towards -x with E alpha dT A | -23.394 kN | -23.394 kN (support end) | +0.00 % | 0.1 % | yes |
| Side grows by (1 + nu) alpha dT b | 0.01521 mm | 0.01521 mm (1841 vertices) | +0.00 % | 0.1 % | yes |
| Top grows by (1 + nu) alpha dT h | 0.007605 mm | 0.007605 mm (3381 vertices) | +0.00 % | 0.1 % | yes |
| Axial stress σxx is compression −E alpha dT | -116.97 MPa | -116.97 MPa (1841 vertices) | -0.00 % | 0.1 % | yes |
| Smallest principal stress is the axial compression | -116.97 MPa | -116.97 MPa (1841 vertices) | -0.00 % | 0.1 % | yes |
| Total strain across the width (1 + nu) alpha dT | 0.07605 % | 0.076049 % (1841 vertices) | -0.00 % | 0.1 % | yes |
| Total strain through the thickness (1 + nu) alpha dT | 760.5 µε | 760.49 µε (3381 vertices) | -0.00 % | 0.1 % | yes |
| Reactions balance the applied load | applied 0, 0, 0 N | reactions -1.0914e-11, -2.4633e-10, 2.3767e-10 N | 0.0000 % of 46788 N | 0.1 % | yes |
| The run's balance check closes | force and moment | force 7.3e-13 %, moment 4e-13 % | 0.0000 % | 0.1 % | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 4 s, charged True, 1 entry |   |   | yes |

### V-09 Symmetry model against full model (quarter tube)

Mesh 5 mm, 6409 elements, 10853 nodes; 9 s from upload to result. Reference values: [reference.md](../verification/cases/V-09-symmetry-tube/reference.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | mm | mm |   | equal | yes |
| von Mises stress at the bore (full tube 32.1870 MPa) | 32.187 MPa | 32.081 MPa (1307 vertices) | -0.33 % | 1 % | yes |
| von Mises stress at the outside (full tube 16.0 MPa) | 16 MPa | 15.978 MPa (1879 vertices) | -0.14 % | 1 % | yes |
| Radial displacement of the bore (full tube 0.0058 mm) | 0.0058 mm | 0.0057998 mm (1307 vertices) | -0.00 % | 0.5 % | yes |
| Radial displacement of the outside (full tube 0.0048 mm) | 0.0048 mm | 0.0047999 mm (1879 vertices) | -0.00 % | 0.5 % | yes |
| Hoop force on the 30° plane, x | 20 kN | 20 kN (support cut-30) | -0.00 % | 0.2 % | yes |
| Hoop force on the 30° plane, y | -34.641 kN | -34.641 kN (support cut-30) | +0.00 % | 0.2 % | yes |
| Hoop force on the 120° plane, x | -34.641 kN | -34.641 kN (support cut-120) | +0.00 % | 0.2 % | yes |
| Hoop force on the 120° plane, y | -20 kN | -20 kN (support cut-120) | +0.00 % | 0.2 % | yes |
| Reactions balance the applied load | applied 14641, 54641, 1.9984e-15 N | reactions -14641, -54641, 2.1474e-07 N | 0.0000 % of 62825 N | 0.1 % | yes |
| The run's balance check closes | force and moment | force 2.8e-07 %, moment 1.5e-07 % | 0.0000 % | 0.1 % | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 2 s, charged True, 1 entry |   |   | yes |

### V-10 Column under self-weight

Mesh 12.7 mm, 25896 elements, 41153 nodes; 18 s from upload to result. Reference values: [reference.md](../verification/cases/V-10-self-weight/reference.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | in | in |   | equal | yes |
| Node values served per field match nodes.bin | 5 fields | 41153 nodes | equal | equal | yes |
| Base carries the weight (ρ g A h) | 181.76 lbf | 181.76 lbf (support base) | -0.00 % | 0.1 % | yes |
| Axial stress at mid-height (ρ g h/2) | 5.68 psi | 5.6782 psi (179 vertices) | -0.03 % | 0.5 % | yes |
| Axial stress inside at quarter height (ρ g 3h/4) | -8.52 psi | -8.5179 psi (1075 nodes inside) | -0.02 % | 0.5 % | yes |
| Top shortens by ρ g h²/(2E) | -7.8324e-06 in | -7.8324e-06 in (357 vertices) | +0.00 % | 0.5 % | yes |
| Reactions balance the applied load | applied 0, 0, -808.51 N | reactions 9.3175e-12, -4.9055e-12, 808.51 N | 0.0000 % of 808.51 N | 0.1 % | yes |
| The run's balance check closes | force and moment | force 9.8e-07 %, moment 4.6e-08 % | 0.0000 % | 0.1 % | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 11 s, charged True, 1 entry |   |   | yes |

### V-11 Two bonded blocks against one block (cantilever)

Mesh 2.5 mm, 1.75 mm local, 80414 elements, 121470 nodes; 57 s from upload to result. Reference values: [reference.md](../verification/cases/V-11-bonded-blocks/reference.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | in | in |   | equal | yes |
| Tip deflection (mean over the free end) | -0.064313 in | -0.063861 in (633 vertices) | -0.70 % | 1.5 % | yes |
| Bending stress on top at mid-length, 2 in past the bond | 13500 psi | 13486 psi (263 vertices) | -0.10 % | 0.5 % | yes |
| Bending stress underneath at mid-length, 2 in past the bond | 13500 psi | 13508 psi (257 vertices) | +0.06 % | 0.5 % | yes |
| Clamp carries the end load through the bond | 500 lbf | 500 lbf (support fixed-1) | +0.00 % | 0.1 % | yes |
| Reactions balance the applied load | applied 0, -2224.1, 0 N | reactions -0.00015764, 2224.1, 8.393e-06 N | 0.0000 % of 2224.1 N | 0.1 % | yes |
| The run's balance check closes | force and moment | force 8.8e-06 %, moment 9.4e-07 % | 0.0000 % | 0.1 % | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 48 s, charged True, 1 entry |   |   | yes |

### V-12 Bi-material bar in tension

Mesh 2.5 mm, 1.5 mm local, 12527 elements, 21389 nodes; 10 s from upload to result. Reference values: [reference.md](../verification/cases/V-12-bimaterial-bar/reference.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | mm | mm |   | equal | yes |
| Normal stress σxx along body 1 (F / A) | 50 MPa | 49.998 MPa (929 vertices) | -0.00 % | 0.1 % | yes |
| Normal stress σxx along body 2 (F / A) | 50 MPa | 50.005 MPa (1391 vertices) | +0.01 % | 0.1 % | yes |
| von Mises stress along body 2, top | 7.2519 ksi | 7.2527 ksi (1395 vertices) | +0.01 % | 0.1 % | yes |
| Axial strain in body 1 (σ / E1) | 250 µε | 249.99 µε (929 vertices) | -0.00 % | 0.1 % | yes |
| Axial strain in body 2 (σ / E2) | 714.29 µε | 714.35 µε (1391 vertices) | +0.01 % | 0.1 % | yes |
| End moved by σ (L1 / E1 + L2 / E2) | 0.067857 mm | 0.067858 mm (265 vertices) | +0.00 % | 0.1 % | yes |
| Body 1 side contracts (−ν1 σ / E1 · 10 mm) | -0.00075 mm | -0.00075 mm (929 vertices) | +0.00 % | 0.1 % | yes |
| Body 2 side contracts alike (−ν2 σ / E2 · 10 mm) | -0.00075 mm | -0.00074998 mm (1391 vertices) | -0.00 % | 0.1 % | yes |
| Start holds the end load | -5 kN | -5 kN (support start) | -0.00 % | 0.1 % | yes |
| Reactions balance the applied load | applied 5000, 0, 0 N | reactions -5000, 9.9112e-08, -7.2553e-07 N | 0.0000 % of 5000 N | 0.1 % | yes |
| The run's balance check closes | force and moment | force 1.2e-06 %, moment 7e-08 % | 0.0000 % | 0.1 % | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 5 s, charged True, 1 entry |   |   | yes |

### V-13 Plane wall conduction

Mesh 2.5 mm, 42818 elements, 63020 nodes; 14 s from upload to result. Reference values: [reference.md](../verification/cases/V-13-plane-wall/reference.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | mm | mm |   | equal | yes |
| Hot face at 300 °F | 148.89 °C | 148.89 °C (2821 vertices) | +0.00 % | 0.01 % | yes |
| Cold face at 20 °C | 20 °C | 20 °C (2821 vertices) | -0.00 % | 0.01 % | yes |
| A quarter of the way through, Th − (Th − Tc) / 4 | 116.67 °C | 116.67 °C (2 vertices) | +0.00 % | 0.01 % | yes |
| Halfway through, the mean of Th and Tc | 84.444 °C | 84.444 °C (2 vertices) | -0.00 % | 0.01 % | yes |
| Three quarters of the way through, Tc + (Th − Tc) / 4 | 126 °F | 126 °F (2 vertices) | -0.00 % | 0.01 % | yes |
| Heat flux along x, k (Th − Tc) / L | 45964 BTU/(h·ft²) | 45963 BTU/(h·ft²) (1897 vertices) | -0.00 % | 0.01 % | yes |
| Heat flux magnitude at the cold face | 145 kW/m² | 145 kW/m² (2821 vertices) | -0.00 % | 0.01 % | yes |
| Heat in through the hot face, q A | 521.99 W | 521.99 W (load hot) | -0.00 % | 0.01 % | yes |
| Heat out through the cold face, − q A | -1781.1 BTU/h | -1781.1 BTU/h (load cold) | -0.00 % | 0.01 % | yes |
| The run's heat balance closes | heat in 521.99 W | heat out 521.99 W | 0.0000 % of 521.99 W | 0.1 % | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 7 s, charged True, 1 entry |   |   | yes |

### V-14 Cylinder wall conduction

Mesh 2.5 mm, 10203 elements, 16454 nodes; 8 s from upload to result. Reference values: [reference.md](../verification/cases/V-14-cylinder-wall/reference.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | mm | mm |   | equal | yes |
| A quarter of the way through, r = 45 mm | 349.91 K | 349.91 K (1 vertices) | +0.00 % | 0.1 % | yes |
| Halfway through, r = 50 mm | 55.973 °C | 55.973 °C (1 vertices) | +0.00 % | 0.1 % | yes |
| Three quarters of the way through, r = 55 mm | 98.902 °F | 98.902 °F (1 vertices) | +0.00 % | 0.1 % | yes |
| Radial heat flux halfway through, Q / ((π/2) r L) | 56289 BTU/(h·ft²) | 56300 BTU/(h·ft²) (1 vertices) | +0.02 % | 1 % | yes |
| Heat in through the bore, (π/2) k L ΔT / ln(b/a) | 278.93 W | 278.93 W (load bore) | +0.00 % | 0.2 % | yes |
| Heat out through the outside | -951.74 BTU/h | -951.74 BTU/h (load outside) | +0.00 % | 0.2 % | yes |
| The run's heat balance closes | heat in 278.93 W | heat out 278.93 W | 0.0000 % of 278.97 W | 0.1 % | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 2 s, charged True, 1 entry |   |   | yes |

### V-15 Wall with convection on both sides

Mesh 2.5 mm, 42818 elements, 63020 nodes; 14 s from upload to result. Reference values: [reference.md](../verification/cases/V-15-convection-wall/reference.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | mm | mm |   | equal | yes |
| Hot surface, T∞1 − q/h1 | 181.76 °C | 181.76 °C (2821 vertices) | -0.00 % | 0.01 % | yes |
| Cold surface, T∞2 + q/h2 | 140.28 °F | 140.28 °F (2821 vertices) | +0.00 % | 0.01 % | yes |
| Halfway through, the mean of the surface temperatures | 120.96 °C | 120.96 °C (2 vertices) | +0.00 % | 0.01 % | yes |
| Heat flux along x, ΔT / (1/h1 + L/k + 1/h2) | 4.5602 kW/m² | 4.5601 kW/m² (1897 vertices) | -0.00 % | 0.01 % | yes |
| Heat in from the hot gas, q A | 16.417 W | 16.417 W (load hot) | +0.00 % | 0.01 % | yes |
| Heat out to the room air, − q A | -56.016 BTU/h | -56.016 BTU/h (load cold) | +0.00 % | 0.01 % | yes |
| The run's heat balance closes | heat in 16.417 W | heat out 16.417 W | 0.0001 % of 16.417 W | 0.1 % | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 7 s, charged True, 1 entry |   |   | yes |

### V-16 Heated plate radiating to ambient

Mesh 2.5 mm, 19913 elements, 32662 nodes; 11 s from upload to result. Reference values: [reference.md](../verification/cases/V-16-radiating-plate/reference.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | mm | mm |   | equal | yes |
| Radiating front face, from εσ(T⁴ − T∞⁴) = q | 297 °C | 297 °C (4941 vertices) | +0.00 % | 0.01 % | yes |
| Heated back face, front + qL/k | 623.39 °F | 623.39 °F (4941 vertices) | +0.00 % | 0.01 % | yes |
| Heat flux at the radiating face, q | 1500 BTU/(h·ft²) | 1500 BTU/(h·ft²) (4941 vertices) | -0.00 % | 0.01 % | yes |
| Heat in from the heater, q A | 30.284 W | 30.284 W (load heater) | +0.00 % | 0.01 % | yes |
| Heat radiated to the room, − q A | -103.33 BTU/h | -103.33 BTU/h (load room) | +0.00 % | 0.01 % | yes |
| Heat flux and generation bring in what the setup gives | 30.284 W | 30.284 W | 0.0000 % of 30.284 W | 0.1 % | yes |
| The run's heat balance closes | heat in 30.284 W | heat out 30.284 W | 0.0000 % of 30.284 W | 0.1 % | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 5 s, charged True, 1 entry |   |   | yes |

### V-17 Slab with internal heat generation

Mesh 2.5 mm, 42818 elements, 63020 nodes; 17 s from upload to result. Reference values: [reference.md](../verification/cases/V-17-heat-generation/reference.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | mm | mm |   | equal | yes |
| Centre, T0 + q‴L²/2k (L the half-thickness) | 183.33 °C | 183.33 °C (2 vertices) | -0.00 % | 0.01 % | yes |
| A quarter of the way through | 150 °C | 150 °C (2 vertices) | -0.00 % | 0.01 % | yes |
| Three quarters of the way through | 302 °F | 302 °F (2 vertices) | -0.00 % | 0.01 % | yes |
| Faces held at 50 °C | 122 °F | 122 °F (2821 vertices) | -0.00 % | 0.01 % | yes |
| Heat flux at the left face, − q‴ L | -200 kW/m² | -200 kW/m² (2821 vertices) | -0.00 % | 0.01 % | yes |
| Heat flux a quarter of the way through, − q‴ L / 2 | -100 kW/m² | -99.999 kW/m² (2 vertices) | -0.00 % | 0.01 % | yes |
| Heat out through the cooled faces, − q‴ V | -1.44 kW | -1.44 kW (load faces) | +0.00 % | 0.01 % | yes |
| Heat flux and generation bring in what the setup gives | 1440 W | 1440 W | 0.0000 % of 1440 W | 0.1 % | yes |
| The run's heat balance closes | heat in 1440 W | heat out 1440 W | 0.0000 % of 1440 W | 0.1 % | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 10 s, charged True, 1 entry |   |   | yes |

### V-18 Thick cylinder thermal stress

Mesh 2.5 mm, 10203 elements, 16454 nodes; 12 s from upload to result. Reference values: [reference.md](../verification/cases/V-18-thermal-stress-cylinder/reference.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | mm | mm |   | equal | yes |
| Hoop stress at the bore, σθ(a) | -233.22 MPa | -233.12 MPa (17 vertices) | -0.04 % | 1 % | yes |
| Hoop stress at the outside, σθ(b) | 178.21 MPa | 178.28 MPa (17 vertices) | +0.04 % | 1 % | yes |
| Axial stress at the bore, σz(a) | -381.97 MPa | -382 MPa (1113 vertices) | +0.01 % | 1 % | yes |
| Axial stress at the outside, σz(b) | 29.463 MPa | 29.508 MPa (1569 vertices) | +0.15 % | 1 % | yes |
| von Mises stress at the bore | 333.48 MPa | 332.85 MPa (1113 vertices) | -0.19 % | 1 % | yes |
| von Mises stress at the outside | 165.46 MPa | 165.62 MPa (1569 vertices) | +0.10 % | 1 % | yes |
| Radial displacement of the bore | 0.038674 mm | 0.038675 mm (1113 vertices) | +0.00 % | 0.5 % | yes |
| Radial displacement of the outside | 0.058012 mm | 0.058012 mm (1569 vertices) | -0.00 % | 0.5 % | yes |
| Axial force on the end z = 0, Eα 2π Ib / 4 | 2.3365e+05 N | 2.3365e+05 N (support end-0) | +0.00 % | 0.5 % | yes |
| Heat in through the bore, (π/2) k L ΔT / ln(b/a) | 418.39 W | 418.39 W (load bore) | +0.00 % | 0.5 % | yes |
| The run's heat balance closes | heat in 418.39 W | heat out 418.39 W | 0.0000 % of 418.46 W | 0.1 % | yes |
| Reactions balance the applied load | applied 0, 0, 0 N | reactions 2.1358e-05, -0.00051428, 0.00031016 N | 0.0000 % of 5.5821e+05 N | 0.1 % | yes |
| The run's balance check closes | force and moment | force 1.1e-07 %, moment 8.2e-08 % | 0.0000 % | 0.1 % | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 6 s, charged True, 1 entry |   |   | yes |

### V-19 Wall with temperature-dependent properties

Mesh 2.5 mm, 5252 elements, 8618 nodes; 8 s from upload to result. Reference values: [reference.md](../verification/cases/V-19-temperature-dependent-wall/reference.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | mm | mm |   | equal | yes |
| Heat flux, k at the mean temperature times ΔT / L | 421.8 kW/m² | 421.8 kW/m² (693 vertices) | -0.00 % | 0.1 % | yes |
| Heat in through the hot face, q A | 168.72 W | 168.72 W (load hot) | -0.00 % | 0.1 % | yes |
| Heat out through the cold face, − q A | -168.72 W | -168.72 W (load cold) | -0.00 % | 0.1 % | yes |
| A quarter of the way through | 291.75 °C | 291.75 °C (8 vertices) | -0.00 % | 0.1 % | yes |
| Halfway through, 16 K below the mean of the faces | 193.86 °C | 193.86 °C (10 vertices) | -0.00 % | 0.1 % | yes |
| Three quarters of the way through | 103.82 °C | 103.82 °C (9 vertices) | -0.00 % | 0.1 % | yes |
| Sideways stress at the hot face, − E ε / (1 − ν) at 400 °C | -1182.2 MPa | -1182.1 MPa (357 vertices) | -0.01 % | 0.5 % | yes |
| Sideways stress halfway through | -481.18 MPa | -481.1 MPa (10 vertices) | -0.02 % | 0.5 % | yes |
| Sideways stress three quarters of the way through | -177.41 MPa | -177.37 MPa (9 vertices) | -0.02 % | 0.5 % | yes |
| Sideways stress at the cold face, below the stress-free temperature | 98.451 MPa | 98.487 MPa (357 vertices) | +0.04 % | 0.5 % | yes |
| von Mises stress at the hot face, \|σ\| with σxx = 0 | 1182.2 MPa | 1182 MPa (357 vertices) | -0.02 % | 0.5 % | yes |
| Growth of the hot face, − ∫ ε (1 + ν) / (1 − ν) dx | -0.14525 mm | -0.14525 mm (357 vertices) | -0.00 % | 0.1 % | yes |
| Force on the wall y = 0, − H ∫ σ dx | 4.0199e+05 N | 4.0199e+05 N (support wall-y0) | +0.00 % | 0.1 % | yes |
| The run's heat balance closes | heat in 168.72 W | heat out 168.72 W | 0.0000 % of 168.72 W | 0.1 % | yes |
| Reactions balance the applied load | applied 0, 0, 0 N | reactions 4.266e-07, 0.0043845, 0.00032031 N | 0.0000 % of 1.6375e+06 N | 0.1 % | yes |
| The run's balance check closes | force and moment | force 2.7e-07 %, moment 7e-08 % | 0.0000 % | 0.1 % | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 3 s, charged True, 1 entry |   |   | yes |

### V-20 Cantilever beam frequencies

Mesh 3 mm, 19577 elements, 36937 nodes; 17 s from upload to result. Reference values: [reference.md](../verification/cases/V-20-cantilever-frequencies/reference.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | mm | mm |   | equal | yes |
| First bending mode in z, βL = 1.8751 | 10.192 Hz | 10.202 Hz (mode 1) | +0.0920 % | 0.3 % | yes |
| First bending mode in y, βL = 1.8751 | 20.385 Hz | 20.391 Hz (mode 2) | +0.0342 % | 0.3 % | yes |
| Second bending mode in z, βL = 4.6941 | 3832.4 cpm | 3834.2 cpm (mode 3) | +0.0458 % | 0.3 % | yes |
| Second bending mode in y, βL = 4.6941 | 127.75 Hz | 127.55 Hz (mode 4) | -0.1519 % | 0.3 % | yes |
| Third bending mode in z, βL = 7.8548 | 178.85 Hz | 178.8 Hz (mode 5) | -0.0268 % | 0.3 % | yes |
| First bending mode in z, shape at mid-span | 0.33952 1 | 0.33939 1 (81 vertices) | -0.04 % | 0.3 % | yes |
| First bending mode in y, shape at mid-span | 0.33952 1 | 0.33943 1 (37 vertices) | -0.03 % | 0.3 % | yes |
| Second bending mode in z, shape at mid-span | -0.71367 1 | -0.71356 1 (81 vertices) | -0.01 % | 0.3 % | yes |
| Modes found | 5 | 5 |   | equal | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 11 s, charged True, 1 entry |   |   | yes |

### V-21 Fixed-fixed beam frequencies

Mesh 3 mm, 19577 elements, 36937 nodes; 15 s from upload to result. Reference values: [reference.md](../verification/cases/V-21-clamped-beam-frequencies/reference.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | mm | mm |   | equal | yes |
| First bending mode in z, βL = 4.7300 | 3891.4 cpm | 3896.5 cpm (mode 1) | +0.1314 % | 0.3 % | yes |
| First bending mode in y, βL = 4.7300 | 129.71 Hz | 129.53 Hz (mode 2) | -0.1395 % | 0.3 % | yes |
| Second bending mode in z, βL = 7.8532 | 178.78 Hz | 178.86 Hz (mode 3) | +0.0440 % | 0.3 % | yes |
| Modes found | 3 | 3 |   | equal | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 8 s, charged True, 1 entry |   |   | yes |

### V-22 Unrestrained body

Mesh 2 mm, 66677 elements, 113748 nodes; 67 s from upload to result. Reference values: [reference.md](../verification/cases/V-22-free-body-modes/reference.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | mm | mm |   | equal | yes |
| Rigid-body mode 1 near zero | 0 Hz | -0.0013181 Hz (mode 1) | -0.0020 % of mode 7 | 0.1 % of mode 7 | yes |
| Rigid-body mode 2 near zero | 0 Hz | -0.0009431 Hz (mode 2) | -0.0015 % of mode 7 | 0.1 % of mode 7 | yes |
| Rigid-body mode 3 near zero | 0 Hz | 0.0014839 Hz (mode 3) | +0.0023 % of mode 7 | 0.1 % of mode 7 | yes |
| Rigid-body mode 4 near zero | 0 Hz | 0.0017498 Hz (mode 4) | +0.0027 % of mode 7 | 0.1 % of mode 7 | yes |
| Rigid-body mode 5 near zero | 0 Hz | 0.0022347 Hz (mode 5) | +0.0034 % of mode 7 | 0.1 % of mode 7 | yes |
| Rigid-body mode 6 near zero | 0 Hz | 0.0030132 Hz (mode 6) | +0.0046 % of mode 7 | 0.1 % of mode 7 | yes |
| First elastic mode, free-free bending in z, βL = 4.7300 | 64.856 Hz | 64.833 Hz (mode 7) | -0.0350 % | 0.3 % | yes |
| Second elastic mode, free-free bending in y, βL = 4.7300 | 0.12971 kHz | 0.12953 kHz (mode 8) | -0.1435 % | 0.3 % | yes |
| Modes found | 8 | 8 |   | equal | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 57 s, charged True, 1 entry |   |   | yes |

### V-24 Bar stretched by a prescribed displacement

Mesh 2 mm, 10682 elements, 17747 nodes; 9 s from upload to result. Reference values: [reference.md](../verification/cases/V-24-stretched-bar/reference.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | in | in |   | equal | yes |
| von Mises stress at the end (E ε) | 14.5 ksi | 14.5 ksi (265 vertices) | -0.00 % | 0.1 % | yes |
| von Mises stress along the side | 14.5 ksi | 14.5 ksi (1741 vertices) | -0.00 % | 0.1 % | yes |
| End moved by the prescribed 0.0508 mm | 0.002 in | 0.002 in (265 vertices) | +0.00 % | 0.1 % | yes |
| Side contracts in y (−ν ε y) | -7.25e-05 in | -7.25e-05 in (1741 vertices) | -0.00 % | 0.1 % | yes |
| Side contracts in z (−ν ε z) | -7.25e-05 in | -7.25e-05 in (1741 vertices) | -0.00 % | 0.1 % | yes |
| Force needed at the end (σ A) | 3.625 kip | 3.625 kip (support end) | +0.00 % | 0.1 % | yes |
| Force at the start | -3.625 kip | -3.625 kip (support start) | -0.00 % | 0.1 % | yes |
| Normal stress σxx along the side (E ε) | 14.5 ksi | 14.5 ksi (1741 vertices) | -0.00 % | 0.1 % | yes |
| Largest principal stress along the side is σxx | 14.5 ksi | 14.5 ksi (1741 vertices) | -0.00 % | 0.1 % | yes |
| Axial strain along the side (δ / L) | 500 µε | 500 µε (1741 vertices) | -0.00 % | 0.1 % | yes |
| Lateral strain along the side (−ν ε) | -0.000145 in/in | -0.000145 in/in (1741 vertices) | -0.00 % | 0.1 % | yes |
| Safety factor against yield along the side (Sy / σvm) | 2.4828 1 | 2.4828 1 (1741 vertices) | -0.00 % | 0.1 % | yes |
| Reactions balance the applied load | applied 0, 0, 0 N | reactions 0.00016, -1.973e-10, 1.1889e-10 N | 0.0000 % of 32250 N | 0.1 % | yes |
| The run's balance check closes | force and moment | force 5e-07 %, moment 3.9e-08 % | 0.0000 % | 0.1 % | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 4 s, charged True, 1 entry |   |   | yes |

### V-25 Tube in an elastic sleeve (curved elastic support)

Mesh 5 mm, 6409 elements, 10853 nodes; 9 s from upload to result. Reference values: [reference.md](../verification/cases/V-25-tube-in-elastic-sleeve/reference.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | mm | mm |   | equal | yes |
| von Mises stress at the bore | 26.057 MPa | 25.967 MPa (1307 vertices) | -0.35 % | 1 % | yes |
| von Mises stress at the outside | 12.35 MPa | 12.33 MPa (1879 vertices) | -0.16 % | 1 % | yes |
| Radial displacement of the bore | 0.0045152 mm | 0.0045151 mm (1307 vertices) | -0.00 % | 0.5 % | yes |
| Radial displacement of the outside | 0.0035688 mm | 0.0035687 mm (1879 vertices) | -0.00 % | 0.5 % | yes |
| Foundation's push on the outside, x | -3.9188 kN | -3.9193 kN (support sleeve) | +0.01 % | 0.5 % | yes |
| Foundation's push on the outside, y | -14.625 kN | -14.627 kN (support sleeve) | +0.01 % | 0.5 % | yes |
| Hoop force on the 30° plane, y | -25.369 kN | -25.368 kN (support cut-30) | -0.01 % | 0.5 % | yes |
| Hoop force on the 120° plane, x | -25.369 kN | -25.368 kN (support cut-120) | -0.01 % | 0.5 % | yes |
| Reactions balance the applied load | applied 14641, 54641, 1.9984e-15 N | reactions -14641, -54641, 2.8309e-08 N | 0.0000 % of 62825 N | 0.1 % | yes |
| The run's balance check closes | force and moment | force 1.5e-07 %, moment 8.1e-08 % | 0.0000 % | 0.1 % | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 3 s, charged True, 1 entry |   |   | yes |

### V-26 Bar in tension with first-order elements

Mesh 2 mm, first order, 12839 elements, 3408 nodes; 7 s from upload to result. Reference values: [reference.md](../verification/cases/V-26-first-order-bar/reference.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | mm | mm |   | equal | yes |
| Uniform axial stress F / A (von Mises) | 44.482 MPa | 44.482 MPa (710 vertices) | +0.00 % | 0.1 % | yes |
| End moves by F L / (E A) | 0.00508 in | 0.00508 in (45 vertices) | +0.00 % | 0.1 % | yes |
| Side contracts in y (−ν ε y) | -0.002129 mm | -0.002129 mm (710 vertices) | +0.00 % | 0.1 % | yes |
| Side contracts in z (−ν ε z) | -0.002129 mm | -0.002129 mm (709 vertices) | +0.00 % | 0.1 % | yes |
| The start holds the pull | -1000 lbf | -1000 lbf (support start) | +0.00 % | 0.1 % | yes |
| Reactions balance the applied load | applied 4448.2, 0, 0 N | reactions -4448.2, -9.3315e-11, -1.2631e-10 N | 0.0000 % of 4448.2 N | 0.1 % | yes |
| The run's balance check closes | force and moment | force 2.4e-06 %, moment 1.3e-07 % | 0.0000 % | 0.1 % | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 1 s, charged True, 1 entry |   |   | yes |

### V-27 Two-layer tube wall conduction

Mesh 2.5 mm, 1 mm local, 85994 elements, 129217 nodes; 40 s from upload to result. Reference values: [reference.md](../verification/cases/V-27-two-layer-tube/reference.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | mm | mm |   | equal | yes |
| Inner layer halfway through, r = 45 mm | 178.74 °C | 178.74 °C (1 vertices) | -0.00 % | 0.1 % | yes |
| Bond, inner layer's side, r = 50 mm | 432.87 K | 432.87 K (1 vertices) | +0.00 % | 0.1 % | yes |
| Bond, outer layer's side, r = 50 mm | 319.49 °F | 319.5 °F (1 vertices) | +0.00 % | 0.1 % | yes |
| Outer layer, r = 54 mm | 113.4 °C | 113.4 °C (1 vertices) | -0.00 % | 0.1 % | yes |
| Radial heat flux in the inner layer, r = 45 mm, Q / ((π/2) r L) | 2.0059e+05 W/m² | 2.0056e+05 W/m² (1 vertices) | -0.01 % | 1 % | yes |
| Radial heat flux in the outer layer, r = 54 mm | 1.6716e+05 W/m² | 1.6716e+05 W/m² (1 vertices) | -0.00 % | 1 % | yes |
| Heat in through the bore, (π/2) L ΔT / (ln(r1/a)/k1 + ln(b/r1)/k2) | 283.58 W | 283.57 W (load bore) | -0.00 % | 0.2 % | yes |
| Heat out through the outside, all of it across the bond | -967.61 BTU/h | -967.59 BTU/h (load outside) | -0.00 % | 0.2 % | yes |
| The run's heat balance closes | heat in 283.57 W | heat out 283.57 W | 0.0000 % of 283.61 W | 0.1 % | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 30 s, charged True, 1 entry |   |   | yes |

### Ledger

The wallet ledger over the whole run: every charge the cases made, against the costs their runs recorded (DECISIONS.md ADR-090).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| Every running balance is the previous one plus the entry | 53 entries chained | 53 entries chained |   | exact | yes |
| Wallet balance equals the sum of the ledger | 99.930272 credits | 99.930272 credits |   | exact | yes |
| Each job charge is its billed seconds at its rate | 52 jobs, 0.069728 credits | 0.069728 credits |   | exact | yes |
| Each charged run has one entry for exactly its recorded cost | 26 runs, 0.055834 credits | 26 runs matched |   | exact | yes |
| No entry without a job other than the grant | none | none |   | exact | yes |

## Acceptance cases

The two acceptance models of Phase 0 (VERIFICATION.md, Acceptance cases): A, a nozzle with a reinforcing pad on a cylindrical shell under pressure and a piping load; B, thermal stress in a thick-walled flanged pipe. The rows below are the checks with a hand-calculated value. The WRC-style comparison (A) and the FreeCAD FEM comparisons (A and B) are written up, with their numbers, in each case's hand_checks.md and are not repeated here.

| Case | Mesh | Checks within tolerance |
| --- | --- | --- |
| [A Nozzle with reinforcing pad on a cylindrical shell](#a-nozzle-with-reinforcing-pad-on-a-cylindrical-shell) | 12 mm, 123317 elements, 248060 nodes | 15 of 15 |
| [B Thermal stress in a thick-walled flanged pipe](#b-thermal-stress-in-a-thick-walled-flanged-pipe) | 6 mm, 119405 elements, 176853 nodes | 14 of 14 |

### A Nozzle with reinforcing pad on a cylindrical shell

Mesh 12 mm, 123317 elements, 248060 nodes; 146 s from upload to result. Reference values: [hand_checks.md](../verification/acceptance/A-nozzle-on-shell/hand_checks.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | mm | mm |   | equal | yes |
| Membrane von Mises at the shell outside, under the shell, 450 mm past the nozzle | 51.109 MPa | 50.199 MPa (134 vertices) | -1.78 % | 3 % | yes |
| Membrane hoop stress at the shell outside, under the shell, 450 mm past the nozzle | 59.016 MPa | 58.142 MPa (100 vertices) | -1.48 % | 3 % | yes |
| Membrane axial stress at the shell outside, under the shell, 450 mm past the nozzle | 29.508 MPa | 29.388 MPa (134 vertices) | -0.41 % | 3 % | yes |
| Membrane hoop stress at the shell inside, under the shell, 450 mm past the nozzle | 61.016 MPa | 61.409 MPa (99 vertices) | +0.64 % | 3 % | yes |
| Reaction at the held end, x | -569.49 kN | -569.49 kN (support held-end) | +0.00 % | 0.1 % | yes |
| Reaction at the held end, y | 3 kN | 3 kN (support held-end) | -0.00 % | 0.1 % | yes |
| Reaction at the held end, z | 6 kN | 5.9999 kN (support held-end) | -0.00 % | 0.1 % | yes |
| Reaction moment at the held end about its centre, x | -3.68 kN·m | -3.68 kN·m (support held-end) | +0.00 % | 0.1 % | yes |
| Reaction moment at the held end about its centre, y | -8.84 kN·m | -8.8399 kN·m (support held-end) | -0.00 % | 0.1 % | yes |
| Reaction moment at the held end about its centre, z | 0.3 kN·m | 0.3 kN·m (support held-end) | -0.00 % | 0.1 % | yes |
| Reactions balance the applied load | applied 5.6949e+05, -3000, -5963.6 N | reactions -5.6949e+05, 3000, 5999.9 N | 0.0007 % of 5.3464e+06 N | 0.1 % | yes |
| The run's balance check closes | force and moment | force 9.9e-08 %, moment 8.4e-09 % | 0.0000 % | 0.1 % | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 58 s, charged True, 1 entry |   |   | yes |

### B Thermal stress in a thick-walled flanged pipe

Mesh 6 mm, 119405 elements, 176853 nodes; 150 s from upload to result. Reference values: [hand_checks.md](../verification/acceptance/B-flanged-pipe-thermal/hand_checks.md).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| STEP length unit detected | mm | mm |   | equal | yes |
| Bore temperature away from the flange | 233.86 °C | 233.86 °C (1110 vertices) | -0.00 % | 0.2 % | yes |
| Outside temperature away from the flange | 153.03 °C | 153.02 °C (1647 vertices) | -0.00 % | 0.2 % | yes |
| Bore hoop stress away from the flange | -164.51 MPa | -163.24 MPa (40 vertices) | -0.77 % | 3 % | yes |
| Bore axial stress away from the flange | -164.36 MPa | -163.08 MPa (1269 vertices) | -0.78 % | 3 % | yes |
| Bore von Mises stress away from the flange | 164.43 MPa | 162.6 MPa (1269 vertices) | -1.12 % | 3 % | yes |
| Outside hoop stress away from the flange | 123.87 MPa | 124.05 MPa (40 vertices) | +0.15 % | 3 % | yes |
| Outside axial stress away from the flange | 123.76 MPa | 122.68 MPa (1863 vertices) | -0.88 % | 3 % | yes |
| Outside von Mises stress away from the flange | 123.82 MPa | 123.52 MPa (1863 vertices) | -0.24 % | 3 % | yes |
| The run's heat balance closes | heat in 6388.5 W | heat out 6388.5 W | 0.0000 % of 6388.5 W | 0.1 % | yes |
| Reactions balance the applied load | applied 0, 0, 0 N | reactions -0.016799, -0.00013126, -0.0060359 N | 0.0000 % of 4.6837e+06 N | 0.1 % | yes |
| The run's balance check closes | force and moment | force 3.8e-07 %, moment 1.6e-07 % | 0.0000 % | 0.1 % | yes |
| Solver log has no unexpected warnings | none | none |   |   | yes |
| Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 114 s, charged True, 1 entry |   |   | yes |

### Ledger

The wallet ledger over the whole run: every charge the cases made, against the costs their runs recorded (DECISIONS.md ADR-090).

| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |
| --- | --- | --- | --- | --- | --- |
| Every running balance is the previous one plus the entry | 59 entries chained | 59 entries chained |   | exact | yes |
| Wallet balance equals the sum of the ledger | 99.865837 credits | 99.865837 credits |   | exact | yes |
| Each job charge is its billed seconds at its rate | 58 jobs, 0.134163 credits | 0.134163 credits |   | exact | yes |
| Each charged run has one entry for exactly its recorded cost | 2 runs, 0.047778 credits | 2 runs matched |   | exact | yes |
| No entry without a job other than the grant | none | none |   | exact | yes |
