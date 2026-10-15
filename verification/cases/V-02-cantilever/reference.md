# V-02 Cantilever with an end load: reference values

## Model

A square bar along x in inches: length L = 10 in, width and depth h = 1 in. The end x = 0 is fixed (all three displacements held over the whole face). The top face (y = 1 in) is split at x = 9 in, and a force of 500 lbf downwards (−y) acts on the last inch of it, the 1 in × 1 in end patch. Linear elastic, E = 29,000 ksi, ν = 0.3. The STEP file declares inches and the setup uses ksi, lbf, kip, N and a mesh size in mm on purpose (docs/VERIFICATION.md).

A force on a face is spread over it as a uniform traction (ADR-040), so the end load is a line load w = P/a = 500 lbf/in over the last a = 1 in, total P = 500 lbf. Until M2.3 the case applied the same load as a pressure of 500 psi on the patch; the two give the same nodal loads on the flat patch, so the results did not change.

## Closed form

Timoshenko beam (Euler-Bernoulli bending plus shear deflection; Roark's *Formulas for Stress and Strain*, cantilever with a uniform load over part of the span; shear coefficient k = 5/6 for a rectangle):

- I = h⁴ / 12 = 1/12 in⁴, G = E / (2(1 + ν)), A = h²
- Bending deflection of the tip under w on x from b = L − a to L: δb = w (3L⁴ − 4b³L + b⁴) / (24 E I) = 0.0638017 in
- Shear deflection: δs = P (L − a/2) / (k G A) = 0.000511 in (the shear force is P up to b, then falls linearly to zero)
- Tip deflection: δ = δb + δs = 0.0643128 in, downwards (−y)
- Bending moment at mid-length: M = P (L/2 − a/2) = 2,250 lbf·in; surface stress σ = M (h/2) / I = 13,500 psi, tension on top and compression underneath. The shear stress is zero on the top and bottom faces, so von Mises equals |σ| there.

## Where the results are read

- Tip deflection: the mean y-displacement over the free end face's vertices.
- Bending stress: the mean von Mises stress over the vertices of the top face and of the bottom face between x = 4.75 and 5.25 in. The stress varies linearly along x there, so the mean is the mid-length value. Mid-length is 5 in (five depths) from the clamp and 4 in from the load patch.

## Tolerances

- Tip deflection: 2 percent coarse, 1.5 percent full. The solid model holds the whole root face, so the root section can neither warp nor contract, which beam theory does not assume. That makes the solid model stiffer than the beam by about 0.7 percent at every mesh size (measured while the case was written: −0.75 % at 5 mm, −0.71 % at 2.5 mm), so the full tier cannot be tighter than about 1 percent. The written reason for the tolerance, as docs/VERIFICATION.md requires.
- Bending stress: 1 percent coarse, 0.5 percent full (measured: +0.26 % top and +0.06 % underneath at 5 mm).

## Reaction balance

The load patch is 9 in from the fixed face and shares no nodes with it, so the clamp's reaction equals the applied 500 lbf = 2,224.11 N upwards (+y), checked to 0.1 percent.
