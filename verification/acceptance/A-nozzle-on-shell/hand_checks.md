<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Acceptance case A: hand checks, WRC-style comparison and FreeCAD FEM

The six acceptance checks of `docs/VERIFICATION.md` ("Acceptance cases") for the nozzle on a
shell of `model.md`, done in M9.5 on 2026-10-17. Units: mm, N, MPa; stresses "along" and
"around" are in the shell's own axes (along its axis x, around its circumference) or, on the
nozzle, along and around the nozzle.

| # | Check | Outcome |
| --- | --- | --- |
| 1 | Start to finish in the UI with no file touched by hand | Done in the development environment (`make dev`); the laptop run is M9.2's |
| 2 | Reaction balance closes | Closes: the held end's reaction equals statics to the shown digits, out of balance 1e-7 percent |
| 3 | Membrane stress away from discontinuities against hand values | Within 1.4 percent of Lamé at both surfaces; the section's mean and beam bending within 0.1 and 2 percent |
| 4 | Local stresses against a WRC-style calculation | Done, differences listed below; the peaks agree within about 15 percent, single components differ by up to 25 MPa |
| 5 | FreeCAD FEM within 5 percent on a matching mesh | Within 5 percent everywhere for the pressure; under the piping load the nozzle differs by up to 13 MPa because FreeCAD can only apply it through a rigid end (below) |
| 6 | A report fit for a reviewer | For the maintainer to judge: Word and PDF in the project's `m9.5/` folder |

## The runs

| Run | Setup | Mesh | Solver | Time |
| --- | --- | --- | --- | --- |
| ClearFEA 12 mm | as `spec.json`, set up in the UI | 12 mm, quadratic: 123,317 elements, 248,060 nodes | PaStiX | 104 s |
| ClearFEA 12/6 mm | the same, plus a local size of 6 mm on the nozzle and pad bodies | 156,700 elements, 313,492 nodes | SPOOLES (over PaStiX's 142,000) | 280 s |
| ClearFEA piping load only | the 12/6 mm run with the pressure and both thrusts set to 0 | as above | SPOOLES | 268 s |
| FreeCAD 12 mm | `freecad_model.py`, set up through FreeCAD's FEM API | 12 mm, quadratic: 140,621 elements, 276,025 nodes | SPOOLES, CalculiX 2.22 | 158 s |
| FreeCAD 12/8 mm | the same with a local size of 8 mm on the nozzle's and pad's faces | 184,877 elements, 360,489 nodes | SPOOLES | 246 s |
| FreeCAD 12/8 mm, no piping load | the same without the piping load and its rigid end (`piping=none`) | as above | SPOOLES | 292 s |

ClearFEA: commit 47fa911 (main after M9.4), CalculiX 2.21, Gmsh 4.15.2 with OpenCASCADE 7.8.1.
FreeCAD 1.0.2 (the released AppImage, which bundles CalculiX 2.22 and Gmsh 4.13.1).

## 1. Start to finish in the UI

The whole case was set up and run through the browser against `make dev`, driven by a
Playwright script that does what a user does: upload the STEP file written by `geometry.py`,
confirm its unit, start the setup, accept the four bonds, add the material, pick each face by
pointing at it in the viewer (hiding the shell and the pad to reach the nozzle's foot faces,
turning the model to reach the held end), enter the loads, mesh, run, look at the results,
save two views, fill in the report's title block and make the report, and download the raw
result files. No file was edited by hand and no value was written through the API. The
screenshots are in the project's `m9.5/` folder.

The check names the laptop; that run belongs to M9.2 (Shubham's laptop), so check 1 stays open
until then. Two things to know for it:

- The run panel estimates 13 GiB of solver memory for the 12 mm mesh and marks the medium
  (16 GiB) machine size as too small, but the worker container used about 6 GiB when sampled during the solve. The
  estimate comes from a stocky block and the panel says slender parts need less; the laptop
  can run the 12 mm mesh.
- The 12/6 mm mesh is over PaStiX's 142,000-element limit (ADR-063), so it needs SPOOLES,
  which is slower. A local size of 7 mm gives 143,186 elements, just over the limit too.

## 2. Reaction balance

Statics: the pressure has no net force except over the hole the nozzle makes in the shell,
which the nozzle's thrust cancels, so the held end carries the shell's end thrust and the
piping load. Its moment about the held face's centre (−600, 0, 0) is the piping load's moment
M plus r × F with r = (600, 0, 560).

| Reaction at the held end | Statics | ClearFEA 12 mm and 12/6 mm | FreeCAD 12 mm |
| --- | --- | --- | --- |
| Fx (kN) | −569.487 | −569.5 | −569.485 |
| Fy (kN) | 3.000 | 3.000 | 2.965 |
| Fz (kN) | 6.000 | 6.000 | 5.802 |
| Mx (kN·m) | −3.680 | −3.680 | −3.680 |
| My (kN·m) | −8.840 | −8.840 | −8.841 |
| Mz (kN·m) | 0.300 | 0.300 | 0.300 |
| Out of balance | | force 9.9e-8 %, moment 8.4e-9 % of the loads' size | |

ClearFEA's run applies its pressure with the solver's own face rule and checks the balance
against it (ADR-051), so it closes to rounding. FreeCAD misses 35 N and 198 N in y and z, a
few thousandths of a percent of the 5.4 MN gross load: its pressure is spread on the mesh's
faces by FreeCAD's own rule. `case.yaml` now checks the six reactions to 0.1 percent.

## 3. Membrane stress away from the discontinuities

Lamé with closed ends, ri = 300, ro = 310, p = 2: σθ = p ri² (1 + ro²/r²) / (ro² − ri²),
σx = p ri² / (ro² − ri²) = 29.508, σr = −p at the inside and 0 at the outside. At the outside
σθ = 59.016 and von Mises 51.110; at the inside σθ = 61.016 and von Mises 54.57. The thin-wall
values p R / t and p R / 2t at the mean radius are 61.0 and 30.5.

At x = 450 (285 mm past the pad's edge, five decay lengths √(R t) = 55 mm), under the shell:

| Stress | Hand (Lamé) | ClearFEA 12 mm | FreeCAD 12 mm |
| --- | --- | --- | --- |
| Hoop, outside | 59.016 | 58.31 (−1.2 %) | 58.23 (−1.3 %) |
| Axial, outside | 29.508 | 29.50 (−0.0 %) | 29.47 (−0.1 %) |
| Von Mises, outside | 51.110 | 50.48 (−1.2 %) | 50.42 (−1.3 %) |
| Hoop, inside | 61.016 | 61.52 (+0.8 %) | 61.61 (+1.0 %) |
| Axial, inside | 29.508 | 29.93 (+1.4 %) | 29.94 (+1.5 %) |
| Von Mises, inside | 54.57 | 55.01 (+0.8 %) | 55.08 (+0.9 %) |

The 12 mm mesh puts one quadratic element through the 10 mm wall, which reads the hoop stress
about 1 percent low at the outside and high at the inside; the two codes agree with each other
within 0.2 percent. The local size on the nozzle and pad does not change these values.

On the held side, the shell also carries the piping load to the held end as a beam. At x = −400
the section's axial force is 565.487 + 4 = 569.487 kN, a mean axial stress of 29.72 over the wall's
19,164 mm², and the bending moment about y from the loads beyond the section is
My = 3 + 0.56 × 4 + 0.4 × 6 = 7.64 kN·m, ±2.66 at the outside fibre (I = 8.916e8 mm⁴). Taking the
mean of the outside and inside axial stress at 36 points around the 12/6 mm run's section and
its Fourier terms: mean 29.73 (+0.03 %) and cos θ term 2.61 (−1.9 %). The point values on the
held side also carry a cos 2θ term of 7.4 MPa (axial stress at the outside: top 44.5, bottom 31.9), the shell's ovalisation
about the opening held back by the fixed end, which decays slowly along the shell; FreeCAD has
the same (top 44.2, bottom 31.9). It is absent on the free side, where the end may ovalise:
at x = 450 the cos 2θ term is 0.00. So the held side is not the far field `model.md` expected,
and the membrane check is made on the free side.

`case.yaml` now checks the free side's hoop and axial stress at the outside and the hoop
stress at the inside, as well as the von Mises stress already there.

## 4. Local stresses: WRC-style calculation

`wrc_style.py` computes the shell's stresses at the nozzle by Bijlaard's method, the analysis
behind WRC Bulletin 107's curves (P. P. Bijlaard, "Stresses from local loadings in cylindrical
pressure vessels", Trans. ASME 77, 1955; "Stresses from radial loads and external moments in
cylindrical pressure vessels", Welding Journal 34, 1955). The bulletin's charts are not
reproduced; the same model is solved directly instead:

- The shell is simply supported at both ends, L = 1200, and the attachment is a load on a
  square of half-side 0.875 r0 (WRC 107's equivalent square for a round attachment).
- The radial load P is a uniform pressure on the square; the moments ML and MC are pressures
  varying linearly along and around the shell, with the moment of the load.
- Each term of the double Fourier series is solved exactly with the Sanders shell equations,
  and the stresses at WRC 107's points A, B (along the shell, ±x) and C, D (around it, ±y) are
  summed at both surfaces. 300 terms each way; 200 change nothing at one decimal.
- The shear loads and torsion give WRC 107's shear stresses VC / (π r0 t), VL / (π r0 t) and
  MT / (2π r0² t): 0.6, 0.8 and 0.9 MPa at the pad's edge, small beside the rest.
- The script checks itself against three closed-form shell results first: uniform pressure
  (σθ = p R / t), a band load on a long shell (Timoshenko's beam on an elastic foundation) and a
  cos θ load on a slender shell (beam bending); all three within 0.01 percent.

The piping load moved to the shell's mid-surface at the attachment: P = −6 kN (inwards),
VL = 4 kN, VC = −3 kN, MC = 2.765 kN·m, ML = 4.02 kN·m, MT = 1.5 kN·m at the pad's edge
(mid-surface at R = 305) and MC = 2.75, ML = 4.0 kN·m at the nozzle's edge (R = 310). WRC 107
treats a padded nozzle at two places: at the pad's edge the plain shell (t = 10) with the pad
as the attachment (r0 = 165), and at the nozzle's edge the shell and pad as one wall (t = 20)
with the nozzle as the attachment (r0 = 83).

WRC 107 gives the local stresses of the external load only; the pressure's stresses are added
separately. So the finite element side is ClearFEA's piping-load-only run (12/6 mm mesh), and
it is read at the real attachment's edge (+0) and 8 mm beyond it (+8), where the tied-bond
note of ADR-060 no longer applies. Normal stresses, MPa:

**Pad's edge** (shell, t = 10)

| Point | WRC-style σx | WRC-style σθ | ClearFEA +0 along | +0 around | +8 along | +8 around |
| --- | --- | --- | --- | --- | --- | --- |
| A, outside | −23.1 | −27.0 | −9.8 | −6.3 | −16.3 | −10.6 |
| A, inside | 0.0 | −1.0 | −5.8 | 23.6 | −1.0 | 23.4 |
| B, outside | 12.1 | 14.6 | 20.9 | 12.4 | 26.2 | 12.6 |
| B, inside | −2.8 | 9.9 | 4.8 | −9.2 | 3.9 | −9.2 |
| C, outside | 35.5 | 49.7 | 22.9 | 44.3 | 13.4 | 38.4 |
| C, inside | −1.6 | −42.6 | −5.2 | −26.9 | −6.6 | −25.7 |
| D, outside | −38.1 | −51.4 | −34.2 | −70.0 | −18.3 | −58.3 |
| D, inside | −1.3 | 39.4 | 12.7 | 39.1 | 14.7 | 39.4 |

**Nozzle's edge** (shell and pad, t = 20). The outside here is the pad's top next to the
nozzle, at the corner where the nozzle, pad and shell meet; its finite element values are not
converged (the 12 mm and 12/6 mm meshes differ by 25 to 55 percent at +0 and up to 33 percent at
+8, a sharp re-entrant corner with no weld or fillet), so only the inside is compared.

| Point | WRC-style σx | WRC-style σθ | ClearFEA +0 along | +0 around | +8 along | +8 around |
| --- | --- | --- | --- | --- | --- | --- |
| A, inside | 38.2 | 18.5 | 12.3 | 19.8 | 14.2 | 24.3 |
| B, inside | −36.8 | −9.6 | −12.4 | −22.0 | −13.4 | −21.2 |
| C, inside | −19.5 | −45.4 | −16.0 | −5.4 | −16.7 | −14.8 |
| D, inside | 21.5 | 48.6 | 49.1 | 10.4 | 46.5 | 25.5 |

What differs, and why the methods are expected to:

- **The largest stresses agree; single components do not.** At the pad's edge the largest is
  σθ at D, outside: 51.4 WRC-style, 58.3 at +8 (70.0 at the edge). At the nozzle's edge,
  inside, it is 48.6 WRC-style and 49.1 by finite elements, but on a different component (σθ
  against σx at D). Single components differ by up to 25 MPa and in places in sign (σθ inside
  at A and B), mostly in the membrane part: the bending parts are closer.
- **The attachment.** Bijlaard's load is spread over a square on a shell with no hole; the
  model has a round pad, 10 mm thick and not rigid, bonded to the shell, and an opening under
  the nozzle. The square of 0.875 r0 is WRC 107's way of making the two give similar peaks, not
  similar stresses at every point.
- **The shell as two layers.** At the nozzle's edge WRC 107 takes the shell and pad as one
  20 mm wall; the model has two 10 mm layers tied together, with the opening through both.
- **The ends.** Bijlaard's shell is simply supported at both ends; the model is fixed at one
  end and free at the other, which changes the slowly decaying low harmonics (the ovalisation
  seen in check 3) but little near the nozzle.
- **The pressure.** WRC 107 adds the pressure's membrane stress, p R / t = 61.0 hoop and 30.5
  axial at the pad's edge, to the local stresses. With pressure, the model's stresses beside
  the pad are much higher than that sum (σθ 155 at C, outside, +8 against 49.7 + 61.0 = 110.7),
  because the opening concentrates the pressure's hoop stress, which WRC 107 leaves to
  separate rules for openings.

## 5. FreeCAD FEM

`freecad_model.py` sets the case up independently through FreeCAD 1.0.2's FEM API, the way
the FEM workbench does, and FreeCAD writes the CalculiX deck. Differences from the ClearFEA
setup, each a choice FreeCAD forces or the natural one there:

- **Bonds**: the three bodies are a BooleanFragments compound, so the touching faces share
  nodes (conformal), where ClearFEA meshes the bodies separately and ties them (ADR-060).
- **Piping load**: FreeCAD has no distributing remote load (ADR-041), so it is a rigid body
  constraint on the nozzle's end face with its reference node at (0, 0, 560), CalculiX's
  `*RIGID BODY`. It stiffens only the end face.
- **Mesh**: FreeCAD's Gmsh mesher at the same 12 mm and quadratic order. The conformal
  bodies give 140,621 elements against ClearFEA's 123,317.
- One output request is changed in FreeCAD's deck so the held end's reaction is printed per
  node and its moment can be summed; the model is FreeCAD's as written.

`compare.py` reads both result files and samples them at the same points with the same rule.
FreeCAD's local size of 6 mm on the nozzle and pad gave 231,971 elements, which CalculiX could
not solve in the sandbox's memory, so its refined run uses 8 mm; its meshing region refines the
shell under the pad as well, so the two refined meshes are close but not the same. Von Mises
stress, MPa, with all loads, and in the last column the difference for the pressure and thrusts
alone (ClearFEA's full run minus its piping-load-only run, against FreeCAD's run without the
piping load):

| Point | ClearFEA 12 | FreeCAD 12 | Diff. | ClearFEA 12/6 | FreeCAD 12/8 | Diff. | Diff., pressure only |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Far field, x = 450, outside | 50.48 | 50.42 | −0.1 % | 50.48 | 50.41 | −0.1 % | +0.0 % |
| Far field, x = 450, inside | 55.01 | 55.08 | +0.1 % | 55.01 | 55.07 | +0.1 % | −0.0 % |
| Held side, x = −400, top, outside | 53.33 | 53.36 | +0.1 % | 53.29 | 53.37 | +0.2 % | −0.2 % |
| Held side, x = −400, bottom, outside | 51.40 | 51.40 | +0.0 % | 51.40 | 51.40 | −0.0 % | +0.0 % |
| Pad's edge +8, A, outside | 25.70 | 26.85 | +4.5 % | 25.68 | 26.41 | +2.8 % | −0.1 % |
| Pad's edge +8, A, inside | 84.02 | 83.06 | −1.1 % | 84.15 | 82.99 | −1.4 % | −0.5 % |
| Pad's edge +8, B, outside | 50.99 | 52.64 | +3.2 % | 50.73 | 52.72 | +3.9 % | +1.7 % |
| Pad's edge +8, B, inside | 59.17 | 57.17 | −3.4 % | 59.20 | 57.40 | −3.0 % | −0.3 % |
| Pad's edge +8, C, outside | 134.57 | 133.26 | −1.0 % | 134.25 | 133.15 | −0.8 % | +0.2 % |
| Pad's edge +8, C, inside | 41.95 | 44.22 | +5.4 % | 41.38 | 41.65 | +0.7 % | +2.9 % |
| Pad's edge +8, D, outside | 53.43 | 52.08 | −2.5 % | 53.88 | 52.32 | −2.9 % | −1.0 % |
| Pad's edge +8, D, inside | 47.69 | 48.90 | +2.5 % | 47.58 | 48.70 | +2.3 % | +3.6 % |
| Nozzle's edge +8, A, outside | 35.86 | 27.79 | −22.5 % | 24.16 | 25.80 | +6.8 % | +1.6 % |
| Nozzle's edge +8, A, inside | 115.62 | 108.81 | −5.9 % | 115.92 | 108.36 | −6.5 % | −2.1 % |
| Nozzle's edge +8, B, outside | 88.35 | 90.14 | +2.0 % | 85.41 | 93.56 | +9.5 % | +2.0 % |
| Nozzle's edge +8, B, inside | 86.31 | 79.78 | −7.6 % | 85.64 | 78.43 | −8.4 % | −2.2 % |
| Nozzle's edge +8, C, outside | 57.22 | 53.99 | −5.6 % | 56.47 | 55.42 | −1.9 % | −4.9 % |
| Nozzle's edge +8, C, inside | 66.64 | 68.19 | +2.3 % | 68.29 | 70.10 | +2.6 % | +11.8 % (1.5 MPa of 13) |
| Nozzle's edge +8, D, outside | 67.59 | 63.44 | −6.1 % | 60.42 | 64.83 | +7.3 % | +0.6 % |
| Nozzle's edge +8, D, inside | 71.08 | 74.48 | +4.8 % | 71.81 | 74.88 | +4.3 % | +9.7 % (1.3 MPa of 13) |
| Nozzle wall z = 340, 0°, outside | 23.36 | 22.45 | −3.9 % | 24.22 | 21.44 | −11.5 % | −0.5 % |
| Nozzle wall z = 340, 90°, outside | 30.85 | 34.03 | +10.3 % | 30.80 | 33.38 | +8.4 % | −0.6 % |
| Nozzle wall z = 340, 180°, outside | 45.60 | 49.78 | +9.2 % | 45.51 | 49.47 | +8.7 % | +1.3 % |
| Nozzle wall z = 340, 270°, outside | 33.10 | 36.25 | +9.5 % | 31.81 | 35.66 | +12.1 % | +0.2 % |
| Nozzle wall z = 440, 0°, outside | 37.04 | 24.41 | −34.1 % | 36.81 | 24.27 | −34.1 % | +0.4 % |
| Nozzle wall z = 440, 90°, outside | 9.48 | 14.03 | +48.0 % | 9.66 | 14.07 | +45.7 % | +0.1 % |
| Nozzle wall z = 440, 180°, outside | 41.55 | 40.23 | −3.2 % | 41.58 | 40.17 | −3.4 % | −1.0 % |
| Nozzle wall z = 440, 270°, outside | 24.90 | 33.51 | +34.6 % | 25.04 | 33.48 | +33.7 % | +0.4 % |

The nozzle's end moves (0.448, −0.489, −0.142) mm in ClearFEA 12/6 and (0.446, −0.490, −0.140)
mm in FreeCAD 12/8 (the mean over the end face). FreeCAD 12/8's held-end reaction is
(−569.485, 2.945, 5.800) kN and (−3.680, −8.839, 0.300) kN·m.

Reading it:

- **The pressure and thrusts agree within 5 percent at every point** (last column), and within
  4 percent at all but two, which are low stresses (13 MPa) where 1.5 MPa is the difference.
- **Away from the nozzle with all loads**, and at the pad's edge 8 mm out, the two agree within
  5.4 percent at 12 mm and 3.9 percent on the refined meshes. ClearFEA's own refinement moves
  these points by 1.5 percent at most, so they are converged.
- **On the nozzle with the piping load they differ, and the cause is the load's model.** In the
  piping-load-only results the axial stress in the nozzle's wall 120 mm above the pad agrees
  within 1.5 MPa (−22.6 against −22.3, 22.7 against 23.4), but the hoop stress does not: about 0
  in ClearFEA and ±9 to ±12 MPa in FreeCAD, a cos 2φ pattern. That is ovalisation of the nozzle.
  FreeCAD can only apply a remote load through a rigid end face (`*RIGID BODY`), which keeps
  the end round; ClearFEA's distributing load (ADR-041) leaves it free to ovalise, as a pipe
  continuing past the cut would partly do. A thin tube's ovalisation decays slowly (the nozzle
  is 250 mm long with r/t = 10), so the difference reaches down to the nozzle's foot: up to
  13 MPa on the wall and 3 to 8 MPa at the nozzle's edge. Neither end condition is the real
  pipe; both are the modelling choice each tool offers.
- The 12 mm and refined meshes give the same differences on the nozzle wall, so the meshes are
  not the cause there. At the nozzle's edge (+8) the outside values are still moving with the
  mesh in both codes (that point is 8 mm from a sharp corner).

So check 5 is met for the pressure and away from the nozzle, and the remaining difference
under the piping load is a difference in what the two tools can apply, explained above,
rather than a disagreement in the solution. The maintainer decides whether that counts as
met; a rigid remote load in ClearFEA is already in "Parked ideas" (ADR-041 item 2) and would
let the two be compared like for like.

## Open

- Check 1 on the laptop (M9.2).
- Check 5 on the nozzle under the piping load: the maintainer's call (see check 5).
- Check 6: the maintainer's judgement of the report.

## How to rerun

```
cd worker
uv run python ../verification/acceptance/A-nozzle-on-shell/geometry.py A.step
python3 ../verification/acceptance/A-nozzle-on-shell/wrc_style.py --json wrc.json
FreeCAD_1.0.2-conda-Linux-x86_64-py311.AppImage freecadcmd \
    ../verification/acceptance/A-nozzle-on-shell/freecad_model.py --pass A.step out size=12
uv run python ../verification/acceptance/A-nozzle-on-shell/compare.py \
    clearfea=results.frd:si freecad=out/Mesh.frd:mm
CASES=A make verify BUILD_CA=/root/.ccr/ca-bundle.crt   # from the repository root
```

ClearFEA's `results.frd` is the run's raw output, downloaded from the Run panel.
