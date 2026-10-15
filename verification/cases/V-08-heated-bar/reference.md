# V-08 Bar with ends restrained, uniform temperature rise: reference values

## Model

A straight bar 200 mm along x with a rectangular section b = 20 mm along y by h = 10 mm along z (A = 200 mm²), from the origin. Both ends (x = 0 and x = 200 mm) are frictionless supports, so neither end can move along x, and the faces y = 0 and z = 0 are frictionless supports as symmetry planes, which stop the bar moving sideways as a whole while leaving it free to grow across its section. The whole bar warms by ΔT = 90 °F = 50 K (a difference: no offset). Linear elastic, E = 29,000 ksi = 1.9994796150 × 10¹¹ Pa (1 psi = 6,894.757293168 Pa), ν = 0.3, α = 6.5 µin/(in·°F) = 1.17 × 10⁻⁵ 1/K (1 °F of difference = 5/9 K exactly). The setup uses mm, ksi, µin/(in·°F) and °F, and the checks MPa, kN and mm, on purpose (docs/VERIFICATION.md).

## Closed form

The free thermal strain is ε_th = α ΔT = 1.17 × 10⁻⁵ × 50 = 5.85 × 10⁻⁴ in every direction. The ends hold the length, so the axial strain is zero and the axial stress is

σx = −E α ΔT = −1.9994796150 × 10¹¹ × 5.85 × 10⁻⁴ Pa = −116.969557 MPa (compression),

with σy = σz = 0, because the sides are free and the symmetry planes hold only the normal displacement. The state is uniform, so von Mises is |σx| = 116.969557 MPa everywhere. This is the textbook result for a uniformly heated bar between rigid walls, derived here in full so nothing depends on a source's numbers.

- Each end pushes back on the bar with |σx| A = 116.969557 MPa × 200 mm² = 23.3939115 kN: the start face towards +x and the end face towards −x. They balance each other; the symmetry planes carry nothing.
- Across the section, εy = εz = α ΔT − ν σx / E = (1 + ν) α ΔT = 7.605 × 10⁻⁴, so the side y = 20 mm moves by 0.01521 mm along +y and the top z = 10 mm by 0.007605 mm along +z.

## Where the results are read

- Stress: the mean von Mises stress over the side face y = 20 mm.
- Reactions: each end support's total reaction along x.
- Growth: the mean y displacement over the side face and the mean z displacement over the top face.

## Tolerances

0.1 percent for every check at both tiers, as the automatic balance check. The exact solution is a uniform stress and a displacement linear in position, which linear and quadratic tetrahedra represent exactly; what remains is rounding and the solver. A larger error would mean the expansion coefficient, the temperature change or their units are wrong. The sign of the axial stress, which von Mises does not show, is checked through the reactions.
