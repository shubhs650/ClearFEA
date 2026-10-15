# V-25 Tube in an elastic sleeve: reference values

## Model

V-09's quarter tube: inner radius a = 40 mm, outer radius b = 60 mm, between the half-planes at θ = 30° and θ = 120° about z, length L = 100 mm, with frictionless supports on both cut faces and on the base (z = 0) and the end at z = 100 mm free. A pressure p = 10 MPa acts on the bore. The outside rests on an elastic support of foundation stiffness k = 500,000 MN/m³ = 5 × 10¹¹ N/m³, as if the tube sat in a stiff sleeve: the sleeve pushes back on the outside with the pressure k u(b), u the radial displacement. E = 200 GPa, ν = 0.3.

This is the curved-face case for the elastic support (ADR-043): the deck gives each node of the outside a spring along its own normal, averaged over its share of the face, so the case checks those directions and stiffnesses on a cylinder, and springs on nodes that the cut planes hold through local axes.

## Closed form

As in V-09, the open-ended Lamé solution holds in the whole quarter (σz = 0, no hoop displacement or shear on the cut planes, uz = εz z free to slide on the base), and a foundation pushing only radially on the outside does not disturb it. With σr = A − B/r², σθ = A + B/r² and u = r (σθ − ν σr)/E, the boundary conditions are

- σr(a) = −p,
- σr(b) = −k u(b) = −k b [(1 − ν) A + (1 + ν) B / b²] / E,

which give A = 4.78810 MPa and B = 23,660.97 N (B/r² in Pa with r in m). Then:

| Quantity | At r = a = 40 mm | At r = b = 60 mm |
| --- | --- | --- |
| σr | −10 MPa | −1.78439 MPa (the sleeve's pressure) |
| σθ | 19.5762 MPa | 11.3606 MPa |
| von Mises (σz = 0) | 26.0574 MPa | 12.3499 MPa |
| radial displacement | 0.00451524 mm | 0.00356877 mm |

Without the sleeve (V-09) the values are 32.1870 and 16.0 MPa, 0.0058 and 0.0048 mm, so the sleeve takes a fair share of the pressure.

## Reactions

- Each cut plane carries the hoop force ∫ σθ dr L = [A (b − a) + B (1/a − 1/b)] L = 29.2937 kN along its outward normal, as in V-09: (14.6468, −25.3691) kN on the 30° face and (−25.3691, −14.6468) kN on the 120° face. The checks read the larger component of each.
- The sleeve pushes the outside inwards with q = k u(b) = 1.78439 MPa; over the quarter that is 2 q b L sin 45° = 15.1410 kN towards the axis along θ = 75°, (−3.91878, −14.6251) kN.

The three add up to minus the pressure's resultant on the quarter bore, 2 p a L sin 45° = 56.569 kN along θ = 75°.

## Tolerances

- Stress and displacement: as V-09 (3 and 1 percent coarse and full for stress, 1 and 0.5 percent for displacement), for the same two quadratic elements through the wall.
- Reactions: 1 percent coarse, 0.5 percent full. Unlike V-09's, they are not fixed by equilibrium alone: how the load splits between the sleeve and the cut planes depends on u(b), so they carry the displacement's tolerance.
