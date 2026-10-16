# V-27 Two-layer tube wall conduction: reference values

## Model

A quarter of a tube along z between the planes x = 0 and y = 0, length L = 20 mm, of two layers that are separate bodies bonded at r1 = 50 mm: body 1, the inner layer, from a = 40 mm to r1, with k1 = 0.05 W/(mm·K) = 50 W/(m·K); body 2, the outer layer, from r1 to b = 60 mm, with k2 = 15 W/(m·K). The bore is held at 392 °F (200 °C, 473.15 K) and the outside at 50 °C (323.15 K) (fixed temperatures); the cut and end faces carry no thermal load, so they are insulated, which is what the full tube has there by symmetry. The outer layer is meshed finer (2 mm against 5 mm, 1 mm against 2.5 mm on the full tier), so the two faces of the bond have their own, different nodes, and the heat crosses the bond only through the temperature ties (M5.6, ADR-069). The bond is curved, so the ties also meet the chord of each element face across the cylinder. The setup uses °F, °C, K, W/(mm·K) and W/(m·K) on purpose (docs/VERIFICATION.md).

## Closed form

Steady radial conduction through two cylindrical layers in series with perfect contact (Incropera and DeWitt, *Fundamentals of Heat and Mass Transfer*, section 3.3.1, the composite cylinder): each layer's resistance per radian and unit length is ln(r_out/r_in)/k, so for the quarter

Q = (π/2) L (Ta − Tb) / (ln(r1/a)/k1 + ln(b/r1)/k2) = 283.57749 W (967.60654 BTU/h),

with ln(r1/a)/k1 = 0.00446287 and ln(b/r1)/k2 = 0.01215477 m·K/W. The temperature is logarithmic in each layer and continuous at the bond:

- T(r) = Ta − (Ta − Tb) ln(r/a)/k1 / S for a ≤ r ≤ r1, and T(r) = T1 − (Ta − Tb) ln(r/r1)/k2 / S beyond, S the sum of the two resistances;
- T1 = T(r1) = 432.865664 K (159.715664 °C, 319.488195 °F), on both sides of the bond;
- the radial heat flux q(r) = Q / ((π/2) r L).

| r | T | q |
| --- | --- | --- |
| 45 mm | 178.736507 °C | 200,590.04 W/m² |
| 50 mm (bond) | 432.865664 K | 180,531.03 W/m² |
| 54 mm | 113.402809 °C | 167,158.36 W/m² |

The heat that leaves through the outside equals the heat in at the bore: all of it crosses the bond, so the outside's heat flow, worked out from the fixed temperature's nodal heat flows, checks that the ties pass heat on.

## Where the results are read

On the cut y = 0 the radial direction is x. Each cut face belongs to one body, so the bond temperature is read on both sides, on the nodes of each cut face's edge z = 0 at x = 50 mm. The other temperatures and the radial flux are read on the cut faces' edge z = 0 at x = 45 mm (the inner layer's middle) and x = 54 mm (in the outer layer, where both tiers' element sizes put nodes on the edge). The heat flows are those of the two fixed-temperature loads.

## Tolerances

Temperatures 0.1 percent (of the kelvin value) on both tiers, the radial heat flux 2 percent coarse and 1 percent full (it is extrapolated from the integration points), the heat flows 0.5 percent coarse and 0.2 percent full, as for V-14 and close to V-18.

Measured while the case was written (2026-10-16, CalculiX 2.21, Gmsh 4.15.2, OpenCASCADE 7.8.1). Coarse (5 mm, outer layer 2 mm): temperatures within 0.01 % (the bond +0.01 % on both sides, 0.02 K and 0.04 °F), heat flux −0.10 % (inner) and 0.00 % (outer), heat flows below 0.01 %, heat balance 0.0000 %. Full (2.5 mm, outer layer 1 mm): temperatures within 0.005 %, heat flux −0.01 % and 0.00 %, heat flows below 0.01 %.
