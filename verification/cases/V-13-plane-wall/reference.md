# V-13 Plane wall conduction: reference values

## Model

A flat wall L = 40 mm thick along x and 60 mm by 60 mm along y and z, from the origin. The face x = 0 is held at Th = 300 °F and the face x = L at Tc = 20 °C (fixed temperatures); every other face is insulated, which is what a face with no thermal load is in a steady-state thermal analysis (ADR-064). The conductivity is k = 26 BTU/(h·ft·°F) (about 45 W/(m·K), a carbon steel), constant. The setup uses °F, °C and BTU/(h·ft·°F), and the checks °C and °F, on purpose (docs/VERIFICATION.md). Absolute temperatures convert with their offsets: Th = (300 + 459.67) × 5/9 K = 422.038889 K = 148.888889 °C, and Tc = 293.15 K.

## Closed form

With the four side faces insulated, heat flows along x only and the problem is one-dimensional: steady conduction with no heat generation and constant k is d²T/dx² = 0, so the temperature is linear through the wall,

T(x) = Th − (Th − Tc) x / L,

whatever the value of k (Incropera and DeWitt, *Fundamentals of Heat and Mass Transfer*, section 3.1, the plane wall; derived here in full so nothing depends on a source's numbers). Th − Tc = 128.888889 K, so

- x = 10 mm (L/4): 148.888889 − 32.222222 = 116.666667 °C,
- x = 20 mm (L/2): 84.444444 °C,
- x = 30 mm (3L/4): 52.222222 °C = 126 °F.

The heat flux k (Th − Tc) / L = 45.0 W/(m·K) × 128.888889 K / 0.04 m ≈ 145 kW/m² is the other half of this case in docs/VERIFICATION.md; it is checked when heat-flux results arrive (M5.3).

## Where the results are read

- The hot and cold faces: the mean temperature over each face, which shows the fixed temperatures reach the solver with their offsets.
- The profile: the mean temperature of the side face y = 0 along the lines x = 10, 20 and 30 mm. Both mesh sizes (10 mm and 2.5 mm) divide the thickness, so the mesh has nodes on the face's edges (z = 0 and z = 60 mm) exactly at those x; the box picks the surface vertices on each line.

## Tolerances

0.01 percent of the absolute temperature (about 0.04 K) for every check at both tiers. A linear temperature is represented exactly by linear and quadratic tetrahedra, so what remains is the result files' five significant digits (0.01 K at 400 K) and float32 positions. A larger error would mean a fixed temperature, its unit's offset or the insulated faces are wrong. The conductivity is checked by the deck snapshot tests and the heat check (`worker/spikes/heat_check`), and by its flux in M5.3.
