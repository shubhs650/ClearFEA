# V-09 Symmetry model against full model: reference values

## Model

A quarter of V-01's tube: inner radius a = 40 mm, outer radius b = 60 mm, between the half-planes at θ = 30° and θ = 120° about z, length L = 100 mm. Both cut faces and the base (z = 0) are on frictionless supports; the end at z = 100 mm is free. A pressure p = 10,000 kPa = 10 MPa acts on the bore. E = 2 × 10¹¹ Pa, ν = 0.3, as in V-01, entered in Pa, kPa, mm and cm (docs/VERIFICATION.md).

The cut faces lean against the x and y axes on purpose: their normals are not global axes, so the deck must give their nodes local axes (`*TRANSFORM`, ADR-039), and the nodes on the edges where a cut face meets the base are held along two directions at once.

## Why the full tube's values hold

The full tube's open-ended Lamé solution (V-01's reference.md) has, by symmetry, no hoop displacement and no shear stress on any half-plane θ = constant: a frictionless support on a cut face imposes exactly that, so the quarter carries the full tube's solution. With σz = 0 the axial strain εz = −ν(σr + σθ)/E = −2νA/E is the same everywhere (σr + σθ = 2A), so the axial displacement is uz = εz z, which is zero on the base and leaves it free to slide radially: the frictionless base holds exactly what this solution needs and nothing more. Unlike V-01, no fixed end disturbs the solution, so it holds in the whole quarter, and the checks read whole faces.

| Quantity | At r = a = 40 mm | At r = b = 60 mm |
| --- | --- | --- |
| von Mises | 32.1870 MPa | 16.0 MPa |
| radial displacement | 0.0058 mm | 0.0048 mm |

## Reactions

Each cut face carries the hoop stress across it, ∫ σθ dr over the wall times L, with ∫ₐᵇ (A + B/r²) dr = A(b − a) + B(1/a − 1/b) = p a (A = p a²/(b² − a²), B = A b²). So each cut plane's reaction is p a L = 10 MPa × 40 mm × 100 mm = 40 kN along the face's outward normal, where the removed part of the tube would pull: (sin 30°, −cos 30°, 0) on the 30° face and (−sin 120°, cos 120°, 0) on the 120° face. That gives (20, −34.6410, 0) kN and (−34.6410, −20, 0) kN. Their sum balances the pressure's resultant on the quarter bore, 2 p a L sin 45° = 56.569 kN along θ = 75°. The base carries no force (σz = 0).

Since a frictionless support pushes only along its normal, the two magnitudes follow from equilibrium alone: they are as exact as the resultant of the pressure on the meshed bore, which the deck sums over curved quadratic element faces. The check also shows that the reaction of a node on the edge with the base (held along the cut face's normal and along z) is shared correctly between the two supports (ADR-039).

## Tolerances

- Stress and displacement: as V-01 (3 and 1 percent coarse and full for stress, 1 and 0.5 percent for displacement), for the same two quadratic elements through the wall.
- Reactions: 0.5 percent coarse, 0.2 percent full; they depend only on the meshed bore's area.
