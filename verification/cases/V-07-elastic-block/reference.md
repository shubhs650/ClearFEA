# V-07 Block on an elastic support: reference values

## Model

A block 100 mm along x, 60 mm along y and 40 mm high along z, from the origin. Its base (z = 0, area A = 6,000 mm²) rests on an elastic support of foundation stiffness k = 2,000 lbf/in³ = 5.42894275 × 10⁸ N/m³ (1 lbf = 4.4482216152605 N, 1 in = 0.0254 m exactly). The faces x = 0 and y = 0 are frictionless supports: an elastic support resists motion only along its faces' normals (ADR-043), so these stop the block sliding and turning about z, and as symmetry planes they leave it free to grow sideways. A force F = 6 kN pushes the top (z = H = 40 mm) down along −z, spread uniformly over it. Linear elastic, E = 100 MPa (a stiff polymer, soft enough that its own compression shows beside the foundation's), ν = 0.3. The setup uses mm, MPa, kN, N, lbf and lbf/in³ on purpose (docs/VERIFICATION.md).

## Closed form

The block is in uniform uniaxial compression σz = −F / A = −1 MPa, with σx = σy = 0: the symmetry planes hold only the normal displacement, the other sides are free, and the foundation pushes only along z. So von Mises is F / A = 1 MPa everywhere.

- The foundation pushes back with the pressure k uz on the base, which must equal F / A, so the base settles uniformly by uz = −F / (k A) = −6,000 / (5.42894275 × 10⁸ × 0.006) m = −1.84197927 mm.
- The block shortens by F H / (E A) = 6,000 × 0.04 / (10⁸ × 0.006) m = 0.4 mm, so the top moves by −2.24197927 mm.
- The foundation's reaction is +6 kN along z; the symmetry planes carry nothing.

## Where the results are read

- Settlement and top displacement: the mean z displacement over the base and the top face.
- Stress: the mean von Mises stress over the side face x = 100 mm.
- Foundation: the elastic support's total reaction along z, worked out from its springs (ADR-043).

## Tolerances

0.1 percent for every check at both tiers, as the automatic balance check. The solution is linear in position, which quadratic and linear tetrahedra represent exactly, and the deck's springs give the base's nodes forces k times their share of the area, which are exactly the consistent nodal loads of the uniform foundation pressure. What remains is rounding and the solver; a larger error would mean the springs are wrong.
