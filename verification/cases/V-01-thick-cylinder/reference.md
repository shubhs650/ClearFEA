# V-01 Thick cylinder under internal pressure: reference values

## Model

A tube along z: inner radius a = 40 mm, outer radius b = 60 mm, length 300 mm. The end at z = 0 is fixed (all three displacements held); the end at z = 300 mm is free. A pressure p = 100 bar = 10 MPa acts on the bore. Linear elastic, E = 200 GPa, ν = 0.3. The values are entered in bar, GPa, mm and cm on purpose (docs/VERIFICATION.md).

## Closed form

Lamé's solution for a thick cylinder under internal pressure (Timoshenko and Goodier, *Theory of Elasticity*, 3rd ed., section 33; any strength-of-materials text gives the same):

- A = p a² / (b² − a²) = 8 MPa, B = A b² = 28,800 MPa·mm²
- σr = A − B / r², σθ = A + B / r²

The pressure acts only on the bore, so no section carries an axial force, and the free end needs no traction: away from the fixed end the open-ended solution holds exactly, with σz = 0. The radial displacement is u = r εθ = r (σθ − ν σr) / E.

| Quantity | At r = a = 40 mm | At r = b = 60 mm |
| --- | --- | --- |
| σr | −10 MPa | 0 |
| σθ | 26 MPa | 16 MPa |
| von Mises, √(½[(σr − σθ)² + σθ² + σr²]) | 32.1870 MPa | 16.0 MPa |
| radial displacement u | 0.0058 mm | 0.0048 mm |

The axial displacement is not checked: it accumulates the restrained strain near the fixed end.

## Where the results are read

The fixed end holds the tube's radial growth and disturbs the stress near it. The disturbance decays as e^(−βx) with β = [3(1 − ν²) / (R² t²)]^¼ ≈ 0.041 per mm (R = 50 mm mean radius, t = 20 mm wall), so 1/β ≈ 25 mm. The checks read the mean over the surface vertices of the bore or the outside between z = 215 and 235 mm: at least 215 mm, about 9/β, from the fixed end, where e^(−9) ≈ 1e-4. The free end causes no disturbance.

## Tolerances

- Stress: 3 percent coarse (two quadratic elements through the wall, stress extrapolated from the integration points to the nodes), 1 percent full.
- Displacement: 1 percent coarse, 0.5 percent full.

Measured while the case was written (2026-10-15, CalculiX 2.21, Gmsh 4.15.2): coarse, bore −1.15 % and outside −0.53 % in von Mises, −0.04 % and −0.02 % in radial displacement; full, −0.39 % and −0.16 % in von Mises, below 0.01 % in radial displacement.

## Reaction balance

The pressure on the bore adds up to no net force, and so must the reaction of the fixed end. CalculiX leaves out of its reaction total the part of a pressure that lands on nodes the support holds (ADR-029); here those are the bore's nodes on the fixed end's edge, whose loads also add up to nothing by symmetry, so the balance check is unaffected.
