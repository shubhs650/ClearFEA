Tier: full

| Case | Check | Reference | ClearFEA | Error | Tolerance | Result |
| --- | --- | --- | --- | --- | --- | --- |
| V-01 | STEP length unit detected | mm | mm |  | equal | pass |
| V-01 | Hoop-dominated von Mises stress at the bore | 32.187 MPa | 32.06 MPa (939 vertices) | -0.39 % | 1 % | pass |
| V-01 | von Mises stress at the outside | 16 MPa | 15.974 MPa (1419 vertices) | -0.16 % | 1 % | pass |
| V-01 | Radial displacement of the bore | 0.0058 mm | 0.0057998 mm (939 vertices) | -0.00 % | 0.5 % | pass |
| V-01 | Radial displacement of the outside | 0.0048 mm | 0.0047999 mm (1419 vertices) | -0.00 % | 0.5 % | pass |
| V-01 | Hoop stress at the bore is σ1 | 26 MPa | 26.004 MPa (939 vertices) | +0.02 % | 1 % | pass |
| V-01 | Hoop stress at the outside is σ1 | 16 MPa | 16.001 MPa (1419 vertices) | +0.01 % | 1 % | pass |
| V-01 | Shear stress τxy at 45 degrees on the bore | -18 MPa | -17.916 MPa (61 vertices) | -0.47 % | 1 % | pass |
| V-01 | Shear strain εxy at 45 degrees on the bore (tensor, γxy / 2) | -117 µε | -116.45 µε (61 vertices) | -0.47 % | 1 % | pass |
| V-01 | Reactions balance the applied load | applied 5.0147e-11, 1.7875e-11, 7.6605e-15 N | reactions 0.00028877, -7.5576e-05, 0.00064602 N | 0.0000 % of 7.5389e+05 N | 0.1 % | pass |
| V-01 | The run's balance check closes | force and moment | force 9.4e-08 %, moment 1.1e-08 % | 0.0000 % | 0.1 % | pass |
| V-01 | Solver log has no unexpected warnings | none | none |  |  | pass |
| V-01 | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 36 s, charged True, 1 entry |  |  | pass |
| V-02 | STEP length unit detected | in | in |  | equal | pass |
| V-02 | Tip deflection (mean over the free end) | -0.064313 in | -0.063851 in (633 vertices) | -0.72 % | 1.5 % | pass |
| V-02 | Bending stress on top at mid-length | 13500 psi | 13495 psi (252 vertices) | -0.04 % | 0.5 % | pass |
| V-02 | Bending stress underneath at mid-length | 13500 psi | 13497 psi (259 vertices) | -0.02 % | 0.5 % | pass |
| V-02 | Clamp carries the end load | 500 lbf | 500 lbf (support fixed-1) | -0.00 % | 0.1 % | pass |
| V-02 | Reactions balance the applied load | applied 0, -2224.1, 0 N | reactions 0.00016064, 2224.1, 8.4493e-05 N | 0.0000 % of 2224.1 N | 0.1 % | pass |
| V-02 | The run's balance check closes | force and moment | force 8.2e-06 %, moment 7.4e-07 % | 0.0000 % | 0.1 % | pass |
| V-02 | Solver log has no unexpected warnings | none | none |  |  | pass |
| V-02 | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 23 s, charged True, 1 entry |  |  | pass |
| V-03 | STEP length unit detected | mm | mm |  | equal | pass |
| V-03 | Peak stress at the side of the hole (Kt sigma, Kt = 3.025) | 302.5 MPa | 303.6 MPa (21 vertices) | +0.36 % | 1 % | pass |
| V-03 | Uniform stress at the pulled end (F / A) | 100 MPa | 99.995 MPa (203 vertices) | -0.01 % | 0.5 % | pass |
| V-03 | Reactions balance the applied load | applied 12500, 0, 0 N | reactions -12500, -1.1568e-06, -7.8775e-08 N | 0.0000 % of 12500 N | 0.1 % | pass |
| V-03 | The run's balance check closes | force and moment | force 1.9e-06 %, moment 2.4e-07 % | 0.0000 % | 0.1 % | pass |
| V-03 | Solver log has no unexpected warnings | none | none |  |  | pass |
| V-03 | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 5 s, charged True, 1 entry |  |  | pass |
| V-04 | STEP length unit detected | mm | mm |  | equal | pass |
| V-04 | Clamp carries the axial force | -6 kN | -6 kN (support clamp) | +0.00 % | 0.1 % | pass |
| V-04 | Clamp's moment about its centre, torque | -120 N·m | -120 N·m (support clamp) | -0.00 % | 0.1 % | pass |
| V-04 | Clamp's moment about its centre, bending with the point's lever | -127.79 N·m | -127.79 N·m (support clamp) | -0.00 % | 0.1 % | pass |
| V-04 | Bending, torsion and tension on top (y = +R) | 55.811 MPa | 55.791 MPa (159 vertices) | -0.04 % | 0.5 % | pass |
| V-04 | Bending, torsion and tension underneath (y = -R) | 68.933 MPa | 68.892 MPa (157 vertices) | -0.06 % | 0.5 % | pass |
| V-04 | Torsion and tension on the side (z = +R, no bending) | 40.114 MPa | 40.163 MPa (181 vertices) | +0.12 % | 0.5 % | pass |
| V-04 | Reactions balance the applied load | applied 6000, 0, 0 N | reactions -6000, 4.4986e-05, 5.5733e-05 N | 0.0000 % of 6000 N | 0.1 % | pass |
| V-04 | The run's balance check closes | force and moment | force 5.4e-07 %, moment 3.4e-08 % | 0.0000 % | 0.1 % | pass |
| V-04 | Solver log has no unexpected warnings | none | none |  |  | pass |
| V-04 | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 51 s, charged True, 1 entry |  |  | pass |
| V-05 | STEP length unit detected | mm | mm |  | equal | pass |
| V-05 | Base carries the water's push (ρ g b H²/2) | -78.453 N | -78.453 N (support base) | -0.00 % | 0.1 % | pass |
| V-05 | Bending stress on the dry side at z = 100 mm | 661.95 kPa | 661.69 kPa (209 vertices) | -0.04 % | 0.5 % | pass |
| V-05 | Bending stress on the dry side at z = 200 mm | 196.13 kPa | 195.94 kPa (213 vertices) | -0.10 % | 0.5 % | pass |
| V-05 | Top of the wall moves away from the water | 0.094323 mm | 0.094322 mm (469 vertices) | -0.00 % | 0.5 % | pass |
| V-05 | Reactions balance the applied load | applied 0, 78.453, 0 N | reactions 5.83e-10, -78.453, -9.4618e-06 N | 0.0000 % of 78.453 N | 0.1 % | pass |
| V-05 | The run's balance check closes | force and moment | force 1.2e-05 %, moment 1.5e-06 % | 0.0000 % | 0.1 % | pass |
| V-05 | Solver log has no unexpected warnings | none | none |  |  | pass |
| V-05 | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 21 s, charged True, 1 entry |  |  | pass |
| V-06 | STEP length unit detected | mm | mm |  | equal | pass |
| V-06 | Hoop stress outside, r = b | 72.591 MPa | 72.591 MPa (2861 vertices) | -0.00 % | 0.5 % | pass |
| V-06 | Hoop stress inside, r = a | 83.223 MPa | 83.221 MPa (2601 vertices) | -0.00 % | 0.5 % | pass |
| V-06 | Radial growth outside (b σθ/E) | 0.034567 mm | 0.034567 mm (2861 vertices) | -0.00 % | 0.5 % | pass |
| V-06 | Radial growth inside (a σθ/E) | 0.035667 mm | 0.035666 mm (2601 vertices) | -0.00 % | 0.5 % | pass |
| V-06 | Hoop force across the cut x = 0 | -3.8882 kN | -3.8882 kN (support cut-x) | -0.00 % | 0.1 % | pass |
| V-06 | Hoop force across the cut y = 0 | -3.8882 kN | -3.8882 kN (support cut-y) | -0.00 % | 0.1 % | pass |
| V-06 | Reactions balance the applied load | applied 3888.2, 3888.2, 0 N | reactions -3888.2, -3888.2, 8.7659e-09 N | 0.0003 % of 6107.5 N | 0.1 % | pass |
| V-06 | The run's balance check closes | force and moment | force 9.1e-07 %, moment 8e-07 % | 0.0000 % | 0.1 % | pass |
| V-06 | Solver log has no unexpected warnings | none | none |  |  | pass |
| V-06 | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 8 s, charged True, 1 entry |  |  | pass |
| V-07 | STEP length unit detected | mm | mm |  | equal | pass |
| V-07 | Base settles by F / (k A) | -1.842 mm | -1.842 mm (1209 vertices) | +0.00 % | 0.1 % | pass |
| V-07 | Top moves by F / (k A) + F H / (E A) | -2.242 mm | -2.242 mm (1209 vertices) | +0.00 % | 0.1 % | pass |
| V-07 | Uniform compression F / A | 1 MPa | 0.99999 MPa (521 vertices) | -0.00 % | 0.1 % | pass |
| V-07 | Foundation carries the force | 6 kN | 6 kN (support foundation) | -0.00 % | 0.1 % | pass |
| V-07 | Reactions balance the applied load | applied 0, 0, -6000 N | reactions 4.5704e-11, 4.8248e-12, 6000 N | 0.0000 % of 6000 N | 0.1 % | pass |
| V-07 | The run's balance check closes | force and moment | force 1.5e-05 %, moment 6.9e-06 % | 0.0000 % | 0.1 % | pass |
| V-07 | Solver log has no unexpected warnings | none | none |  |  | pass |
| V-07 | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 4 s, charged True, 1 entry |  |  | pass |
| V-08 | STEP length unit detected | mm | mm |  | equal | pass |
| V-08 | Uniform axial stress E alpha dT (von Mises) | 116.97 MPa | 116.97 MPa (1841 vertices) | -0.00 % | 0.1 % | pass |
| V-08 | Start pushes the bar towards +x with E alpha dT A | 23.394 kN | 23.394 kN (support start) | +0.00 % | 0.1 % | pass |
| V-08 | End pushes the bar towards -x with E alpha dT A | -23.394 kN | -23.394 kN (support end) | +0.00 % | 0.1 % | pass |
| V-08 | Side grows by (1 + nu) alpha dT b | 0.01521 mm | 0.01521 mm (1841 vertices) | +0.00 % | 0.1 % | pass |
| V-08 | Top grows by (1 + nu) alpha dT h | 0.007605 mm | 0.007605 mm (3381 vertices) | +0.00 % | 0.1 % | pass |
| V-08 | Axial stress σxx is compression −E alpha dT | -116.97 MPa | -116.97 MPa (1841 vertices) | -0.00 % | 0.1 % | pass |
| V-08 | Smallest principal stress is the axial compression | -116.97 MPa | -116.97 MPa (1841 vertices) | -0.00 % | 0.1 % | pass |
| V-08 | Total strain across the width (1 + nu) alpha dT | 0.07605 % | 0.076049 % (1841 vertices) | -0.00 % | 0.1 % | pass |
| V-08 | Total strain through the thickness (1 + nu) alpha dT | 760.5 µε | 760.49 µε (3381 vertices) | -0.00 % | 0.1 % | pass |
| V-08 | Reactions balance the applied load | applied 0, 0, 0 N | reactions -1.0914e-11, -2.4633e-10, 2.3767e-10 N | 0.0000 % of 46788 N | 0.1 % | pass |
| V-08 | The run's balance check closes | force and moment | force 7.3e-13 %, moment 4e-13 % | 0.0000 % | 0.1 % | pass |
| V-08 | Solver log has no unexpected warnings | none | none |  |  | pass |
| V-08 | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 4 s, charged True, 1 entry |  |  | pass |
| V-09 | STEP length unit detected | mm | mm |  | equal | pass |
| V-09 | von Mises stress at the bore (full tube 32.1870 MPa) | 32.187 MPa | 32.081 MPa (1307 vertices) | -0.33 % | 1 % | pass |
| V-09 | von Mises stress at the outside (full tube 16.0 MPa) | 16 MPa | 15.978 MPa (1879 vertices) | -0.14 % | 1 % | pass |
| V-09 | Radial displacement of the bore (full tube 0.0058 mm) | 0.0058 mm | 0.0057998 mm (1307 vertices) | -0.00 % | 0.5 % | pass |
| V-09 | Radial displacement of the outside (full tube 0.0048 mm) | 0.0048 mm | 0.0047999 mm (1879 vertices) | -0.00 % | 0.5 % | pass |
| V-09 | Hoop force on the 30° plane, x | 20 kN | 20 kN (support cut-30) | -0.00 % | 0.2 % | pass |
| V-09 | Hoop force on the 30° plane, y | -34.641 kN | -34.641 kN (support cut-30) | +0.00 % | 0.2 % | pass |
| V-09 | Hoop force on the 120° plane, x | -34.641 kN | -34.641 kN (support cut-120) | +0.00 % | 0.2 % | pass |
| V-09 | Hoop force on the 120° plane, y | -20 kN | -20 kN (support cut-120) | +0.00 % | 0.2 % | pass |
| V-09 | Reactions balance the applied load | applied 14641, 54641, 1.9984e-15 N | reactions -14641, -54641, 2.1474e-07 N | 0.0000 % of 62825 N | 0.1 % | pass |
| V-09 | The run's balance check closes | force and moment | force 2.8e-07 %, moment 1.5e-07 % | 0.0000 % | 0.1 % | pass |
| V-09 | Solver log has no unexpected warnings | none | none |  |  | pass |
| V-09 | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 2 s, charged True, 1 entry |  |  | pass |
| V-10 | STEP length unit detected | in | in |  | equal | pass |
| V-10 | Node values served per field match nodes.bin | 5 fields | 41153 nodes | equal | equal | pass |
| V-10 | Base carries the weight (ρ g A h) | 181.76 lbf | 181.76 lbf (support base) | -0.00 % | 0.1 % | pass |
| V-10 | Axial stress at mid-height (ρ g h/2) | 5.68 psi | 5.6782 psi (179 vertices) | -0.03 % | 0.5 % | pass |
| V-10 | Axial stress inside at quarter height (ρ g 3h/4) | -8.52 psi | -8.5179 psi (1075 nodes inside) | -0.02 % | 0.5 % | pass |
| V-10 | Top shortens by ρ g h²/(2E) | -7.8324e-06 in | -7.8324e-06 in (357 vertices) | +0.00 % | 0.5 % | pass |
| V-10 | Reactions balance the applied load | applied 0, 0, -808.51 N | reactions 9.3175e-12, -4.9055e-12, 808.51 N | 0.0000 % of 808.51 N | 0.1 % | pass |
| V-10 | The run's balance check closes | force and moment | force 9.8e-07 %, moment 4.6e-08 % | 0.0000 % | 0.1 % | pass |
| V-10 | Solver log has no unexpected warnings | none | none |  |  | pass |
| V-10 | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 11 s, charged True, 1 entry |  |  | pass |
| V-11 | STEP length unit detected | in | in |  | equal | pass |
| V-11 | Tip deflection (mean over the free end) | -0.064313 in | -0.063861 in (633 vertices) | -0.70 % | 1.5 % | pass |
| V-11 | Bending stress on top at mid-length, 2 in past the bond | 13500 psi | 13486 psi (263 vertices) | -0.10 % | 0.5 % | pass |
| V-11 | Bending stress underneath at mid-length, 2 in past the bond | 13500 psi | 13508 psi (257 vertices) | +0.06 % | 0.5 % | pass |
| V-11 | Clamp carries the end load through the bond | 500 lbf | 500 lbf (support fixed-1) | +0.00 % | 0.1 % | pass |
| V-11 | Reactions balance the applied load | applied 0, -2224.1, 0 N | reactions -0.00015764, 2224.1, 8.393e-06 N | 0.0000 % of 2224.1 N | 0.1 % | pass |
| V-11 | The run's balance check closes | force and moment | force 8.8e-06 %, moment 9.4e-07 % | 0.0000 % | 0.1 % | pass |
| V-11 | Solver log has no unexpected warnings | none | none |  |  | pass |
| V-11 | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 48 s, charged True, 1 entry |  |  | pass |
| V-12 | STEP length unit detected | mm | mm |  | equal | pass |
| V-12 | Normal stress σxx along body 1 (F / A) | 50 MPa | 49.998 MPa (929 vertices) | -0.00 % | 0.1 % | pass |
| V-12 | Normal stress σxx along body 2 (F / A) | 50 MPa | 50.005 MPa (1391 vertices) | +0.01 % | 0.1 % | pass |
| V-12 | von Mises stress along body 2, top | 7.2519 ksi | 7.2527 ksi (1395 vertices) | +0.01 % | 0.1 % | pass |
| V-12 | Axial strain in body 1 (σ / E1) | 250 µε | 249.99 µε (929 vertices) | -0.00 % | 0.1 % | pass |
| V-12 | Axial strain in body 2 (σ / E2) | 714.29 µε | 714.35 µε (1391 vertices) | +0.01 % | 0.1 % | pass |
| V-12 | End moved by σ (L1 / E1 + L2 / E2) | 0.067857 mm | 0.067858 mm (265 vertices) | +0.00 % | 0.1 % | pass |
| V-12 | Body 1 side contracts (−ν1 σ / E1 · 10 mm) | -0.00075 mm | -0.00075 mm (929 vertices) | +0.00 % | 0.1 % | pass |
| V-12 | Body 2 side contracts alike (−ν2 σ / E2 · 10 mm) | -0.00075 mm | -0.00074998 mm (1391 vertices) | -0.00 % | 0.1 % | pass |
| V-12 | Start holds the end load | -5 kN | -5 kN (support start) | -0.00 % | 0.1 % | pass |
| V-12 | Reactions balance the applied load | applied 5000, 0, 0 N | reactions -5000, 9.9112e-08, -7.2553e-07 N | 0.0000 % of 5000 N | 0.1 % | pass |
| V-12 | The run's balance check closes | force and moment | force 1.2e-06 %, moment 7e-08 % | 0.0000 % | 0.1 % | pass |
| V-12 | Solver log has no unexpected warnings | none | none |  |  | pass |
| V-12 | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 5 s, charged True, 1 entry |  |  | pass |
| V-13 | STEP length unit detected | mm | mm |  | equal | pass |
| V-13 | Hot face at 300 °F | 148.89 °C | 148.89 °C (2821 vertices) | +0.00 % | 0.01 % | pass |
| V-13 | Cold face at 20 °C | 20 °C | 20 °C (2821 vertices) | -0.00 % | 0.01 % | pass |
| V-13 | A quarter of the way through, Th − (Th − Tc) / 4 | 116.67 °C | 116.67 °C (2 vertices) | +0.00 % | 0.01 % | pass |
| V-13 | Halfway through, the mean of Th and Tc | 84.444 °C | 84.444 °C (2 vertices) | -0.00 % | 0.01 % | pass |
| V-13 | Three quarters of the way through, Tc + (Th − Tc) / 4 | 126 °F | 126 °F (2 vertices) | -0.00 % | 0.01 % | pass |
| V-13 | Heat flux along x, k (Th − Tc) / L | 45964 BTU/(h·ft²) | 45963 BTU/(h·ft²) (1897 vertices) | -0.00 % | 0.01 % | pass |
| V-13 | Heat flux magnitude at the cold face | 145 kW/m² | 145 kW/m² (2821 vertices) | -0.00 % | 0.01 % | pass |
| V-13 | Heat in through the hot face, q A | 521.99 W | 521.99 W (load hot) | -0.00 % | 0.01 % | pass |
| V-13 | Heat out through the cold face, − q A | -1781.1 BTU/h | -1781.1 BTU/h (load cold) | -0.00 % | 0.01 % | pass |
| V-13 | The run's heat balance closes | heat in 521.99 W | heat out 521.99 W | 0.0000 % of 521.99 W | 0.1 % | pass |
| V-13 | Solver log has no unexpected warnings | none | none |  |  | pass |
| V-13 | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 7 s, charged True, 1 entry |  |  | pass |
| V-14 | STEP length unit detected | mm | mm |  | equal | pass |
| V-14 | A quarter of the way through, r = 45 mm | 349.91 K | 349.91 K (1 vertices) | +0.00 % | 0.1 % | pass |
| V-14 | Halfway through, r = 50 mm | 55.973 °C | 55.973 °C (1 vertices) | +0.00 % | 0.1 % | pass |
| V-14 | Three quarters of the way through, r = 55 mm | 98.902 °F | 98.902 °F (1 vertices) | +0.00 % | 0.1 % | pass |
| V-14 | Radial heat flux halfway through, Q / ((π/2) r L) | 56289 BTU/(h·ft²) | 56300 BTU/(h·ft²) (1 vertices) | +0.02 % | 1 % | pass |
| V-14 | Heat in through the bore, (π/2) k L ΔT / ln(b/a) | 278.93 W | 278.93 W (load bore) | +0.00 % | 0.2 % | pass |
| V-14 | Heat out through the outside | -951.74 BTU/h | -951.74 BTU/h (load outside) | +0.00 % | 0.2 % | pass |
| V-14 | The run's heat balance closes | heat in 278.93 W | heat out 278.93 W | 0.0000 % of 278.97 W | 0.1 % | pass |
| V-14 | Solver log has no unexpected warnings | none | none |  |  | pass |
| V-14 | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 2 s, charged True, 1 entry |  |  | pass |
| V-15 | STEP length unit detected | mm | mm |  | equal | pass |
| V-15 | Hot surface, T∞1 − q/h1 | 181.76 °C | 181.76 °C (2821 vertices) | -0.00 % | 0.01 % | pass |
| V-15 | Cold surface, T∞2 + q/h2 | 140.28 °F | 140.28 °F (2821 vertices) | +0.00 % | 0.01 % | pass |
| V-15 | Halfway through, the mean of the surface temperatures | 120.96 °C | 120.96 °C (2 vertices) | +0.00 % | 0.01 % | pass |
| V-15 | Heat flux along x, ΔT / (1/h1 + L/k + 1/h2) | 4.5602 kW/m² | 4.5601 kW/m² (1897 vertices) | -0.00 % | 0.01 % | pass |
| V-15 | Heat in from the hot gas, q A | 16.417 W | 16.417 W (load hot) | +0.00 % | 0.01 % | pass |
| V-15 | Heat out to the room air, − q A | -56.016 BTU/h | -56.016 BTU/h (load cold) | +0.00 % | 0.01 % | pass |
| V-15 | The run's heat balance closes | heat in 16.417 W | heat out 16.417 W | 0.0001 % of 16.417 W | 0.1 % | pass |
| V-15 | Solver log has no unexpected warnings | none | none |  |  | pass |
| V-15 | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 7 s, charged True, 1 entry |  |  | pass |
| V-16 | STEP length unit detected | mm | mm |  | equal | pass |
| V-16 | Radiating front face, from εσ(T⁴ − T∞⁴) = q | 297 °C | 297 °C (4941 vertices) | +0.00 % | 0.01 % | pass |
| V-16 | Heated back face, front + qL/k | 623.39 °F | 623.39 °F (4941 vertices) | +0.00 % | 0.01 % | pass |
| V-16 | Heat flux at the radiating face, q | 1500 BTU/(h·ft²) | 1500 BTU/(h·ft²) (4941 vertices) | -0.00 % | 0.01 % | pass |
| V-16 | Heat in from the heater, q A | 30.284 W | 30.284 W (load heater) | +0.00 % | 0.01 % | pass |
| V-16 | Heat radiated to the room, − q A | -103.33 BTU/h | -103.33 BTU/h (load room) | +0.00 % | 0.01 % | pass |
| V-16 | Heat flux and generation bring in what the setup gives | 30.284 W | 30.284 W | 0.0000 % of 30.284 W | 0.1 % | pass |
| V-16 | The run's heat balance closes | heat in 30.284 W | heat out 30.284 W | 0.0000 % of 30.284 W | 0.1 % | pass |
| V-16 | Solver log has no unexpected warnings | none | none |  |  | pass |
| V-16 | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 5 s, charged True, 1 entry |  |  | pass |
| V-17 | STEP length unit detected | mm | mm |  | equal | pass |
| V-17 | Centre, T0 + q‴L²/2k (L the half-thickness) | 183.33 °C | 183.33 °C (2 vertices) | -0.00 % | 0.01 % | pass |
| V-17 | A quarter of the way through | 150 °C | 150 °C (2 vertices) | -0.00 % | 0.01 % | pass |
| V-17 | Three quarters of the way through | 302 °F | 302 °F (2 vertices) | -0.00 % | 0.01 % | pass |
| V-17 | Faces held at 50 °C | 122 °F | 122 °F (2821 vertices) | -0.00 % | 0.01 % | pass |
| V-17 | Heat flux at the left face, − q‴ L | -200 kW/m² | -200 kW/m² (2821 vertices) | -0.00 % | 0.01 % | pass |
| V-17 | Heat flux a quarter of the way through, − q‴ L / 2 | -100 kW/m² | -99.999 kW/m² (2 vertices) | -0.00 % | 0.01 % | pass |
| V-17 | Heat out through the cooled faces, − q‴ V | -1.44 kW | -1.44 kW (load faces) | +0.00 % | 0.01 % | pass |
| V-17 | Heat flux and generation bring in what the setup gives | 1440 W | 1440 W | 0.0000 % of 1440 W | 0.1 % | pass |
| V-17 | The run's heat balance closes | heat in 1440 W | heat out 1440 W | 0.0000 % of 1440 W | 0.1 % | pass |
| V-17 | Solver log has no unexpected warnings | none | none |  |  | pass |
| V-17 | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 10 s, charged True, 1 entry |  |  | pass |
| V-18 | STEP length unit detected | mm | mm |  | equal | pass |
| V-18 | Hoop stress at the bore, σθ(a) | -233.22 MPa | -233.12 MPa (17 vertices) | -0.04 % | 1 % | pass |
| V-18 | Hoop stress at the outside, σθ(b) | 178.21 MPa | 178.28 MPa (17 vertices) | +0.04 % | 1 % | pass |
| V-18 | Axial stress at the bore, σz(a) | -381.97 MPa | -382 MPa (1113 vertices) | +0.01 % | 1 % | pass |
| V-18 | Axial stress at the outside, σz(b) | 29.463 MPa | 29.508 MPa (1569 vertices) | +0.15 % | 1 % | pass |
| V-18 | von Mises stress at the bore | 333.48 MPa | 332.85 MPa (1113 vertices) | -0.19 % | 1 % | pass |
| V-18 | von Mises stress at the outside | 165.46 MPa | 165.62 MPa (1569 vertices) | +0.10 % | 1 % | pass |
| V-18 | Radial displacement of the bore | 0.038674 mm | 0.038675 mm (1113 vertices) | +0.00 % | 0.5 % | pass |
| V-18 | Radial displacement of the outside | 0.058012 mm | 0.058012 mm (1569 vertices) | -0.00 % | 0.5 % | pass |
| V-18 | Axial force on the end z = 0, Eα 2π Ib / 4 | 2.3365e+05 N | 2.3365e+05 N (support end-0) | +0.00 % | 0.5 % | pass |
| V-18 | Heat in through the bore, (π/2) k L ΔT / ln(b/a) | 418.39 W | 418.39 W (load bore) | +0.00 % | 0.5 % | pass |
| V-18 | The run's heat balance closes | heat in 418.39 W | heat out 418.39 W | 0.0000 % of 418.46 W | 0.1 % | pass |
| V-18 | Reactions balance the applied load | applied 0, 0, 0 N | reactions 2.1358e-05, -0.00051428, 0.00031016 N | 0.0000 % of 5.5821e+05 N | 0.1 % | pass |
| V-18 | The run's balance check closes | force and moment | force 1.1e-07 %, moment 8.2e-08 % | 0.0000 % | 0.1 % | pass |
| V-18 | Solver log has no unexpected warnings | none | none |  |  | pass |
| V-18 | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 6 s, charged True, 1 entry |  |  | pass |
| V-19 | STEP length unit detected | mm | mm |  | equal | pass |
| V-19 | Heat flux, k at the mean temperature times ΔT / L | 421.8 kW/m² | 421.8 kW/m² (693 vertices) | -0.00 % | 0.1 % | pass |
| V-19 | Heat in through the hot face, q A | 168.72 W | 168.72 W (load hot) | -0.00 % | 0.1 % | pass |
| V-19 | Heat out through the cold face, − q A | -168.72 W | -168.72 W (load cold) | -0.00 % | 0.1 % | pass |
| V-19 | A quarter of the way through | 291.75 °C | 291.75 °C (8 vertices) | -0.00 % | 0.1 % | pass |
| V-19 | Halfway through, 16 K below the mean of the faces | 193.86 °C | 193.86 °C (10 vertices) | -0.00 % | 0.1 % | pass |
| V-19 | Three quarters of the way through | 103.82 °C | 103.82 °C (9 vertices) | -0.00 % | 0.1 % | pass |
| V-19 | Sideways stress at the hot face, − E ε / (1 − ν) at 400 °C | -1182.2 MPa | -1182.1 MPa (357 vertices) | -0.01 % | 0.5 % | pass |
| V-19 | Sideways stress halfway through | -481.18 MPa | -481.1 MPa (10 vertices) | -0.02 % | 0.5 % | pass |
| V-19 | Sideways stress three quarters of the way through | -177.41 MPa | -177.37 MPa (9 vertices) | -0.02 % | 0.5 % | pass |
| V-19 | Sideways stress at the cold face, below the stress-free temperature | 98.451 MPa | 98.487 MPa (357 vertices) | +0.04 % | 0.5 % | pass |
| V-19 | von Mises stress at the hot face, |σ| with σxx = 0 | 1182.2 MPa | 1182 MPa (357 vertices) | -0.02 % | 0.5 % | pass |
| V-19 | Growth of the hot face, − ∫ ε (1 + ν) / (1 − ν) dx | -0.14525 mm | -0.14525 mm (357 vertices) | -0.00 % | 0.1 % | pass |
| V-19 | Force on the wall y = 0, − H ∫ σ dx | 4.0199e+05 N | 4.0199e+05 N (support wall-y0) | +0.00 % | 0.1 % | pass |
| V-19 | The run's heat balance closes | heat in 168.72 W | heat out 168.72 W | 0.0000 % of 168.72 W | 0.1 % | pass |
| V-19 | Reactions balance the applied load | applied 0, 0, 0 N | reactions 4.266e-07, 0.0043845, 0.00032031 N | 0.0000 % of 1.6375e+06 N | 0.1 % | pass |
| V-19 | The run's balance check closes | force and moment | force 2.7e-07 %, moment 7e-08 % | 0.0000 % | 0.1 % | pass |
| V-19 | Solver log has no unexpected warnings | none | none |  |  | pass |
| V-19 | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 3 s, charged True, 1 entry |  |  | pass |
| V-20 | STEP length unit detected | mm | mm |  | equal | pass |
| V-20 | First bending mode in z, βL = 1.8751 | 10.192 Hz | 10.202 Hz (mode 1) | +0.0920 % | 0.3 % | pass |
| V-20 | First bending mode in y, βL = 1.8751 | 20.385 Hz | 20.391 Hz (mode 2) | +0.0342 % | 0.3 % | pass |
| V-20 | Second bending mode in z, βL = 4.6941 | 3832.4 cpm | 3834.2 cpm (mode 3) | +0.0458 % | 0.3 % | pass |
| V-20 | Second bending mode in y, βL = 4.6941 | 127.75 Hz | 127.55 Hz (mode 4) | -0.1519 % | 0.3 % | pass |
| V-20 | Third bending mode in z, βL = 7.8548 | 178.85 Hz | 178.8 Hz (mode 5) | -0.0268 % | 0.3 % | pass |
| V-20 | First bending mode in z, shape at mid-span | 0.33952 1 | 0.33939 1 (81 vertices) | -0.04 % | 0.3 % | pass |
| V-20 | First bending mode in y, shape at mid-span | 0.33952 1 | 0.33943 1 (37 vertices) | -0.03 % | 0.3 % | pass |
| V-20 | Second bending mode in z, shape at mid-span | -0.71367 1 | -0.71356 1 (81 vertices) | -0.01 % | 0.3 % | pass |
| V-20 | Modes found | 5 | 5 |  | equal | pass |
| V-20 | Solver log has no unexpected warnings | none | none |  |  | pass |
| V-20 | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 11 s, charged True, 1 entry |  |  | pass |
| V-21 | STEP length unit detected | mm | mm |  | equal | pass |
| V-21 | First bending mode in z, βL = 4.7300 | 3891.4 cpm | 3896.5 cpm (mode 1) | +0.1314 % | 0.3 % | pass |
| V-21 | First bending mode in y, βL = 4.7300 | 129.71 Hz | 129.53 Hz (mode 2) | -0.1395 % | 0.3 % | pass |
| V-21 | Second bending mode in z, βL = 7.8532 | 178.78 Hz | 178.86 Hz (mode 3) | +0.0440 % | 0.3 % | pass |
| V-21 | Modes found | 3 | 3 |  | equal | pass |
| V-21 | Solver log has no unexpected warnings | none | none |  |  | pass |
| V-21 | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 8 s, charged True, 1 entry |  |  | pass |
| V-22 | STEP length unit detected | mm | mm |  | equal | pass |
| V-22 | Rigid-body mode 1 near zero | 0 Hz | -0.0013181 Hz (mode 1) | -0.0020 % of mode 7 | 0.1 % of mode 7 | pass |
| V-22 | Rigid-body mode 2 near zero | 0 Hz | -0.0009431 Hz (mode 2) | -0.0015 % of mode 7 | 0.1 % of mode 7 | pass |
| V-22 | Rigid-body mode 3 near zero | 0 Hz | 0.0014839 Hz (mode 3) | +0.0023 % of mode 7 | 0.1 % of mode 7 | pass |
| V-22 | Rigid-body mode 4 near zero | 0 Hz | 0.0017498 Hz (mode 4) | +0.0027 % of mode 7 | 0.1 % of mode 7 | pass |
| V-22 | Rigid-body mode 5 near zero | 0 Hz | 0.0022347 Hz (mode 5) | +0.0034 % of mode 7 | 0.1 % of mode 7 | pass |
| V-22 | Rigid-body mode 6 near zero | 0 Hz | 0.0030132 Hz (mode 6) | +0.0046 % of mode 7 | 0.1 % of mode 7 | pass |
| V-22 | First elastic mode, free-free bending in z, βL = 4.7300 | 64.856 Hz | 64.833 Hz (mode 7) | -0.0350 % | 0.3 % | pass |
| V-22 | Second elastic mode, free-free bending in y, βL = 4.7300 | 0.12971 kHz | 0.12953 kHz (mode 8) | -0.1435 % | 0.3 % | pass |
| V-22 | Modes found | 8 | 8 |  | equal | pass |
| V-22 | Solver log has no unexpected warnings | none | none |  |  | pass |
| V-22 | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 57 s, charged True, 1 entry |  |  | pass |
| V-24 | STEP length unit detected | in | in |  | equal | pass |
| V-24 | von Mises stress at the end (E ε) | 14.5 ksi | 14.5 ksi (265 vertices) | -0.00 % | 0.1 % | pass |
| V-24 | von Mises stress along the side | 14.5 ksi | 14.5 ksi (1741 vertices) | -0.00 % | 0.1 % | pass |
| V-24 | End moved by the prescribed 0.0508 mm | 0.002 in | 0.002 in (265 vertices) | +0.00 % | 0.1 % | pass |
| V-24 | Side contracts in y (−ν ε y) | -7.25e-05 in | -7.25e-05 in (1741 vertices) | -0.00 % | 0.1 % | pass |
| V-24 | Side contracts in z (−ν ε z) | -7.25e-05 in | -7.25e-05 in (1741 vertices) | -0.00 % | 0.1 % | pass |
| V-24 | Force needed at the end (σ A) | 3.625 kip | 3.625 kip (support end) | +0.00 % | 0.1 % | pass |
| V-24 | Force at the start | -3.625 kip | -3.625 kip (support start) | -0.00 % | 0.1 % | pass |
| V-24 | Normal stress σxx along the side (E ε) | 14.5 ksi | 14.5 ksi (1741 vertices) | -0.00 % | 0.1 % | pass |
| V-24 | Largest principal stress along the side is σxx | 14.5 ksi | 14.5 ksi (1741 vertices) | -0.00 % | 0.1 % | pass |
| V-24 | Axial strain along the side (δ / L) | 500 µε | 500 µε (1741 vertices) | -0.00 % | 0.1 % | pass |
| V-24 | Lateral strain along the side (−ν ε) | -0.000145 in/in | -0.000145 in/in (1741 vertices) | -0.00 % | 0.1 % | pass |
| V-24 | Safety factor against yield along the side (Sy / σvm) | 2.4828 1 | 2.4828 1 (1741 vertices) | -0.00 % | 0.1 % | pass |
| V-24 | Reactions balance the applied load | applied 0, 0, 0 N | reactions 0.00016, -1.973e-10, 1.1889e-10 N | 0.0000 % of 32250 N | 0.1 % | pass |
| V-24 | The run's balance check closes | force and moment | force 5e-07 %, moment 3.9e-08 % | 0.0000 % | 0.1 % | pass |
| V-24 | Solver log has no unexpected warnings | none | none |  |  | pass |
| V-24 | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 4 s, charged True, 1 entry |  |  | pass |
| V-25 | STEP length unit detected | mm | mm |  | equal | pass |
| V-25 | von Mises stress at the bore | 26.057 MPa | 25.967 MPa (1307 vertices) | -0.35 % | 1 % | pass |
| V-25 | von Mises stress at the outside | 12.35 MPa | 12.33 MPa (1879 vertices) | -0.16 % | 1 % | pass |
| V-25 | Radial displacement of the bore | 0.0045152 mm | 0.0045151 mm (1307 vertices) | -0.00 % | 0.5 % | pass |
| V-25 | Radial displacement of the outside | 0.0035688 mm | 0.0035687 mm (1879 vertices) | -0.00 % | 0.5 % | pass |
| V-25 | Foundation's push on the outside, x | -3.9188 kN | -3.9193 kN (support sleeve) | +0.01 % | 0.5 % | pass |
| V-25 | Foundation's push on the outside, y | -14.625 kN | -14.627 kN (support sleeve) | +0.01 % | 0.5 % | pass |
| V-25 | Hoop force on the 30° plane, y | -25.369 kN | -25.368 kN (support cut-30) | -0.01 % | 0.5 % | pass |
| V-25 | Hoop force on the 120° plane, x | -25.369 kN | -25.368 kN (support cut-120) | -0.01 % | 0.5 % | pass |
| V-25 | Reactions balance the applied load | applied 14641, 54641, 1.9984e-15 N | reactions -14641, -54641, 2.8309e-08 N | 0.0000 % of 62825 N | 0.1 % | pass |
| V-25 | The run's balance check closes | force and moment | force 1.5e-07 %, moment 8.1e-08 % | 0.0000 % | 0.1 % | pass |
| V-25 | Solver log has no unexpected warnings | none | none |  |  | pass |
| V-25 | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 3 s, charged True, 1 entry |  |  | pass |
| V-26 | STEP length unit detected | mm | mm |  | equal | pass |
| V-26 | Uniform axial stress F / A (von Mises) | 44.482 MPa | 44.482 MPa (710 vertices) | +0.00 % | 0.1 % | pass |
| V-26 | End moves by F L / (E A) | 0.00508 in | 0.00508 in (45 vertices) | +0.00 % | 0.1 % | pass |
| V-26 | Side contracts in y (−ν ε y) | -0.002129 mm | -0.002129 mm (710 vertices) | +0.00 % | 0.1 % | pass |
| V-26 | Side contracts in z (−ν ε z) | -0.002129 mm | -0.002129 mm (709 vertices) | +0.00 % | 0.1 % | pass |
| V-26 | The start holds the pull | -1000 lbf | -1000 lbf (support start) | +0.00 % | 0.1 % | pass |
| V-26 | Reactions balance the applied load | applied 4448.2, 0, 0 N | reactions -4448.2, -9.3315e-11, -1.2631e-10 N | 0.0000 % of 4448.2 N | 0.1 % | pass |
| V-26 | The run's balance check closes | force and moment | force 2.4e-06 %, moment 1.3e-07 % | 0.0000 % | 0.1 % | pass |
| V-26 | Solver log has no unexpected warnings | none | none |  |  | pass |
| V-26 | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 1 s, charged True, 1 entry |  |  | pass |
| V-27 | STEP length unit detected | mm | mm |  | equal | pass |
| V-27 | Inner layer halfway through, r = 45 mm | 178.74 °C | 178.74 °C (1 vertices) | -0.00 % | 0.1 % | pass |
| V-27 | Bond, inner layer's side, r = 50 mm | 432.87 K | 432.87 K (1 vertices) | +0.00 % | 0.1 % | pass |
| V-27 | Bond, outer layer's side, r = 50 mm | 319.49 °F | 319.5 °F (1 vertices) | +0.00 % | 0.1 % | pass |
| V-27 | Outer layer, r = 54 mm | 113.4 °C | 113.4 °C (1 vertices) | -0.00 % | 0.1 % | pass |
| V-27 | Radial heat flux in the inner layer, r = 45 mm, Q / ((π/2) r L) | 2.0059e+05 W/m² | 2.0056e+05 W/m² (1 vertices) | -0.01 % | 1 % | pass |
| V-27 | Radial heat flux in the outer layer, r = 54 mm | 1.6716e+05 W/m² | 1.6716e+05 W/m² (1 vertices) | -0.00 % | 1 % | pass |
| V-27 | Heat in through the bore, (π/2) L ΔT / (ln(r1/a)/k1 + ln(b/r1)/k2) | 283.58 W | 283.57 W (load bore) | -0.00 % | 0.2 % | pass |
| V-27 | Heat out through the outside, all of it across the bond | -967.61 BTU/h | -967.59 BTU/h (load outside) | -0.00 % | 0.2 % | pass |
| V-27 | The run's heat balance closes | heat in 283.57 W | heat out 283.57 W | 0.0000 % of 283.61 W | 0.1 % | pass |
| V-27 | Solver log has no unexpected warnings | none | none |  |  | pass |
| V-27 | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 30 s, charged True, 1 entry |  |  | pass |
| Ledger | Every running balance is the previous one plus the entry | 53 entries chained | 53 entries chained |  | exact | pass |
| Ledger | Wallet balance equals the sum of the ledger | 99.930272 credits | 99.930272 credits |  | exact | pass |
| Ledger | Each job charge is its billed seconds at its rate | 52 jobs, 0.069728 credits | 0.069728 credits |  | exact | pass |
| Ledger | Each charged run has one entry for exactly its recorded cost | 26 runs, 0.055834 credits | 26 runs matched |  | exact | pass |
| Ledger | No entry without a job other than the grant | none | none |  | exact | pass |

- V-01 Thick cylinder, internal pressure: mesh 5 mm, 71783 elements, 114238 nodes; 46 s; solve estimated 122 s, billed 36 s; clearfea 0.0.0+8a665bf, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1
- V-02 Cantilever, end load: mesh 2.5 mm, 50985 elements, 78396 nodes; 30 s; solve estimated 64 s, billed 23 s; clearfea 0.0.0+8a665bf, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1
- V-03 Plate with central hole in tension: mesh 2.5 mm, 0.25 mm local, 14665 elements, 27880 nodes; 11 s; solve estimated 12 s, billed 5 s; clearfea 0.0.0+8a665bf, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1
- V-04 Remote force and moment on a stub: mesh 2 mm, 82285 elements, 120919 nodes; 61 s; solve estimated 135 s, billed 51 s; clearfea 0.0.0+8a665bf, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1
- V-05 Tank wall, hydrostatic pressure: mesh 5 mm, 38946 elements, 63582 nodes; 29 s; solve estimated 45 s, billed 21 s; clearfea 0.0.0+8a665bf, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1
- V-06 Thin rotating ring: mesh 1.25 mm, 19424 elements, 33316 nodes; 15 s; solve estimated 15 s, billed 8 s; clearfea 0.0.0+8a665bf, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1
- V-07 Block on an elastic support: mesh 5 mm, 9440 elements, 14988 nodes; 9 s; solve estimated 5 s, billed 4 s; clearfea 0.0.0+8a665bf, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1
- V-08 Bar with ends restrained, uniform temperature rise: mesh 2.5 mm, 13496 elements, 23121 nodes; 10 s; solve estimated 9 s, billed 4 s; clearfea 0.0.0+8a665bf, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1
- V-09 Symmetry model against full model (quarter tube): mesh 5 mm, 6409 elements, 10853 nodes; 9 s; solve estimated 4 s, billed 2 s; clearfea 0.0.0+8a665bf, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1
- V-10 Column under self-weight: mesh 12.7 mm, 25896 elements, 41153 nodes; 18 s; solve estimated 22 s, billed 11 s; clearfea 0.0.0+8a665bf, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1
- V-11 Two bonded blocks against one block (cantilever): mesh 2.5 mm, 1.75 mm local, 80414 elements, 121470 nodes; 57 s; solve estimated 136 s, billed 48 s; clearfea 0.0.0+8a665bf, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1
- V-12 Bi-material bar in tension: mesh 2.5 mm, 1.5 mm local, 12527 elements, 21389 nodes; 10 s; solve estimated 8 s, billed 5 s; clearfea 0.0.0+8a665bf, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1
- V-13 Plane wall conduction: mesh 2.5 mm, 42818 elements, 63020 nodes; 14 s; solve estimated 44 s, billed 7 s; clearfea 0.0.0+8a665bf, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1
- V-14 Cylinder wall conduction: mesh 2.5 mm, 10203 elements, 16454 nodes; 8 s; solve estimated 6 s, billed 2 s; clearfea 0.0.0+8a665bf, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1
- V-15 Wall with convection on both sides: mesh 2.5 mm, 42818 elements, 63020 nodes; 14 s; solve estimated 44 s, billed 7 s; clearfea 0.0.0+8a665bf, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1
- V-16 Heated plate radiating to ambient: mesh 2.5 mm, 19913 elements, 32662 nodes; 11 s; solve estimated 15 s, billed 5 s; clearfea 0.0.0+8a665bf, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1
- V-17 Slab with internal heat generation: mesh 2.5 mm, 42818 elements, 63020 nodes; 17 s; solve estimated 44 s, billed 10 s; clearfea 0.0.0+8a665bf, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1
- V-18 Thick cylinder thermal stress: mesh 2.5 mm, 10203 elements, 16454 nodes; 12 s; solve estimated 6 s, billed 6 s; clearfea 0.0.0+8a665bf, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1
- V-19 Wall with temperature-dependent properties: mesh 2.5 mm, 5252 elements, 8618 nodes; 8 s; solve estimated 3 s, billed 3 s; clearfea 0.0.0+8a665bf, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1
- V-20 Cantilever beam frequencies: mesh 3 mm, 19577 elements, 36937 nodes; 17 s; solve estimated 78 s, billed 11 s; clearfea 0.0.0+8a665bf, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1
- V-21 Fixed-fixed beam frequencies: mesh 3 mm, 19577 elements, 36937 nodes; 15 s; solve estimated 68 s, billed 8 s; clearfea 0.0.0+8a665bf, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1
- V-22 Unrestrained body: mesh 2 mm, 66677 elements, 113748 nodes; 67 s; solve estimated 693 s, billed 57 s; clearfea 0.0.0+8a665bf, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1
- V-24 Bar stretched by a prescribed displacement: mesh 2 mm, 10682 elements, 17747 nodes; 9 s; solve estimated 6 s, billed 4 s; clearfea 0.0.0+8a665bf, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1
- V-25 Tube in an elastic sleeve (curved elastic support): mesh 5 mm, 6409 elements, 10853 nodes; 9 s; solve estimated 4 s, billed 3 s; clearfea 0.0.0+8a665bf, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1
- V-26 Bar in tension with first-order elements: mesh 2 mm, first order, 12839 elements, 3408 nodes; 7 s; solve estimated 2 s, billed 1 s; clearfea 0.0.0+8a665bf, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1
- V-27 Two-layer tube wall conduction: mesh 2.5 mm, 1 mm local, 85994 elements, 129217 nodes; 40 s; solve estimated 151 s, billed 30 s; clearfea 0.0.0+8a665bf, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1

307 of 307 checks passed, 26 cases.
