# V-15 Wall with convection on both sides: reference values

## Model

A flat wall L = 40 mm thick along x and 60 mm by 60 mm along y and z, from the origin (V-13's geometry). Its face x = 0 is in a hot gas at T∞1 = 392 °F (200 °C, 473.15 K) with a convection coefficient h1 = 250 W/(m²·°C), and its face x = L in room air at T∞2 = 20 °C (293.15 K) with h2 = 20 BTU/(h·ft²·°F) = 113.565267 W/(m²·K). The conductivity is k = 0.0015 W/(mm·K) = 1.5 W/(m·K) (about that of concrete), constant. Every other face is insulated. There is no fixed temperature: convection alone sets the temperatures (ADR-065). The setup uses °F, °C, W/(m²·°C), BTU/(h·ft²·°F) and W/(mm·K), and the checks °C and °F, on purpose (docs/VERIFICATION.md).

## Closed form

With the side faces insulated, heat flows along x only. The gas, the wall and the air are three resistances in series per unit area, 1/h1, L/k and 1/h2, so the heat flux is

q = (T∞1 − T∞2) / (1/h1 + L/k + 1/h2)

(Incropera and DeWitt, *Fundamentals of Heat and Mass Transfer*, section 3.1, the plane wall with convection; derived here in full so nothing depends on a source's numbers). With 1/h1 = 0.004, L/k = 0.0266667 and 1/h2 = 0.00880555 m²·K/W, q = 180 K / 0.0394722 m²·K/W = 4560.17 W/m². The surface temperatures follow from each film:

- hot surface: T∞1 − q/h1 = 200 − 18.2407 = 181.759303 °C,
- cold surface: T∞2 + q/h2 = 20 + 40.1547 = 60.154656 °C = 140.278381 °F,

and the temperature is linear through the wall between them, so halfway through it is their mean, 120.956980 °C. The heat flux itself is the other half of this case in docs/VERIFICATION.md; it is checked when heat-flux results arrive (M5.3).

## Where the results are read

- The hot and cold faces: the mean temperature over each face, which shows both films reach the solver with the right coefficient, sink temperature and offset.
- The midplane: the mean temperature of the side face y = 0 along the line x = 20 mm. Both mesh sizes divide the thickness, so the mesh has nodes on the face's edges there.

## Tolerances

0.01 percent of the absolute temperature (about 0.04 K) for every check at both tiers. The exact temperature is linear in x, which linear and quadratic tetrahedra represent exactly, and a film's heat loss is linear in the surface temperature, so the solver's answer is exact up to the result files' five significant digits (0.01 K at 450 K) and float32 positions. A wrong coefficient unit would move the surface temperatures by degrees.
