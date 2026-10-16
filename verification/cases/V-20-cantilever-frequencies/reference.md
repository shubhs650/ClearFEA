# V-20 Cantilever beam frequencies: reference values

## Model

A steel bar L = 800 mm long along x, b = 16 mm wide along y and h = 8 mm deep along z, from the origin, clamped on its whole end face x = 0 (a fixed support) and free everywhere else, with no load: a modal analysis (M6.1, ADR-070) asks for its five lowest natural frequencies. E = 200,000 MPa, ν = 0.3 and ρ = 7.85 g/cm³ (7850 kg/m³), entered in MPa and g/cm³, and two references given in cycles per minute and the rest in hertz, on purpose (docs/VERIFICATION.md).

## Closed form

An Euler-Bernoulli beam bending across a depth d has the natural frequencies

f_n = (β_n L)² / (2π L²) × √(E I / (ρ A)),  with I / A = d² / 12 for a rectangle,

where β_n L are the roots of the cantilever's frequency equation cos βL cosh βL = −1: 1.875104, 4.694091, 7.854757 (Blevins, *Formulas for Natural Frequency and Mode Shape*, table 8-1; the roots are found again numerically in the harness test). √(E / (12 ρ)) = √(200e9 / (12 × 7850)) = 1457.1 m/s, so

| Mode | Shape | d | β_n L | f (Hz) |
| --- | --- | --- | --- | --- |
| 1 | first bending in z | 8 mm | 1.875104 | 10.192259 |
| 2 | first bending in y | 16 mm | 1.875104 | 20.384518 |
| 3 | second bending in z | 8 mm | 4.694091 | 63.873796 (3832.42776 cpm) |
| 4 | second bending in y | 16 mm | 4.694091 | 127.747591 |
| 5 | third bending in z | 8 mm | 7.854757 | 178.848477 |

A bar twice as wide as it is deep bends in y at twice the frequency it bends in z, so the two families interleave as above. The next modes are the third bending mode in y (357.7 Hz) and the first twisting mode (about 725 Hz with Saint-Venant's torsion constant), well above mode 5; the first stretching mode is at 1577 Hz.

## Tolerances

0.5 percent on the coarse tier and 0.3 percent on the full tier, whose mesh is 3 mm: at 2 mm the solve (PaStiX, the default) needs more than the 4 GB the verification worker has. Euler-Bernoulli leaves out shear deformation and rotary inertia, which lower a frequency by about (β_n r)² (1 + E / (κ G)) / 2 with r the radius of gyration (Rayleigh and Timoshenko's correction): at most 0.16 percent here, for mode 4. The clamped face also stops the sideways Poisson contraction that the beam theory lets the root have, which stiffens the first mode by about 0.1 percent. These are differences between the beam theory and a solid bar, not mesh errors, so they stay on the full tier. Measured with `worker/spikes/modal_check` (SPOOLES) at 4 mm: +0.10, +0.04, +0.06, −0.15 and −0.02 percent; at 2 mm: +0.09, +0.03, +0.04, −0.16 and −0.03 percent. A wrong density or Young's modulus unit, or the wrong support, would be off by a factor, not a fraction of a percent.
