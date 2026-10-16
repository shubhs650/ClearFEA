# V-11 Two bonded blocks against one block: reference values

## Model

V-02's cantilever (verification/cases/V-02-cantilever/reference.md) made of two bodies: a square bar along x in inches, L = 10 in long, h = 1 in wide and deep, cut across at x = 3 in into a root block (x from 0 to 3 in) and an outer block (3 to 10 in). The STEP file is an assembly of the two parts; they touch over the 1 in × 1 in face at x = 3 in and are not fused, so the import finds one bond there (ADR-059), which the setup leaves detected and the deck ties (ADR-060). The root face x = 0 is fixed; a force of 500 lbf downwards (−y) acts on the last inch of the top face. Steel, E = 29,000 ksi, ν = 0.3. The root block has a local mesh size smaller than the global size (3.5 mm against 5 mm, 1.75 mm against 2.5 mm on the full tier), so the two faces of the bond have different nodes and only the tie carries the load across.

## Closed form

The single body's values, from V-02: a tie that joins the two blocks properly leaves the beam as it was, away from the bond.

- Tip deflection: δ = 0.0643128 in downwards (Timoshenko beam: bending 0.0638017 in plus shear 0.000511 in).
- Bending stress at mid-length, x = 5 in: σ = M (h/2) / I = 13,500 psi with M = P (L/2 − a/2) = 2,250 lbf·in; tension on top, compression underneath, von Mises equal to |σ| on both faces.
- The clamp carries the whole 500 lbf = 2,224.11 N upwards (+y).

## Where the results are read

- Tip deflection: the mean y-displacement over the free end face's vertices.
- Bending stress: the mean von Mises stress over the outer block's top and bottom faces between x = 4.75 and 5.25 in, 1.75 in (about nine elements of the coarse mesh) past the bond.

## Tolerances

V-02's, unchanged: tip deflection 2 percent coarse and 1.5 percent full (the full clamp makes the solid about 0.7 percent stiffer than the beam, as in V-02), bending stress 1 percent coarse and 0.5 percent full, the clamp reaction 0.1 percent. The stress at the bond itself is not checked: a tie between meshes that do not match gives a stress disturbance one or two elements deep there (ADR-060), which M4.5 states in the report.
