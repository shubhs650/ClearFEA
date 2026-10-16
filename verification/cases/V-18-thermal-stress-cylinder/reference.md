# V-18 Thick cylinder thermal stress: reference values

## Model

A quarter of a tube along z: inner radius a = 40 mm, outer radius b = 60 mm, length L = 20 mm, between the planes x = 0 and y = 0. The bore is held at 302 °F (150 °C) and the outside at 30 °C (fixed temperatures); the cut and end faces carry no thermal load, so they are insulated. Both cut faces and both ends have frictionless supports: the cuts are planes of symmetry, and the ends stop the tube growing along its axis, so εz = 0 everywhere (plane strain). Linear elastic, E = 200 GPa, ν = 0.3, α = 12 µm/(m·K), k = 26 BTU/(h·ft·°F) = 44.9991 W/(m·K). The stress-free temperature is 68 °F (20 °C, 293.15 K). The setup uses °F, °C, BTU/(h·ft·°F) and µm/(m·K) on purpose (docs/VERIFICATION.md).

## Closed form

Steady radial conduction between two fixed temperatures (Incropera and DeWitt, section 3.3):

T(r) = Tb + (Ta − Tb) ln(b/r) / ln(b/a), heat flow through the quarter Q = (π/2) k L (Ta − Tb) / ln(b/a) = 418.39017 W.

Thermal stress in a long cylinder with a radial temperature field, plane strain (Timoshenko and Goodier, *Theory of Elasticity*, 3rd ed., section 150), with ΔT = T − Tr, the stress-free temperature Tr, c = Eα / (1 − ν) and I(r) = ∫ₐʳ ΔT r dr:

- σr = c / r² [ (r² − a²) / (b² − a²) I(b) − I(r) ]
- σθ = c / r² [ (r² + a²) / (b² − a²) I(b) + I(r) − ΔT r² ]
- σz = ν (σr + σθ) − E α ΔT
- u = (1 + ν) / (1 − ν) α I(r) / r + C₁ r + C₂ / r, with C₁ = (1 − 2ν)(1 + ν) / (1 − ν) α I(b) / (b² − a²) and C₂ = (1 + ν) / (1 − ν) α a² I(b) / (b² − a²)

With ∫ r ln(b/r) dr = r²/2 ln(b/r) + r²/4, I(b) = 0.0619782 K·m². The script that evaluated these also checked equilibrium, d(r σr)/dr = σθ, and u / r against the plane strain hoop strain at r = 50 mm.

| Quantity | At r = a = 40 mm | At r = b = 60 mm |
| --- | --- | --- |
| T | 150 °C | 30 °C |
| σr | 0 | 0 |
| σθ | −233.2176 MPa | 178.2110 MPa |
| σz | −381.9653 MPa | 29.4633 MPa |
| von Mises | 333.4770 MPa | 165.4586 MPa |
| radial displacement u | 0.038674 mm | 0.058012 mm |

The axial force each end carries is ∫ σz dA. Since ∫ₐᵇ (σr + σθ) r dr = [r² σr / 2]ₐᵇ = 0, it is −E α 2π I(b) for the whole tube and −233,652.34 N (compression) for the quarter. The support at z = 0 pushes the body in +z, so its reaction z is +233,652.34 N.

## Where the results are read

The frictionless supports give no shear on the cuts and ends, which is what the plane strain solution has there, so it holds everywhere with no end effect, and the checks read whole faces: σz, von Mises and the radial displacement over the bore and the outside. On the cut y = 0 the yy stress is σθ; it is read on the vertices of that face along its edges at x = 40 mm and x = 60 mm. The heat flow is the bore's fixed-temperature load, and the axial force the reaction of the end z = 0.

## Tolerances

Stress 3 percent coarse and 1 percent full, displacement, force and heat flow 1 percent coarse and 0.5 percent full, the same as V-01. The temperature varies as ln r and the stress is extrapolated from the integration points to the nodes.

Measured while the case was written (2026-10-16, CalculiX 2.21, Gmsh 4.15.2, coarse, 5 mm, four quadratic elements through the wall): σθ −0.13 % (bore) and +0.20 % (outside), σz +0.03 % and +0.63 %, von Mises −0.63 % and +0.37 %, radial displacement +0.01 % and 0.00 %, axial force and heat flow 0.00 %.

Full (2.5 mm): σθ −0.04 % and +0.04 %, σz +0.01 % and +0.15 %, von Mises −0.19 % and +0.10 %, radial displacement, axial force and heat flow below 0.01 %.
