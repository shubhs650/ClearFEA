# V-04 Remote force and moment on a stub: reference values

## Model

A round steel stub in millimetres: radius R = 15 mm, length 200 mm along x, its axis on the x axis. The end x = 0 is a fixed support. The other end carries one remote load through the reference point P = (25, −1, 0) cm, 50 mm beyond the end and 10 mm below the axis: a force F = (6 kN, 0, 0) and a moment M = (120 N·m, 0, 600 lbf·in) at P. E = 200 GPa, ν = 0.3. The point is entered in cm, the force in kN, lbf and N, the moments in N·m, kN·m and lbf·in on purpose (docs/VERIFICATION.md).

600 lbf·in = 600 × 4.4482216152605 N × 0.0254 m = 67.7909 N·m (both factors exact by definition).

The load is chosen so that the stub's internal forces are the same along its whole length: the force is along the axis, so its moment about any point of the axis is the same, and the stresses can be read over a long stretch without a gradient.

## Closed form

Cut the stub at any x. The part beyond the cut carries the remote load, so the section carries the force F and the moment of the load about the section's centre c = (x, 0, 0): M + (P − c) × F. With P − c = (250 mm − x, −10 mm, 0) and F along x, (P − c) × F = (0, 0, 0.01 m × 6000 N) = (0, 0, 60 N·m) at every x. So every section carries:

- an axial force N = 6000 N;
- a torque T = Mx = 120 N·m;
- a bending moment Mz = 67.7909 + 60 = 127.7909 N·m about the z axis.

That 60 N·m is the remote point's lever: without it the bending moment would be the entered 67.79 N·m. Saint-Venant's solutions for a round bar (Timoshenko and Goodier, *Theory of Elasticity*: extension, pure bending, torsion of a circular shaft) give, with A = πR² = 706.858 mm², I = πR⁴/4 = 39,760.8 mm⁴ and J = 2I:

- axial stress σx = N/A − Mz y / I, so N/A = 8.48826 MPa and the bending part at |y| = R is Mz R / I = 48.2099 MPa;
- shear stress from torsion at the surface τ = T R / J = 22.6354 MPa, along the circumference;
- no other stress (the section carries no shear force).

Von Mises on the surface is √(σx² + 3τ²):

| Where | σx (MPa) | τ (MPa) | von Mises (MPa) |
| --- | --- | --- | --- |
| Top, y = +R | 8.48826 − 48.2099 = −39.7217 | 22.6354 | 55.8112 |
| Underneath, y = −R | 8.48826 + 48.2099 = 56.6982 | 22.6354 | 68.9330 |
| Side, z = +R (y = 0) | 8.48826 | 22.6354 | 40.1140 |

The three values separate the three internal forces: the side has no bending, and top and underneath differ only by the bending moment's sign, so a wrong lever or a wrong moment sign shows.

Reactions: the clamp carries −F = (−6 kN, 0, 0) and the moment −(M + (P − c₀) × F) about the clamp's centre, by equilibrium of the whole stub. The run's result reports reaction forces only; the force is checked here and by the automatic balance check. The moment is the section moment above, which every cut carries to the clamp; reaction moments per support come with M3.2, and `worker/spikes/load_check` checks a solved model's reaction moment about the point node by node.

## Where the results are read

Between x = 70 and 130 mm, at least two diameters from the clamp and from the loaded end, so that both ends' local effects have died out (Saint-Venant). On the loaded end the remote load's linear traction is itself the exact distribution of extension, bending and torsion on a round section (ADR-041), so little disturbance starts there anyway.

Each check is the mean von Mises over the surface vertices in a strip along the stub: |y| ≥ 14.97 mm and |z| ≤ 1 mm for top and underneath, |z| ≥ 14.97 mm and |y| ≤ 1 mm for the side. The strip lies within 3.6° of its line (cos 3.6° = 0.998), so the bending stress in it differs from the line's by at most 0.2 percent and on average by less than 0.1 percent; on the side the bending stress, zero on the line, is at most 48.2 × sin 3.6° = 3.0 MPa at the strip's edges and its mean, of either sign, is near zero.

## Tolerances

- Clamp reaction: 0.1 percent at both tiers, as the automatic balance check: it follows from equilibrium, and the nodal loads add up to the force exactly.
- Stresses: 1 percent coarse, 0.5 percent full, as V-02's bending stresses. The strips add up to 0.1 percent of their own; the coarse tier's first run was within 0.11 percent.
