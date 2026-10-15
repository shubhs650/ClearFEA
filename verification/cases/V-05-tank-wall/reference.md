# V-05 Tank wall, hydrostatic pressure: reference values

## Model

A strip of tank wall in millimetres: width b = 100 mm along x, thickness t = 20 mm along y, height L = 500 mm along z. Its base (z = 0) is a fixed support. Water stands against the face y = 0 up to H = 400 mm, so the free surface crosses that face 100 mm below the top: fluid density 1 g/cm³, gravity 32.174 ft/s² (exactly 1 g) downwards along z, the free surface through a point at z = 40 cm. The pressure is p = ρ g (H − z) below the surface and zero above it, pushing the wall along +y. Linear elastic, E = 70 GPa, ν = 0. The STEP file declares mm and the setup uses GPa, g/cm³, ft/s², g, m/s², in, m and cm on purpose (docs/VERIFICATION.md).

Poisson's ratio is zero on purpose, as in V-10: with any other value the clamped base stops the root section contracting sideways and the strip bends partly as a plate, neither of which the beam formulas below assume. With ν = 0 the strip is a cantilever beam in the y-z plane.

## Closed form

A cantilever of length L, clamped at z = 0, under the line load w(z) = ρ g b (H − z) for z < H (a triangle, w0 = ρ g b H at the root) and nothing above (Roark's *Formulas for Stress and Strain*, cantilever with a linearly decreasing load; Timoshenko beam for the shear part, k = 5/6 for a rectangle). I = b t³ / 12 = 6.6667 × 10⁻⁸ m⁴, G = E/2.

- Push of the water and base reaction: F = ∫ p dA = ρ g b H² / 2 = 1000 × 9.80665 × 0.1 × 0.16 / 2 = 78.4532 N along +y; the base reacts with −78.4532 N.
- Bending moment at height z < H: M = ρ g b (H − z)³ / 6. Surface stress σ = M (t/2) / I, compression on the dry face y = t:
  - z = 100 mm: M = 4.41299 N·m, σ = 661.949 kPa
  - z = 200 mm: M = 1.30755 N·m, σ = 196.133 kPa
- Top deflection, along +y: the loaded length H bends as a cantilever under the triangular load, δ(H) = w0 H⁴ / (30 E I) = 7.17286 × 10⁻⁵ m with slope θ(H) = w0 H³ / (24 E I) = 2.24152 × 10⁻⁴; the unloaded 100 mm above turns with it, adding θ(H)(L − H) = 2.24152 × 10⁻⁵ m. Shear adds ∫ V/(kGA) dz = ρ g b H³ / (6 k G A) = 1.793 × 10⁻⁷ m. Top deflection δ = 9.43232 × 10⁻⁵ m = 0.0943232 mm.

## Where the results are read

- Base reaction: the support's total reaction along y. The wet face meets the base along its lower edge, where the pressure is largest; the hydrostatic load is written as nodal loads and the part on held nodes is taken back out of CalculiX's RF (ADR-040, ADR-042), so the reaction is the full push.
- Bending stress: the mean von Mises stress over the dry face's vertices within 5 mm of z = 100 and z = 200 mm. There σy = σx = 0 (ν = 0, no fluid on that side) and the shear stress is zero at the surface, so von Mises is |σz|. The stress is cubic in z; over ±5 mm its mean is above the centre value by (5 mm / (H − z))², 0.03 percent at z = 100 mm and 0.06 percent at z = 200 mm, which the tolerances below absorb. The stations are five and ten thicknesses above the clamp and at least ten below the free surface. The wet face is not read: there σy = −p adds about 0.3 percent to von Mises, and the stress through a beam under a distributed load differs from M y / I by a fraction of p (Timoshenko and Goodier, the cantilever under a uniform load), which grows relative to σ near the free surface.
- Top deflection: the mean y displacement over the top face, which the top's rotation does not change.

## Tolerances

- Base reaction: 0.1 percent at both tiers, as the automatic balance check. The harness integrates the pressure exactly over each surface triangle's wet part; the deck splits the element faces the free surface crosses (ADR-042).
- Bending stress: 1 percent coarse, 0.5 percent full (measured while the case was written: −0.28 % and −0.51 % at 10 mm, two elements through the thickness; −0.04 % and −0.10 % at 5 mm).
- Top deflection: 1 percent coarse, 0.5 percent full (measured: −0.01 % at 10 mm, −0.00 % at 5 mm). Unlike V-02, the clamp does not stiffen the strip measurably, since with ν = 0 the root section has no sideways contraction to hold.
