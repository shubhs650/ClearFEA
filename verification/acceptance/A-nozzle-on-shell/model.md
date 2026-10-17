<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Acceptance case A: nozzle with reinforcing pad on a cylindrical shell

The model for acceptance case A (docs/VERIFICATION.md, "Acceptance cases"), built in M9.4. M9.5
sets it up through the UI on the laptop, does the hand checks, the WRC-style comparison and the
FreeCAD FEM run. Everything here is an original design made for this project: no dimension,
load or property is taken from a standard, a textbook figure or a vendor drawing, so the model
can be published.

## Geometry (`geometry.py`, millimetres)

| Body | Shape |
| --- | --- |
| Shell | Cylinder along x, inside radius 300, wall 10 (outside radius 310), from x = −600 to +600 |
| Nozzle | Cylinder along z through x = 0, inside radius 75, wall 8 (outside radius 83), set in through shell and pad with its foot flush with the shell's inside, end at z = 560 (250 out from the shell) |
| Reinforcing pad | 10 thick on the shell's outside (radius 310 to 320), the part inside a 165 radius cylinder about the nozzle's axis, with the nozzle's 83 radius hole |

The three solids touch and are not fused, so the import finds three bonds (shell–nozzle,
pad–nozzle, pad–shell), all tied. They are named "Shell", "Nozzle" and "Reinforcing pad" in
the STEP file. `uv run --directory worker python ../verification/acceptance/A-nozzle-on-shell/geometry.py A.step`
writes the file; nothing binary is committed.

Proportions: shell R/t = 30.5, nozzle r/t = 9.9, nozzle to shell diameter ratio d/D = 0.27, pad
outside diameter 2 × the nozzle's, pad as thick as the shell. The shell's bending decay length
√(R t) is 55 mm, so a junction effect has died out about 2.5 √(R t) ≈ 140 mm from its source.
That puts the far field on the free side from x ≈ 165 + 140 ≈ 305 mm to the free end, and on
the held side between x ≈ −305 and x ≈ −460 (the held end's own edge effect reaches about
140 mm in).

## Setup (`spec.json`)

| Item | Faces | Value |
| --- | --- | --- |
| Material, all three bodies | | Carbon steel (case values): E = 200 GPa, ν = 0.3 |
| Fixed support "Held end" | shell end x = −600 | all three displacements |
| Pressure "Internal pressure" | shell inside, nozzle bore, the nozzle's two foot faces | 2 MPa |
| Force "End thrust on the shell" | shell end x = +600 | +x 565.487 kN = p π ri² = 2 MPa × π × 300² mm² (the closed head's thrust) |
| Force "End thrust on the nozzle" | nozzle end | +z 35.343 kN = 2 MPa × π × 75² mm² (a blind flange's thrust) |
| Remote load "Piping load on the nozzle" | nozzle end, at (0, 0, 560) mm | F = (4, −3, −6) kN, M = (2, 3, 1.5) kN·m |
| Mesh | | 15 mm, quadratic (coarse tier); 12 mm (full tier) |

The piping load is in the global axes: Fx along the shell, Fy circumferential at the nozzle,
Fz radial (pushing the nozzle in), Mx and My bending moments on the nozzle (circumferential and
longitudinal), Mz torsion about the nozzle's axis. The thrusts make the pressure state that of
a closed vessel: the pressure on the shell's inside has no net force, the hole it lacks under
the nozzle is balanced by the nozzle's thrust, and the shell's end thrust is reacted at the
held end, which stands for the rest of the vessel.

## What the hand checks can use

- **Membrane stress, free side.** Between x ≈ 305 mm and the free end the shell carries only the
  closed-end pressure state, with no beam moment (the piping load goes to the held end).
  Lamé with closed ends: σθ = 2 p ri² / (ro² − ri²) = 59.016 MPa and σx = 29.508 MPa at the
  outside, von Mises 51.110 MPa (thin-wall p R / t = 61.0 and 30.5 MPa at the mean radius).
  `case.yaml` checks the von Mises value under the shell at x = 450 mm.
- **Mesh through the wall.** At 15 mm (79,671 elements) and 12 mm (123,317, under PaStiX's
  142,000 limit) there is one quadratic element through the shell's 10 mm wall. At x = 450 mm
  that reads the outside hoop stress at 57.6 MPa (2.4 percent low), the radial stress at
  +0.6 MPa instead of 0 and the axial stress at 29.5 MPa (exact), so von Mises 1.8 percent
  low. The acceptance checks want a finer local size on the shell near the check locations
  and at the nozzle, which also keeps the run under the element limit.
- **Held side.** Between x ≈ −305 and −460 mm the shell adds the beam bending and shear of the
  nozzle loads carried to the held end, which follow from statics.
- **Local stresses** at the nozzle and pad edges are for the WRC-style comparison (M9.5); the
  nozzle loads above are within the range those methods are applied to.
- **Reactions.** The held end reacts −565.487 kN in x from the end thrust plus the piping load
  and its moment about the held end's centroid: the run's balance must close.

## Known limits that apply (accepted ADRs)

- Stress at the nodes of a bonded face is off by −13 to +12 percent, and within 0.1 percent
  about 8 mm away (ADR-060); the report prints the tied-interface note. Read local stresses a
  little away from the bonded faces, or compare FreeCAD on the same bonded setup.
- The edges where all three bodies meet (the nozzle at the pad's hole and at the shell's
  outside) are not tied three ways (ADR-060, ADR-069).
- The fixed end restrains the shell's radial growth, which adds a local bending stress within
  about 140 mm of it. It is far from the nozzle and not a check location.
