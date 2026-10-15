# V-24 Bar stretched by a prescribed displacement: reference values

## Model

A quarter of a 1 in × 1 in steel bar, L = 4 in long along x: the section 0 ≤ y ≤ 0.5 in, 0 ≤ z ≤ 0.5 in, with the faces y = 0 and z = 0 on one frictionless support (the bar's symmetry planes). The start face (x = 0) has a prescribed displacement x = 0 mm, the end face (x = 4 in) x = 0.0508 mm = 0.002 in exactly, both with y and z free. There is no load: the prescribed displacement alone strains the bar (ADR-034 item 3, narrowed by ADR-039). E = 29,000 ksi, ν = 0.29, entered in ksi, mm and in.

## Closed form

The supports hold only what a uniformly stretched bar does anyway: no face is kept from contracting sideways, so the stress is uniaxial and uniform (any strength-of-materials text):

- ε = δ / L = 0.002 / 4 = 5 × 10⁻⁴
- σx = E ε = 14.5 ksi, the only stress, so von Mises = 14.5 ksi everywhere
- ux = ε x, so 0.002 in at the end
- uy = −ν ε y and uz = −ν ε z, so −0.29 × 5 × 10⁻⁴ × 0.5 in = −7.25 × 10⁻⁵ in on the sides y = 0.5 in and z = 0.5 in
- the end's reaction is σ A = 14.5 ksi × 0.25 in² = 3.625 kip along +x, the start's the same along −x, and the symmetry planes carry nothing

## Tolerances

0.1 percent everywhere. A uniform stress and a linear displacement field are reproduced exactly by linear and quadratic tetrahedra alike, so the only error is the six significant digits CalculiX writes to its result file (ADR-030). The reactions also check that a node on the edge between the end and a symmetry plane gives its x force to the end and nothing to the plane (ADR-039).
