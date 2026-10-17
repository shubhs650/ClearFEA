<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Acceptance case B: hand checks and FreeCAD FEM

The acceptance checks of `docs/VERIFICATION.md` ("Acceptance cases") for the flanged pipe of
`model.md`, done in M9.6 on 2026-10-17. Check 4 (a WRC-style calculation) is case A's only.
Units: mm, MPa, °C; stresses are in the pipe's cylindrical axes (radial r, hoop θ, axial z).

| # | Check | Outcome |
| --- | --- | --- |
| 1 | Start to finish in the UI with no file touched by hand | Done in the development environment (`make dev`); the laptop run is M9.2's |
| 2 | Reaction balance closes | Closes: the supports' net force is 0.01 N, 2.5e-7 percent of their nodal forces; heat in equals heat out to 1e-7 percent |
| 3 | Through-wall stress away from the flange against closed-form values | Temperatures within 0.02 K; σθ and σz within 1.6 MPa (1 percent) at both surfaces and inside the wall |
| 5 | FreeCAD FEM within 5 percent on a matching mesh | Within 1 percent everywhere compared, at 10 mm and 6 mm (below) |
| 6 | A report fit for a reviewer | For the maintainer to judge: Word and PDF in the project's `m9.6/` folder |

## The runs

| Run | Setup | Mesh | Solver | Time |
| --- | --- | --- | --- | --- |
| ClearFEA 10 mm | as `spec.json`, set up in the UI | 10 mm, quadratic: 26,478 elements, 41,966 nodes | PaStiX | 22 s billed |
| ClearFEA 6 mm | the same at 6 mm | 119,405 elements, 176,853 nodes | PaStiX | 175 s billed |
| ClearFEA constant | the 10 mm run with constant E = 189 GPa, α = 12.4 µm/(m·K), k = 46.3 W/(m·K) in place of the tables | as 10 mm | PaStiX | 19 s billed |
| FreeCAD constant | `freecad_model.py`, set up through FreeCAD's FEM API, constant properties as above | 10 mm, quadratic: 27,571 elements, 44,093 nodes | SPOOLES, CalculiX 2.22 | 81 s |
| FreeCAD tables 10 mm | the same deck with its three material lines replaced by the case's tables (`properties=tables`) | as above | SPOOLES | 136 s |
| FreeCAD tables 6 mm | the same at 6 mm | 6 mm: 120,171 elements, 179,706 nodes | SPOOLES | 1918 s |

ClearFEA: commit d0f2cdb (main after PR #102), CalculiX 2.21, Gmsh 4.15.2 with OpenCASCADE 7.8.1.
FreeCAD 1.0.2 (the released AppImage, which bundles CalculiX 2.22 and Gmsh 4.13.1).

## 1. Start to finish in the UI

The case was set up and run through the browser against `make dev` by a Playwright script that
does what a user does (`m9.6/case-b-ui-run.ts` in the project's folder): upload the STEP file
written by `geometry.py`, confirm its unit, choose the thermal stress analysis and its
stress-free temperature, enter the material's three tables, pick each face by pointing at it in
the viewer (turning the model by dragging to reach the symmetry planes, the bore and the
flange's back), add the three frictionless supports and the two convection loads, mesh, run,
look at the stresses and temperatures, save four views, fill in the report's title block, make
the report and download it and the raw result file. No file was edited by hand and no value
was written through the API. The screenshots are in the project's `m9.6/` folder.

The check names the laptop; that run belongs to M9.2 (Shubham's laptop), so check 1 stays open
until then. For it: the 10 mm mesh estimates 1.5 GiB and 22 s on the small machine size; the
6 mm mesh estimates 8.7 GiB and 4.3 min on the medium (16 GiB) size and was billed 175 s.

## 2. Balances

No structural load is applied, so the three frictionless supports must carry no net force.
Their reactions sum to (−0.0012, −0.0108, −0.0047) N at 10 mm, against 4.70 MN for the sum of
the sizes of their nodal forces (the run's own scale, ADR-067 item 6 and ADR-091): out of
balance 2.5e-7 percent, and 3.8e-7 percent at 6 mm. Each support carries a moment of
7.25 kN·m and the two cuts 55.2 kN·m about their face centres, which cancel: the thermal stress
is self-equilibrated, and the mid-length plane's zero axial force is the free-end condition the
hand checks assume.

The heat in through the bore, 6389 W for the quarter, equals the heat out through the four
cooled faces to 1.4e-6 percent at 10 mm and 8.5e-8 percent at 6 mm. A long pipe of the same wall
would pass 14,494 W per metre of the quarter (below), 5798 W over the model's 400 mm; the flange
adds its own cooled area.

## 3. Through-wall values away from the flange

`through_wall.py` solves the long thick cylinder the wall is between z = 0 and about z = 140
(the flange is 2.5 decay lengths √(R t) away from there):

- **Temperatures.** With k linear in T, the Kirchhoff variable ∫ k dT is logarithmic in r, so the
  wall's resistance is exactly ln(b/a) / (2π k̄) with k̄ at the mean wall temperature. The bore,
  wall and film resistances in series give T(a) = 233.864 °C, T(b) = 153.029 °C, k̄ =
  46.283 W/(m·K) and 57.98 kW per metre of full pipe; T(r) follows by inverting the transform.
- **Stresses, closed form.** Timoshenko and Goodier's hollow cylinder with free ends (Theory of
  Elasticity, §150) with the thermal strain ε(r) = α(T) (T − 20 °C) (ADR-068 item 4: mean
  coefficients from 20 °C, which is also the stress-free temperature) and E constant at its
  value at the mean wall temperature, 188.85 GPa.
- **Stresses, E varying.** The same problem with E(T) through the wall, solved by integrating
  radial equilibrium and Hooke's law in generalised plane strain across the wall (4000
  Runge-Kutta steps; σr = 0 at both surfaces and no net axial force fix the two unknowns). This
  is the reference: it has no approximation beyond the long-cylinder assumption.
- The script checks itself first: its closed form against Timoshenko's formulas for a
  logarithmic temperature and constant α and E, and its integration against its closed form
  with E constant, both to 1e-5 of the stress scale.

`compare.py` reads the result files and takes the values at five radii over 30 ≤ z ≤ 90 mm, all
round the quarter: the mean over the surface nodes at the bore and the outside, and a
least-squares quadratic in r through the nodes within 4 mm inside the wall. Temperatures (°C)
and stresses (MPa):

| r | T hand | T 10 mm | T 6 mm | σθ closed form | σθ E varying | σθ 10 mm | σθ 6 mm | σz E varying | σz 10 mm | σz 6 mm |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 100 (bore) | 233.86 | 233.85 | 233.85 | −165.94 | −164.51 | −162.94 | −163.19 | −164.36 | −163.08 | −163.08 |
| 112.5 | 210.07 | 210.05 | 210.05 | −66.49 | −66.86 | −65.53 | −65.94 | −79.38 | −78.64 | −78.75 |
| 125 | 189.00 | 188.99 | 188.99 | 10.45 | 9.83 | 10.64 | 10.52 | −4.24 | −4.14 | −4.16 |
| 137.5 | 170.12 | 170.11 | 170.11 | 72.03 | 72.05 | 72.68 | 72.48 | 63.00 | 62.63 | 62.52 |
| 150 (outside) | 153.03 | 153.01 | 153.01 | 122.68 | 123.87 | 124.24 | 124.11 | 123.76 | 122.75 | 122.68 |

Von Mises stress at the bore and the outside: 164.43 and 123.82 by hand, 161.59 and 123.86 at
10 mm, 162.60 and 123.52 at 6 mm. σr is −1.4 and −0.4 MPa at the two surfaces in the run
(0 by hand), the nodal extrapolation's error in a steep gradient.

Reading it:

- **Temperatures agree to 0.02 K** at every radius.
- **The stresses agree within 1.6 MPa** (1 percent of the peak) at both meshes, and the
  refinement moves them towards the reference by up to 0.4 MPa. The largest difference is at the
  bore, where the surface values are extrapolated from the integration points through the
  steepest gradient; FreeCAD's independent model reads the same 1 to 1.5 MPa low there (check 5).
- **E varying through the wall matters by about 1 percent**: the closed form with E at the mean
  temperature is 1.4 MPa beyond the reference at the bore and 1.2 MPa short at the outside. At
  the outside, the run (124.24, 124.11) follows the varying-E reference (123.87) rather than the
  closed form (122.68).
- At r = 125 the hoop stress passes through zero, so its percentage difference means nothing
  there (von Mises 20.8 by hand, 21.7 and 21.3 in the runs).

`case.yaml` now checks the hoop, axial and von Mises stress at the bore and the outside against
the varying-E reference, to 3 percent. `CASES=B make verify` reads (MPa):

| Check | Reference | 10 mm | 6 mm |
| --- | --- | --- | --- |
| Bore hoop stress | −164.51 | −163.09 (−0.87 %) | −163.24 (−0.77 %) |
| Bore axial stress | −164.36 | −163.08 (−0.78 %) | −163.08 (−0.78 %) |
| Bore von Mises stress | 164.43 | 161.59 (−1.73 %) | 162.60 (−1.12 %) |
| Outside hoop stress | 123.87 | 124.17 (+0.25 %) | 124.05 (+0.15 %) |
| Outside axial stress | 123.76 | 122.75 (−0.82 %) | 122.68 (−0.88 %) |
| Outside von Mises stress | 123.82 | 123.86 (+0.03 %) | 123.52 (−0.24 %) |

19 of 19 checks pass at both tiers, with the two temperature checks, the heat balance and the
support balance (2.5e-7 and 3.8e-7 percent). The 3 percent leaves room for the bore's surface
extrapolation, which FreeCAD shares; a wrong property, unit or reference temperature moves these
values by 5 percent or more (constant against table properties: 7 percent at the bore).

## 5. FreeCAD FEM

`freecad_model.py` sets the case up independently through FreeCAD 1.0.2's FEM API, the way the
FEM workbench does, and FreeCAD writes the CalculiX deck. Differences from the ClearFEA setup,
each a choice FreeCAD forces or the natural one there:

- **Analysis**: FreeCAD's thermomechanical analysis, steady state (CalculiX's
  `*COUPLED TEMPERATURE-DISPLACEMENT, STEADY STATE`), solved in one step by Newton iterations,
  where ClearFEA solves a heat transfer step and then a static step on its temperatures
  (ADR-067). For a steady state the temperatures do not depend on the displacements, so the two
  are the same problem.
- **Stress-free temperature**: FreeCAD's initial temperature, 20 °C; it writes `*EXPANSION`
  without a reference, so its thermal strain is α (T − 20 °C).
- **Frictionless supports**: displacement constraints holding only the normal component of
  each plane.
- **Material**: FreeCAD 1.0's materials hold one value per property, with no temperature
  tables. So the comparison is made twice:
  1. **As written**: FreeCAD's model exactly as FreeCAD writes it, with constant properties
     (E = 189 GPa, α = 12.4 µm/(m·K), k = 46.3 W/(m·K), round values near the wall's mean),
     against a ClearFEA run with the same constants entered in the UI.
  2. **With the case's tables**: the same deck with FreeCAD's three one-line material blocks
     (`*ELASTIC`, `*CONDUCTIVITY`, `*EXPANSION`) replaced by the case's tables in kelvin and the
     expansion measured from 20 °C (`*EXPANSION, ZERO=293.15`), against case B itself. Nothing
     else in FreeCAD's deck changes.
- **Mesh**: FreeCAD's Gmsh mesher at the same size and quadratic order: 27,571 elements at
  10 mm against ClearFEA's 26,478.

`compare.py` samples both result files at the same places with the same rule: the far field as
in check 3, and seven points on the surface near the flange (each the inverse-distance mean of
the surface nodes within 8 mm), plus each run's largest von Mises stress, wherever it is. In
both codes it is on the bore under the flange, where the flange's cooler ring holds the bore's
thermal growth back (σθ about −280 MPa).

**As written, constant properties, 10 mm.** Far field, MPa (temperatures agree to 0.01 K):

| r | Hand σθ | ClearFEA σθ | FreeCAD σθ | ClearFEA σz | FreeCAD σz | ClearFEA VM | FreeCAD VM |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | −153.37 | −151.88 | −151.96 | −152.11 | −152.16 | 150.75 | 150.76 |
| 112.5 | −62.97 | −61.74 | −61.67 | −74.07 | −74.06 | 56.68 | 56.65 |
| 125 | 8.75 | 9.49 | 9.50 | −4.39 | −4.38 | 19.94 | 19.93 |
| 137.5 | 67.59 | 68.15 | 68.18 | 58.74 | 58.74 | 72.60 | 72.63 |
| 150 | 117.20 | 117.50 | 117.50 | 116.18 | 116.18 | 117.17 | 117.17 |

Near the flange (T in °C, stresses MPa, difference in von Mises):

| Point | ClearFEA T | FreeCAD T | ClearFEA σθ | FreeCAD σθ | ClearFEA VM | FreeCAD VM | Diff. VM |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Bore at the flange, z = 370 | 213.97 | 213.80 | −263.26 | −264.28 | 245.01 | 246.46 | +0.6 % |
| Bore at the end, z = 400 | 191.59 | 191.68 | −173.41 | −174.11 | 173.68 | 174.88 | +0.7 % |
| Pipe outside, z = 250 | 150.90 | 150.88 | 124.05 | 123.73 | 144.85 | 145.04 | +0.1 % |
| Pipe outside, z = 320 | 138.13 | 138.43 | 79.40 | 79.71 | 124.84 | 125.45 | +0.5 % |
| Flange back, r = 190 | 63.29 | 63.93 | 121.27 | 120.74 | 137.66 | 137.88 | +0.2 % |
| Flange rim, z = 370 | 51.17 | 51.20 | 109.58 | 109.47 | 109.90 | 109.72 | −0.2 % |
| Flange end face, r = 165 | 79.84 | 79.02 | 67.58 | 68.78 | 96.17 | 96.77 | +0.6 % |
| Largest von Mises anywhere | 214.71 | 214.53 | −268.20 | −267.57 | 248.72 | 248.80 | +0.0 % |

**With the case's tables.** Far field at 10 mm, MPa:

| r | Hand σθ | ClearFEA σθ | FreeCAD σθ | ClearFEA VM | FreeCAD VM | Diff. VM |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | −164.51 | −162.94 | −163.49 | 161.59 | 162.06 | +0.3 % |
| 112.5 | −66.86 | −65.53 | −65.64 | 60.07 | 60.20 | +0.2 % |
| 125 | 9.83 | 10.64 | 10.69 | 21.69 | 21.73 | +0.2 % |
| 137.5 | 72.05 | 72.68 | 72.91 | 77.38 | 77.63 | +0.3 % |
| 150 | 123.87 | 124.24 | 124.56 | 123.86 | 124.21 | +0.3 % |

Near the flange, at 10 mm (T in °C, stresses MPa) and on the 6 mm meshes. At 6 mm the far field
agrees within 0.5 MPa between the two codes, and both are within 1.3 MPa of the hand values.

| Point | ClearFEA T | FreeCAD T | ClearFEA σθ | FreeCAD σθ | ClearFEA VM | FreeCAD VM | Diff. VM | ClearFEA VM 6 mm | FreeCAD VM 6 mm | Diff. VM 6 mm |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Bore at the flange, z = 370 | 213.35 | 213.30 | −272.20 | −273.64 | 251.18 | 253.02 | +0.7 % | 253.09 | 253.62 | +0.2 % |
| Bore at the end, z = 400 | 190.96 | 191.14 | −176.32 | −177.09 | 176.70 | 178.02 | +0.7 % | 176.95 | 177.02 | +0.0 % |
| Pipe outside, z = 250 | 150.84 | 150.66 | 130.46 | 130.43 | 152.30 | 152.79 | +0.3 % | 152.12 | 152.53 | +0.3 % |
| Pipe outside, z = 320 | 137.85 | 138.07 | 82.87 | 83.40 | 129.05 | 129.91 | +0.7 % | 129.63 | 129.78 | +0.1 % |
| Flange back, r = 190 | 63.88 | 64.48 | 123.30 | 122.79 | 140.46 | 140.75 | +0.2 % | 140.69 | 140.73 | +0.0 % |
| Flange rim, z = 370 | 51.97 | 51.97 | 110.94 | 110.87 | 111.36 | 111.23 | −0.1 % | 111.16 | 111.17 | +0.0 % |
| Flange end face, r = 165 | 80.15 | 79.31 | 68.42 | 69.75 | 99.12 | 99.82 | +0.7 % | 99.13 | 99.58 | +0.5 % |
| Largest von Mises anywhere | 216.13 | 215.73 | −282.27 | −281.33 | 255.38 | 255.84 | +0.2 % | 255.42 | 255.48 | +0.0 % |

Reading it:

- **Like for like, the two codes give the same answer.** With the same constant properties
  ClearFEA and FreeCAD agree to 0.1 MPa in the far field and within 0.7 percent at every point
  near the flange, with temperatures within 0.9 K (the largest on the flange's end face, at
  51 to 80 °C, where the two meshes differ most).
- **With the case's tables they agree as closely**: within 0.3 percent in the far field and
  within 0.7 percent near the flange (0.5 percent at 6 mm). The temperature-dependent properties change the
  stresses by up to 7 percent (bore σθ −151.9 constant against −162.9 with tables), and both
  codes move the same way.
- So check 5 is met: within 1 percent on a matching mesh, against the 5 percent asked for, with
  FreeCAD's model as FreeCAD writes it, and also with the tables FreeCAD's material dialog
  cannot enter.

## 6. The report

The report of the 6 mm run, made through the UI (Word and PDF, 11 pages, in the project's
`m9.6/` folder), is for the maintainer to judge. Two things a reviewer may ask about, both
outside M9.6:

- Its "Simulation" row reads "Static structural", the name every new simulation gets
  (`NEW_SIMULATION_NAME`), although the analysis type row below says thermal stress.
- The material table lists "Young's modulus (not entered)" above the table of Young's modulus
  against temperature, since only the table was entered; a thermal stress run uses the table.

## Open

- Check 1 on the laptop (M9.2).
- Check 6: the maintainer's judgement of the report.

## How to rerun

```
cd worker
uv run python ../verification/acceptance/B-flanged-pipe-thermal/geometry.py B.step
python3 ../verification/acceptance/B-flanged-pipe-thermal/through_wall.py --json hand.json
python3 ../verification/acceptance/B-flanged-pipe-thermal/through_wall.py \
    --constant 189,12.4e-6,46.3 --json hand-constant.json
FreeCAD_1.0.2-conda-Linux-x86_64-py311.AppImage freecadcmd \
    ../verification/acceptance/B-flanged-pipe-thermal/freecad_model.py \
    --pass B.step out size=10 properties=tables
uv run python ../verification/acceptance/B-flanged-pipe-thermal/compare.py \
    clearfea=results.frd:si freecad=out/Mesh.frd:mm --hand hand.json
CASES=B make verify BUILD_CA=/root/.ccr/ca-bundle.crt   # from the repository root
```

ClearFEA's `results.frd` is the run's raw output, downloaded from the Run panel.
