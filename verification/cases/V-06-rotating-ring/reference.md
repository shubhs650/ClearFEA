# V-06 Thin rotating ring: reference values

## Model

A steel ring of inner radius a = 90 mm, outer radius b = 100 mm and thickness 10 mm, spinning at ω = 10,000 rpm (1047.20 rad/s) about its axis z. By symmetry a quarter of its upper half is modelled: x ≥ 0, y ≥ 0 and 0 ≤ z ≤ 5 mm, with frictionless supports on the cut faces x = 0 and y = 0 and on the mid-plane z = 0. The only load is the centrifugal load, entered in rpm about the axis through the origin along z; density 7.85 × 10⁻⁹ t/mm³ (7850 kg/m³), E = 210,000 MPa, ν = 0.3. Units are mixed on purpose (docs/VERIFICATION.md).

## Closed form

A thin ring spinning freely carries a hoop stress σθ ≈ ρ ω² r². This ring is thin in z, so the plane stress solution for a rotating disc with a central hole (Timoshenko and Goodier, *Theory of Elasticity*, rotating discs) gives the stresses including their variation across the 10 mm width:

- σθ(r) = (3 + ν)/8 · ρω² · [a² + b² + a²b²/r² − (1 + 3ν)/(3 + ν) · r²]
- σr(r) = (3 + ν)/8 · ρω² · [a² + b² − a²b²/r² − r²], which is zero at r = a and r = b.

With ρω² = 8.6085 × 10⁹ N/m⁴:

| Quantity | At r = a = 90 mm | At r = b = 100 mm |
| --- | --- | --- |
| σθ = von Mises (σr = σz = 0 there) | 83.2226 MPa | 72.5911 MPa |
| radial displacement u = r σθ / E | 0.0356668 mm | 0.0345672 mm |

At the mean radius, 95 mm, σθ = 1.0000 ρω²r², the thin-ring value.

## Reactions

Each cut face carries the hoop force, ∫ σθ dr over the width times the thickness, which by equilibrium of the quarter equals the centrifugal force on it along that axis: ρ ω² t ∫∫ r cos θ · r dr dθ = ρ ω² t (b³ − a³)/3 = 3.88817 kN, with t = 5 mm. The support on x = 0 pushes back along −x and the one on y = 0 along −y; the mid-plane carries nothing.

## Where the results are read

- Stress and displacement: the mean over the run's surface vertices of the whole outer face and of the whole inner face. On each face both are the same everywhere.
- Reactions: the total reaction of each cut-face support from the run's result.

## Tolerances

- Stress and displacement: 1 percent coarse (four elements across the width), 0.5 percent full. The plane stress solution leaves σz and the small through-thickness variation out; the worker's load check (spikes/load_check) found the 3D model within 0.05 percent of it at the coarse size.
- Reactions: 0.2 percent coarse, 0.1 percent full; they follow from equilibrium and depend only on how well the mesh's curved elements fill the ring's volume.
