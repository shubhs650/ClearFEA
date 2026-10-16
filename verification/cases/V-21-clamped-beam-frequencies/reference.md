# V-21 Fixed-fixed beam frequencies: reference values

## Model

V-20's bar (L = 800 mm along x, b = 16 mm along y, h = 8 mm along z) clamped on both end faces, x = 0 and x = L (two fixed supports), with no load: a modal analysis (M6.1, ADR-070) asks for its three lowest natural frequencies. E = 200 GPa, ν = 0.3 and ρ = 7850 kg/m³; the first reference is given in cycles per minute, on purpose (docs/VERIFICATION.md).

docs/PLAN.md listed V-21 as a simply supported plate until M6.1; docs/VERIFICATION.md's fixed-fixed beam was kept (ADR-070), since a solid plate's simple support has no clean counterpart among the supports (it would hold an edge, not a face).

## Closed form

As in V-20, f_n = (β_n L)² / (2π L²) × √(E d² / (12 ρ)), with the roots of the clamped-clamped beam's frequency equation cos βL cosh βL = 1: 4.730041 and 7.853205 (Blevins, *Formulas for Natural Frequency and Mode Shape*, table 8-1; found again numerically in the harness test).

| Mode | Shape | d | β_n L | f (Hz) |
| --- | --- | --- | --- | --- |
| 1 | first bending in z | 8 mm | 4.730041 | 64.855895 (3891.3537 cpm) |
| 2 | first bending in y | 16 mm | 4.730041 | 129.711789 |
| 3 | second bending in z | 8 mm | 7.853205 | 178.777771 |

The next modes, the third bending mode in z (350.5 Hz) and the second in y (357.6 Hz), lie close together, so the case stops at mode 3, where the order is certain: the first two bending modes in z, as docs/VERIFICATION.md lists, and the first in y between them.

## Tolerances

0.5 percent on the coarse tier and 0.3 percent on the full tier (3 mm, as V-20), for the reasons V-20 gives: shear deformation and rotary inertia lower the frequencies (at most 0.15 percent here, mode 2) and the clamped faces' held Poisson contraction raises them (0.15 percent on mode 1), on both tiers alike. Measured with `worker/spikes/modal_check` (SPOOLES) at 4 mm: +0.15, −0.13 and +0.07 percent; at 2 mm: +0.12, −0.15 and +0.04 percent.
