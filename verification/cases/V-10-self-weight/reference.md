# V-10 Column under self-weight: reference values

## Model

A square steel column in inches: section 4 in × 4 in, height h = 40 in along z, standing on its base (z = 0), which is a fixed support. Its only load is its own weight: gravity of −1 g along z on a density of 0.284 lb/in³. E = 200 GPa, ν = 0. Poisson's ratio is zero on purpose: with any other value the fixed base stops the base from contracting sideways, which the one-dimensional closed form does not assume, and the column's true shortening differs from it (by about 0.6 percent at ν = 0.3, measured on both tiers in M2.3, the same on both meshes, so it is not discretization error). With ν = 0 there is no sideways contraction, and the closed form below is the exact elasticity solution with a fixed base: u = v = 0, w = −ρ g (h z − z²/2) / E. The STEP file declares inches and the setup uses GPa, lb/in³ and g on purpose (docs/VERIFICATION.md); the full tier's mesh size is entered in mm.

A pound of mass under standard gravity (1 g = 9.80665 m/s², exact) weighs exactly one pound-force, so ρ g = 0.284 lbf/in³.

## Closed form

The column is in uniaxial compression that grows linearly from the top (Timoshenko and Goodier, *Theory of Elasticity*: a prismatic bar under its own weight):

- Weight and base reaction: W = ρ g A h = 0.284 × 16 × 40 = 181.76 lbf (808.51 N), upwards on the column.
- Axial stress at height z: σz = −ρ g (h − z); at mid-height |σz| = 0.284 × 20 = 5.68 psi, and at a quarter of the height σz = −0.284 × 30 = −8.52 psi. The other stresses are zero, so von Mises is |σz|.
- Shortening of the top: δ = ρ g h² / (2E) = 0.284 × 1600 / (2 × 29,007,547.5 psi) = 7.83244 × 10⁻⁶ in, downwards.

## Where the results are read

- Base reaction: the support's total reaction along z from the run's result. CalculiX's reaction output at a held node includes the weight applied at that node; the reader takes it out (ADR-040), so the reaction is the weight to the solver's printed digits.
- Axial stress: the mean von Mises stress over the side face x = 4 in between z = 19 and 21 in. The stress is linear in z, which ten-node tetrahedra reproduce, so the mean is the mid-height value.
- Axial stress inside (M3.4): the mean σz over every mesh node, inside the body as well as on its faces, in the slab 9.5 in ≤ z ≤ 10.5 in, read from the run's `mesh.bin` and `nodes.bin`, the values a cut plane draws (ADR-053). The slab is off the middle on purpose: values put on the wrong nodes would average to about the column's mid-height value instead.
- Shortening: the mean z displacement over the top face.

## Tolerances

- Base reaction: 0.1 percent at both tiers, as the automatic balance check: it follows from equilibrium and is exact for this straight-sided mesh.
- Stress: 1 percent coarse, 0.5 percent full. Inside, the mean is the stress at the nodes' mean height in the slab, which lies within a few hundredths of an inch of 10 in on these meshes; each 0.03 in is 0.1 percent of 30 in.
- Shortening: 1 percent coarse, 0.5 percent full. The displacement is quadratic in z, which ten-node tetrahedra reproduce.
