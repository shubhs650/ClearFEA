# V-12 Bi-material bar in tension: reference values

## Model

A quarter of a 20 mm square bar along x, in millimetres: y and z from 0 to 10 mm, with frictionless supports on the symmetry planes y = 0 and z = 0 and on the start face x = 0. Two bodies end to end, bonded at x = 100 mm: body 1 from x = 0 to L1 = 100 mm of a steel-like material (E1 = 200 GPa, ν1 = 0.3), body 2 from 100 to 160 mm (L2 = 60 mm) of a lighter one (E2 = 70,000 MPa, ν2 = 0.105). A force of 5 kN along +x on the end face x = 160 mm. Body 2 is meshed finer (3 mm against 5 mm, 1.5 mm against 2.5 mm on the full tier), so the bond's two faces have different nodes. The symmetry planes cross the bond, so held nodes of one face are followed by tied nodes of the other and the tie forces they carry must reach the support reactions (ADR-060).

The materials are chosen with the same ν/E (1.5 × 10⁻⁶ per MPa). Then both bodies contract sideways by the same strain, the faces at the bond fit without any constraint between them, and the exact field is uniaxial stress in both bodies, the displacement linear in each. Quadratic tetrahedra and the tie reproduce it exactly, so every value can be checked tightly, including at the bond. With different ν/E the bond would hold the faces together sideways and disturb the stress near it.

## Closed form

With A = 10 mm × 10 mm = 100 mm² for the quarter and F = 5 kN:

- Stress σxx = F / A = 50 MPa in both bodies (von Mises 50 MPa = 7.25189 ksi).
- Axial strain σ / E: 250 µε in body 1, 714.2857 µε in body 2.
- End displacement, the two bodies in series: u = σ (L1 / E1 + L2 / E2) = 50 × (100 / 200,000 + 60 / 70,000) mm = 0.0678571 mm.
- Sideways displacement at y = 10 mm: −ν σ / E × 10 mm = −0.00075 mm in both bodies.
- The start face holds the whole −5 kN.

## Tolerances

0.1 percent throughout: the field is exact, so the tolerance only allows for the six digits of the solver's result file.
