Tier: full

| Case | Check | Reference | ClearFEA | Error | Tolerance | Result |
| --- | --- | --- | --- | --- | --- | --- |
| A | STEP length unit detected | mm | mm |  | equal | pass |
| A | Membrane von Mises at the shell outside, under the shell, 450 mm past the nozzle | 51.109 MPa | 50.199 MPa (134 vertices) | -1.78 % | 3 % | pass |
| A | Membrane hoop stress at the shell outside, under the shell, 450 mm past the nozzle | 59.016 MPa | 58.142 MPa (100 vertices) | -1.48 % | 3 % | pass |
| A | Membrane axial stress at the shell outside, under the shell, 450 mm past the nozzle | 29.508 MPa | 29.388 MPa (134 vertices) | -0.41 % | 3 % | pass |
| A | Membrane hoop stress at the shell inside, under the shell, 450 mm past the nozzle | 61.016 MPa | 61.409 MPa (99 vertices) | +0.64 % | 3 % | pass |
| A | Reaction at the held end, x | -569.49 kN | -569.49 kN (support held-end) | +0.00 % | 0.1 % | pass |
| A | Reaction at the held end, y | 3 kN | 3 kN (support held-end) | -0.00 % | 0.1 % | pass |
| A | Reaction at the held end, z | 6 kN | 5.9999 kN (support held-end) | -0.00 % | 0.1 % | pass |
| A | Reaction moment at the held end about its centre, x | -3.68 kN·m | -3.68 kN·m (support held-end) | +0.00 % | 0.1 % | pass |
| A | Reaction moment at the held end about its centre, y | -8.84 kN·m | -8.8399 kN·m (support held-end) | -0.00 % | 0.1 % | pass |
| A | Reaction moment at the held end about its centre, z | 0.3 kN·m | 0.3 kN·m (support held-end) | -0.00 % | 0.1 % | pass |
| A | Reactions balance the applied load | applied 5.6949e+05, -3000, -5963.6 N | reactions -5.6949e+05, 3000, 5999.9 N | 0.0007 % of 5.3464e+06 N | 0.1 % | pass |
| A | The run's balance check closes | force and moment | force 9.9e-08 %, moment 8.4e-09 % | 0.0000 % | 0.1 % | pass |
| A | Solver log has no unexpected warnings | none | none |  |  | pass |
| A | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 116 s, charged True, 1 entry |  |  | pass |
| B | STEP length unit detected | mm | mm |  | equal | pass |
| B | Bore temperature away from the flange | 233.86 °C | 233.86 °C (1110 vertices) | -0.00 % | 0.2 % | pass |
| B | Outside temperature away from the flange | 153.03 °C | 153.02 °C (1647 vertices) | -0.00 % | 0.2 % | pass |
| B | Bore hoop stress away from the flange | -164.51 MPa | -163.24 MPa (40 vertices) | -0.77 % | 3 % | pass |
| B | Bore axial stress away from the flange | -164.36 MPa | -163.08 MPa (1269 vertices) | -0.78 % | 3 % | pass |
| B | Bore von Mises stress away from the flange | 164.43 MPa | 162.6 MPa (1269 vertices) | -1.12 % | 3 % | pass |
| B | Outside hoop stress away from the flange | 123.87 MPa | 124.05 MPa (40 vertices) | +0.15 % | 3 % | pass |
| B | Outside axial stress away from the flange | 123.76 MPa | 122.68 MPa (1863 vertices) | -0.88 % | 3 % | pass |
| B | Outside von Mises stress away from the flange | 123.82 MPa | 123.52 MPa (1863 vertices) | -0.24 % | 3 % | pass |
| B | The run's heat balance closes | heat in 6388.5 W | heat out 6388.5 W | 0.0000 % of 6388.5 W | 0.1 % | pass |
| B | Reactions balance the applied load | applied 0, 0, 0 N | reactions -0.016799, -0.00013126, -0.0060359 N | 0.0000 % of 4.6837e+06 N | 0.1 % | pass |
| B | The run's balance check closes | force and moment | force 3.8e-07 %, moment 1.6e-07 % | 0.0000 % | 0.1 % | pass |
| B | Solver log has no unexpected warnings | none | none |  |  | pass |
| B | Billable seconds recorded, one ledger entry | at least 1 s charged, 1 entry | 228 s, charged True, 1 entry |  |  | pass |
| Ledger | Every running balance is the previous one plus the entry | 5 entries chained | 5 entries chained |  | exact | pass |
| Ledger | Wallet balance equals the sum of the ledger | 99.863334 credits | 99.863334 credits |  | exact | pass |
| Ledger | Each job charge is its billed seconds at its rate | 4 jobs, 0.136666 credits | 0.136666 credits |  | exact | pass |
| Ledger | Each charged run has one entry for exactly its recorded cost | 2 runs, 0.127777 credits | 2 runs matched |  | exact | pass |
| Ledger | No entry without a job other than the grant | none | none |  | exact | pass |

- A Nozzle with reinforcing pad on a cylindrical shell: mesh 12 mm, 123317 elements, 248060 nodes; 147 s; solve estimated 472 s, billed 116 s; clearfea 0.0.0+1da1550, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1
- B Thermal stress in a thick-walled flanged pipe: mesh 6 mm, 119405 elements, 176853 nodes; 245 s; solve estimated 261 s, billed 228 s; clearfea 0.0.0+1da1550, deckFormat 5, calculix 2.21, gmsh 4.15.2, occt 7.8.1

34 of 34 checks passed, 2 cases.
