# V-03 Plate with central hole in tension: reference values

## Model

A steel plate 300 mm long along x, W = 100 mm wide along y and 5 mm thick, with a hole of d = 10 mm diameter through its centre (d/W = 0.1). Only one eighth is modelled: x from 0 to 150 mm, y from 0 to 50 mm and z from 0 to 2.5 mm, with the hole's axis on the z axis. The faces x = 0, y = 0 and z = 0 are frictionless supports: the two symmetry planes of the plate and its mid-thickness plane. A force of 12.5 kN along +x on the end face x = 150 mm gives a gross-section stress σ = 12.5 kN / (50 mm × 2.5 mm) = 100 MPa. E = 200 GPa and ν = 0, entered in GPa, kN, lbf, N, mm and in.

The global mesh size is 5 mm (2.5 mm on the full tier), and the hole face has a local size of 0.02 in (0.5 mm; 0.25 mm on the full tier), so this case also checks that local mesh sizes reach the mesh (ADR-045).

ν = 0 makes the three-dimensional answer the plane one exactly: with no lateral contraction the stress σz and the through-thickness variation of the plane solution vanish, so the peak does not depend on the plate's thickness (with ν = 0.3 the mid-thickness peak of a plate this thick is a little above the plane-stress value). The plane stress field of a hole in a strip with free edges does not depend on the elastic constants either (the hole's edge is free of load), so the reference holds for any steel.

## Reference

At the side of the hole (x = 0, y = d/2), where the hole meets the plane across it, the hoop stress is the peak: σmax = Ktg σ, and the radial and axial stresses are zero there, so von Mises equals σmax.

- For an infinitely wide plate Kirsch's solution gives Ktg = 3 (Kirsch 1898; Timoshenko and Goodier, *Theory of Elasticity*, section 35).
- For a strip of width W, Howland's series solution (Howland 1930, *Phil. Trans. R. Soc. A* 229) gives Ktg = 3.03 at d/W = 0.1. Peterson's curve fit to it, in terms of the net-section stress (Pilkey and Pilkey, *Peterson's Stress Concentration Factors*, chart 4.1), is Ktn = 3.00 − 3.13 (d/W) + 3.66 (d/W)² − 1.53 (d/W)³ = 2.7221, so Ktg = Ktn / (1 − d/W) = 3.0246. Heywood's simpler formula Ktn = 2 + (1 − d/W)³ gives Ktg = 3.032.

The reference is Ktg = 3.025, so σmax = 302.5 MPa; the published values agree with it within 0.25 percent.

At the end face, 145 mm from the hole's edge, the disturbance from the hole has died out (it falls off as (d/2x)², under 0.1 percent there), so von Mises is the uniform σ = 100 MPa.

## Tolerances

- Peak stress: 2 percent on the coarse tier and 1 percent on the full tier. The reference itself is good to about 0.25 percent; the rest allows for the mesh, which with the local size has about 16 elements along the quarter circle of the hole on the coarse tier and 31 on the full tier (the coarse tier came out 0.4 percent high), and for CalculiX's averaging of stresses at nodes, which smooths a peak. Without the local size, the coarse tier's 5 mm mesh gave 267 MPa, 12 percent low (checked once while adding the case).
- End stress: 0.5 percent on both tiers, which allows for the hole's last trace and the six significant digits of the solver's result file.
