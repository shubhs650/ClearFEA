# V-22 Unrestrained body: reference values

## Model

V-20's bar (L = 800 mm along x, b = 16 mm along y, h = 8 mm along z) with no support and no load: a modal analysis (M6.1, ADR-070) asks for its eight lowest natural frequencies. E = 200 GPa, ν = 0.3 and ρ = 7.85e-9 t/mm³ (7850 kg/m³, the tonne-millimetre system); the last reference is given in kHz, on purpose (docs/VERIFICATION.md).

## Reference

A body nothing holds can move as a rigid body in six ways, three translations and three rotations, without deforming, so its six lowest natural frequencies are zero. The solver finds them as eigenvalues of the order of the rounding of the stiffness matrix, a little above or below zero (CalculiX shifts the eigenvalue problem by 1 rad²/s² so that the free body's stiffness can be factorised). A support or a bond holding something it should not would lift one of them far from zero.

The next modes bend the bar free-free. A free-free Euler-Bernoulli beam has the same frequency equation as a clamped-clamped one, cos βL cosh βL = 1 (Blevins, *Formulas for Natural Frequency and Mode Shape*, table 8-1), so with V-21's roots:

| Mode | Shape | d | β_n L | f (Hz) |
| --- | --- | --- | --- | --- |
| 1 to 6 | rigid-body | | | 0 |
| 7 | first bending in z | 8 mm | 4.730041 | 64.855895 |
| 8 | first bending in y | 16 mm | 4.730041 | 129.711789 (0.12971179 kHz) |

The second free-free bending mode in z is at 178.8 Hz and the first twisting mode near 1450 Hz, both above mode 8.

## Tolerances

Modes 1 to 6: within 0.1 percent of mode 7's frequency (about 0.065 Hz) on both tiers. Measured with `worker/spikes/modal_check` (SPOOLES), the largest was 0.0024 Hz at 4 mm and 0.0030 Hz at 2 mm, about 4e-5 of mode 7; the bound leaves room for another equation solver's rounding while a held degree of freedom would give a frequency of the order of the elastic modes.

Modes 7 and 8: 0.5 percent on the coarse tier and 0.3 percent on the full tier, as in V-20 and V-21: shear deformation and rotary inertia lower them by up to 0.15 percent (mode 8), on both tiers alike. Measured: −0.04 and −0.14 percent at 4 mm, −0.04 and −0.14 percent at 2 mm. With no clamped face, nothing raises them.
