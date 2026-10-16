# V-17 Slab with internal heat generation: reference values

## Model

A flat slab 2L = 40 mm thick along x (L = 20 mm, the half-thickness) and 60 mm by 60 mm along y and z, from the origin (V-13's geometry). It produces heat uniformly inside, q‴ = 0.01 W/mm³ = 10⁷ W/m³ (an electric current, for example), and both faces x = 0 and x = 2L are held at T0 = 50 °C (one fixed temperature on the two faces). The conductivity is k = 15 W/(m·°C) (a stainless steel), constant. Every other face is insulated. The setup uses W/mm³, W/(m·°C) and °C, and the checks °C and °F, on purpose (docs/VERIFICATION.md).

## Closed form

With the side faces insulated, heat flows along x only: k d²T/dx² + q‴ = 0 with T(0) = T(2L) = T0, whose solution is the parabola

T(x) = T0 + q‴ x (2L − x) / (2k),

highest at the centre, T0 + q‴L²/(2k) (Incropera and DeWitt, *Fundamentals of Heat and Mass Transfer*, section 3.5, the plane wall with heat generation; derived here in full so nothing depends on a source's numbers). With q‴/(2k) = 333333.3 K/m²:

- x = 20 mm (centre): 50 + 333333.3 × 0.02 × 0.02 = 183.333333 °C,
- x = 10 mm and 30 mm: 50 + 333333.3 × 0.01 × 0.03 = 150 °C = 302 °F,
- the faces: 50 °C = 122 °F.

## Where the results are read

The mean temperature of the side face y = 0 along the lines x = 10, 20 and 30 mm (both mesh sizes divide the thickness, so the mesh has nodes on the face's edges there), and over the face x = 0.

## Tolerances

0.01 percent of the absolute temperature (about 0.05 K) at both tiers. The exact temperature is quadratic in x, which ten-node tetrahedra represent exactly, so the solver's answer is exact up to the result files' five significant digits (0.01 K at 450 K) and float32 positions; a heat generation in the wrong unit or applied per face instead of per volume would move the centre by tens of kelvin. Four-node tetrahedra are linear in a quadratic profile and are not used here; the heat check (`worker/spikes/heat_check`) shows them 0.3 percent of the rise off at a 10 mm mesh.
