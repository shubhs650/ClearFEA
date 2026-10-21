# V-23 NAFEMS LE10, thick plate under pressure: reference values

## Model

NAFEMS benchmark LE10 (*The Standard NAFEMS Benchmarks*, NAFEMS publication TNSB, revision 3, 1990, test LE10). A quarter of a thick elliptic plate with an elliptic hole: it lies between the ellipses (x/2)² + (y/1)² = 1 (the hole, through points A and D) and (x/3.25)² + (y/2.75)² = 1 (the outside, through points B and C), in metres, in the quarter x ≥ 0, y ≥ 0, and from z = -0.3 m to z = 0.3 m. The geometry is ClearFEA's own, written by `geometry.py` from these dimensions in millimetres. E = 210 GPa, ν = 0.3, entered in MPa.

Loads and supports, as the benchmark gives them:

- A uniform normal pressure of 1 MPa on the upper face z = 0.3 m (entered as 1000 kPa).
- Face DCD'C' (y = 0): uy = 0.
- Face ABA'B' (x = 0): ux = 0.
- Face BCB'C' (the outside): ux = uy = 0.
- Line EE', the outside face's mid-plane line at z = 0: uz = 0.

The faces are entered as prescribed displacements with the held components at zero and the others free. The line EE' is an edge of the outside face, because `geometry.py` fuses two layers of the plate so that the curved faces are split at z = 0, and the support on it is a prescribed displacement on that edge (ADR-105), with no faces. This is the case's reason for being: it is the gate's check of a support on an edge.

## Reference

The benchmark's target is the direct stress σyy = -5.38 MPa at point D, (x, y, z) = (2, 0, 0.3) m: where the hole meets the plane y = 0, on the loaded face. σyy is the hoop stress there, in compression. The NAFEMS document gives the value to three significant figures; the same value is reproduced in the published benchmark sets of commercial and open solvers (for example the Abaqus Benchmarks Manual, section "LE10: Thick plate under pressure", which quotes 5.38 MPa as a magnitude next to its own results of -5.08 to -5.89 MPa).

The check reads σyy at the single mesh vertex D, which the geometry has as a corner.

The whole pressure load is carried by the line EE' in z, since no other support holds z: p × area = 1 MPa × π (3.25 × 2.75 − 2 × 1) / 4 m² = 5.4487 MN, upwards. This is a check of the edge support's reaction (equilibrium, exact).

## Tolerances

- σyy at D: 2 percent on the coarse tier and 1 percent on the full tier. The reference is given to three figures (about 0.1 percent). The rest allows for the mesh. When the case was added, quadratic tetrahedra with the platform's deck generator and CalculiX 2.21 (SPOOLES) gave, by global size and local size on the hole face: 200 mm, none: -5.535 MPa (+2.9 %); 150 mm, none: -5.475 (+1.8 %); 150 mm, 50 mm: -5.409 (+0.5 %, the coarse tier); 100 mm, none: -5.359 (-0.4 %); 75 mm, none: -5.375 (-0.1 %); 100 mm, 40 mm: -5.385 (+0.1 %, the full tier); 100 mm, 25 mm: -5.377 (-0.1 %). The finer meshes settle at -5.375 to -5.385 MPa, within the reference's own precision.
- Reaction of the line in z: 0.1 percent on both tiers, which is equilibrium and holds to the solver's digits (it came out 5.4487 MN on every mesh above).

A line support is a singularity of the three-dimensional solution: the stresses at the line itself grow without bound as the mesh is refined. Point D is far from the line, so the check is not affected; nothing is read near EE'.
