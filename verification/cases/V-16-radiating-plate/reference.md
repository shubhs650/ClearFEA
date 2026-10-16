# V-16 Heated plate radiating to ambient: reference values

## Model

A square plate L = 10 mm thick along x and 80 mm by 80 mm along y and z, from the origin. A heater puts q = 1500 BTU/(h·ft²) = 4731.886118 W/m² into its back face x = 0 (a heat flux, positive into the body). Its front face x = L radiates to a room at T∞ = 70 °F = 294.261111 K with an emissivity ε = 0.85, seeing nothing but the room. The conductivity is k = 1.5 W/(m·K) (a ceramic), constant. Every other face is insulated. There is no fixed temperature and no convection: the radiation alone sets the temperatures, which makes this the nonlinear case of ADR-065 (the deck starts the iterations from the room temperature). The setup uses BTU/(h·ft²) and °F, and the checks °C and °F, on purpose (docs/VERIFICATION.md). The Stefan-Boltzmann constant is σ = 5.670374419 × 10⁻⁸ W/(m²·K⁴) (CODATA 2018, exact in the 2019 SI).

## Closed form

With the side faces insulated, heat flows along x only, and in a steady state all of the heater's flux leaves through the front face by radiation:

q = εσ (Tf⁴ − T∞⁴), so Tf = (q/(εσ) + T∞⁴)^(1/4) = 570.152971 K = 297.002971 °C.

Inside the plate, steady conduction with constant k and no heat generation gives a linear profile carrying the same flux, so the back face is hotter by q L / k = 4731.886 × 0.01 / 1.5 = 31.545908 K: Tb = 328.548878 °C = 623.387981 °F. (Incropera and DeWitt, *Fundamentals of Heat and Mass Transfer*, sections 1.2 and 3.1; derived here in full so nothing depends on a source's numbers.)

## Where the results are read

The mean temperature over the front face and over the back face. The front face shows that the radiation reaches the solver with its emissivity, its sink temperature in kelvin with the °F offset, and the Stefan-Boltzmann constant; the back face adds the heat flux's unit and sign.

## Tolerances

0.01 percent of the absolute temperature (about 0.06 K) at both tiers. The exact profile is linear in x, which the elements represent exactly. What remains is the result files' five significant digits (0.01 K at 600 K) and CalculiX's iteration stop on the nonlinear radiation, which on the heat check's bar (`worker/spikes/heat_check`) left under 0.002 K. A wrong σ, a temperature in °C instead of K or a flux of the wrong sign would move the front face by tens of kelvin.
