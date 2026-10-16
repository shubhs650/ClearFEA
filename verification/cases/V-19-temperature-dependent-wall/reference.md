# V-19 Wall with temperature-dependent properties: reference values

## Model

A flat wall 40 mm thick along x and 20 mm by 20 mm across, from the origin. The face x = 0 is held at 752 °F (400 °C) and the face x = L at 20 °C (fixed temperatures); the four sides carry no thermal load, so they are insulated. The cold face and the four sides have frictionless supports: the sides stop the wall growing across (εyy = εzz = 0) and the cold face holds it along x, so the hot face is free to move. The stress-free temperature is 323.15 K (50 °C). Every property is a table, in mixed units on purpose (docs/VERIFICATION.md), with no single values:

| Property | Rows |
| --- | --- |
| Thermal conductivity | 20 °C: 52 W/(m·K); 420 °C: 36 W/(m·K), so k = 52 − 0.04 (T − 20 °C) |
| Young's modulus | 20 °C: 200 GPa; 400 °C: 172 GPa |
| Poisson's ratio | 212 °F (100 °C): 0.29; 572 °F (300 °C): 0.31, and 0.29 below, 0.31 above |
| Thermal expansion, mean from 68 °F (20 °C) | 68 °F: 11.5 µm/(m·K); 752 °F: 13.4 µm/(m·K) |

Between rows a value is linear in temperature, and beyond the first and last row it is their value (ADR-068), so Poisson's ratio is constant near both faces.

## Closed form

Steady conduction with k(T), insulated sides (Incropera and DeWitt, section 3.2, with the Kirchhoff transform θ(T) = ∫ k dT): θ falls linearly from the hot face to the cold one, and the heat flux is q = (θ(Th) − θ(Tc)) / L. For a linear k this is the conductivity at the mean temperature times ΔT / L: k(210 °C) = 44.4 W/(m·K), q = 44.4 × 380 / 0.04 = 421.8 kW/m², and the heat flow through the 20 × 20 mm face is 168.72 W. The temperature at x solves 52 u − 0.02 u² = 16 872 (1 − x/L) W/m with u = T − 20 °C.

Every point has εyy = εzz = 0 and, with the hot face free and no shear on any face, σxx = 0; the stresses then depend on x only and satisfy equilibrium (the same argument as for the bar of `worker/spikes/heat_check`, ADR-067). With the thermal strain counted from the stress-free temperature T₀ and the mean coefficients from Tref = 20 °C (ADR-068 item 4),

- ε(T) = α(T) (T − Tref) − α(T₀) (T₀ − Tref)
- σyy = σzz = −E(T) ε(T) / (1 − ν(T)), von Mises |σyy|
- εxx = ε(T) (1 + ν(T)) / (1 − ν(T)), and the hot face moves by u(0) = −∫₀ᴸ εxx dx
- the force on the wall y = 0 is −H ∫₀ᴸ σyy dx (the wall pushes the body in +y where the body is in compression)

The integrals were evaluated with Simpson's rule on 400 000 intervals (the script below), where every property was evaluated exactly as the table rule above says.

| x | T | ε | σyy = σzz |
| --- | --- | --- | --- |
| 0 (hot face) | 400 °C | 4.7425e-3 | −1182.1884 MPa |
| 10 mm | 291.749058 °C | 3.1449e-3 | −819.3088 MPa |
| 20 mm | 193.856137 °C | 1.8010e-3 | −481.1830 MPa |
| 30 mm | 103.817448 °C | 6.4953e-4 | −177.4109 MPa |
| 40 mm (cold face) | 20 °C | −3.4950e-4 | +98.4507 MPa |

u(0) = −0.145252771 mm; the force on the wall y = 0 is 401 990.71 N. Halfway through, the temperature is 16 K below the mean of the faces' (210 °C), which a constant conductivity would give.

```python
from math import sqrt
L, H = 0.040, 0.020
def lin(T, t0, v0, t1, v1):
    return v0 if T <= t0 else v1 if T >= t1 else v0 + (v1 - v0) * (T - t0) / (t1 - t0)
E = lambda T: lin(T, 20, 200e9, 400, 172e9)
nu = lambda T: lin(T, 100, 0.29, 300, 0.31)
al = lambda T: lin(T, 20, 11.5e-6, 400, 13.4e-6)
Q = 52 * 380 - 0.02 * 380**2                        # θ(Th) − θ(Tc), W/m
T = lambda x: 20 + (52 - sqrt(52**2 - 0.08 * Q * (1 - x / L))) / 0.04
eps = lambda t: al(t) * (t - 20) - al(50) * (50 - 20)
syy = lambda x: -E(T(x)) * eps(T(x)) / (1 - nu(T(x)))
exx = lambda x: eps(T(x)) * (1 + nu(T(x))) / (1 - nu(T(x)))
def simpson(f, a, b, n=400000):
    h = (b - a) / n
    return h / 3 * (f(a) + f(b) + sum((4 if i % 2 else 2) * f(a + i * h) for i in range(1, n)))
print(Q / L, -simpson(exx, 0, L), -H * simpson(syy, 0, L))
```

## Where the results are read

The solution is uniform across the wall, so the stresses at the faces x = 0 and x = L are read over the whole face, and the profile and the stresses inside on the face y = 0 along its edges at x = 10, 20 and 30 mm (both mesh sizes divide 40 mm, so there are nodes there). The heat flux is read over the whole face y = 0, the heat flows are the two fixed temperatures', the growth is the hot face's x displacement, and the force is the reaction y of the support on y = 0.

## Tolerances

TOLERANCES
