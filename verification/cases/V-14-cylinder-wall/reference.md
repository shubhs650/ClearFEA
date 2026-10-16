# V-14 Cylinder wall conduction: reference values

## Model

A quarter of a tube along z between the planes x = 0 and y = 0: inner radius a = 40 mm, outer radius b = 60 mm, length L = 20 mm (V-18's geometry). The bore is held at 100 °C (373.15 K) and the outside at 68 °F (293.15 K) (fixed temperatures); the cut and end faces carry no thermal load, so they are insulated, as the full tube is there by symmetry. k = 26 BTU/(h·ft·°F) = 44.9991 W/(m·K). The setup uses °C, °F, K and BTU units on purpose (docs/VERIFICATION.md).

## Closed form

Steady radial conduction between two fixed temperatures (Incropera and DeWitt, *Fundamentals of Heat and Mass Transfer*, section 3.3.1):

- T(r) = Ta − (Ta − Tb) ln(r/a) / ln(b/a);
- heat flow through the quarter Q = (π/2) k L (Ta − Tb) / ln(b/a) = 278.92678 W (951.73768 BTU/h);
- radial heat flux q(r) = Q / ((π/2) r L).

| r | T | q |
| --- | --- | --- |
| 45 mm | 349.910903 K | 197,300.34 W/m² |
| 50 mm | 55.972823 °C | 177,570.30 W/m² (56,289.49 BTU/(h·ft²)) |
| 55 mm | 98.90189 °F | 161,427.55 W/m² |

## Where the results are read

On the cut y = 0 the radial direction is x; the temperatures and the flux are read on that face's edge z = 0 at x = 45, 50 and 55 mm, where both tiers put nodes. The heat flows are those of the two fixed-temperature loads.

## Tolerances

Temperatures 0.1 percent on both tiers, the radial heat flux 2 percent coarse and 1 percent full (extrapolated from the integration points), the heat flows 0.5 percent coarse and 0.2 percent full.

Measured while the case was written (2026-10-16, CalculiX 2.21, Gmsh 4.15.2, OpenCASCADE 7.8.1). Coarse (5 mm): temperatures within 0.005 %, heat flux −0.03 %, heat flows below 0.01 %. Full (2.5 mm): temperatures below 0.005 %, heat flux +0.02 %, heat flows below 0.01 %.
