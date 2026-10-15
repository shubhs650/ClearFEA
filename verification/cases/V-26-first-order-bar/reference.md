# V-26 Bar in tension with first-order elements: reference values

## Model

A quarter of a 20 mm × 20 mm aluminium bar, L = 200 mm long along x: the section 0 ≤ y ≤ 10 mm, 0 ≤ z ≤ 10 mm, with the faces y = 0 and z = 0 on one frictionless support (the bar's symmetry planes) and the start face (x = 0) on another. A force of 1,000 lbf along +x acts on the end face (x = 200 mm), which is the quarter's share of 4,000 lbf on the whole bar. E = 10,000 ksi, ν = 0.33, entered in ksi, lbf, N and mm. The mesh is first-order: four-node tetrahedra (CalculiX C3D4, ADR-045).

## Closed form

The supports hold only what a uniformly stretched bar does anyway, so the stress is uniaxial and uniform (any strength-of-materials text):

- A = 100 mm² = 0.155000 in², so σx = F / A = 4,448.22 N / 100 mm² = 44.4822 MPa (6.4516 ksi), the only stress, and von Mises equals it everywhere
- ε = σ / E = 6.4516 / 10,000 = 6.4516 × 10⁻⁴, so the end moves ε L = 0.129032 mm = 0.00508 in
- uy = −ν ε y and uz = −ν ε z, so −0.33 × 6.4516 × 10⁻⁴ × 10 mm = −2.12903 × 10⁻³ mm on the sides y = 10 mm and z = 10 mm
- the start's reaction is −1,000 lbf along x

## Tolerances

0.1 percent everywhere. A uniform stress and a linear displacement field are what a four-node tetrahedron represents exactly (it passes the patch test), so the only error is the six significant digits CalculiX writes to its result file (ADR-030). The force on the end face is spread over the corner nodes of its triangles, which for constant-strain elements gives exactly the uniform traction. A bending case would not be exact: first-order tetrahedra are too stiff in bending, which is why second order stays the default.
