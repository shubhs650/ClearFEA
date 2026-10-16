# M5.1 to M5.4 heat check

Script only, not part of the worker package or its tests. It solves steady-state thermal decks written by the deck generator (`clearfea_worker/deck/`) with CalculiX and reads them back with the result reader (`clearfea_worker/results/`), so the choices only they make (the temperature degree of freedom, the offsets of °C and °F, the conductivity's unit, the sign, unit and keyword of each thermal load, the `NDTEMP` block, and since M5.3 the `FLUX` block and the heat flows the reader works out) are shown right by a solver at every node, not just by snapshots (ADR-064, ADR-065, ADR-066, ADR-067). Run it by hand after changes to the thermal or thermal stress deck or the temperature reader, beside `make verify`.

```
cd worker
uv run python spikes/heat_check/check.py --out /tmp/heat-check
```

It needs the Gmsh system libraries (see `worker/Dockerfile`) and `ccx` on the PATH, and takes under a minute. Exit status is non-zero if any check fails.

The model is a 200 × 20 × 20 mm bar written as STEP in millimetres, imported and meshed by the worker's own code at 10 mm, once with 4-node and once with 10-node tetrahedra, with a conductivity of 26 BTU/(h·ft·°F). The side faces are insulated, so each load case is one-dimensional along the bar and has a closed form, which every node is compared with:

| Loads | Exact temperature | Allowed error |
| --- | --- | --- |
| 100 °C at x = 0, 68 °F at x = L | linear between them | 0.01 K |
| 100 °C at x = 0, 0.02 W/mm² into x = L | T₀ + q x / k | 0.01 K |
| 100 °C at x = 0, convection at x = L, 30 BTU/(h·ft²·°F) to 68 °F | linear to the end temperature where k (T₀ − T_L)/L = h (T_L − T∞) | 0.01 K |
| 20 kW/m² into x = 0, radiation from x = L, emissivity 0.8 to 68 °F; no fixed temperature | linear from the end temperature where q = εσ(T_L⁴ − T∞⁴) | 0.01 K |
| 100 °C at both ends, 3000 kW/m³ generated | T₀ + q‴ x (L − x) / 2k, a 333 K rise | 0.01 K (10-node); 2 K (4-node elements are linear in a quadratic profile) |

The linear profiles are represented exactly by both element orders, so what remains is the `.frd` file's five significant digits (0.01 K at 300 K).

Since M5.3 each case also checks the heat flux at every node against the exact one (largest error as a fraction of the largest exact flux: 0.001, except four-node elements with heat generation, 0.1, since their one gradient per element lags a flux that changes along the bar), each load's heat flow against the exact one (0.001 of the largest), and the run's heat balance (1e-5). A last case puts every thermal load on the bar at once (a fixed end, a flux into one side, convection from the opposite side, radiation from the far end and heat generation) and checks the heat balance alone, since it has no closed form.

Since M5.4 the first four cases are also solved as thermal stress analyses (ADR-067): steel (29,000 ksi, ν = 0.3, 6.5 µin/(in·°F)), stress-free at 122 °F, on frictionless supports at x = 0 and on the four sides. Each cross-section is then held flat and its sides cannot move, so σyy = σzz = −Eα(T − T₀)/(1 − ν), σxx = 0 and ux = α(1 + ν)/(1 − ν) ∫₀ˣ (T − T₀) dx, and every node is compared with these (largest error as a fraction of the largest exact value: normal stresses 0.001 with 10-node elements and 0.05 with 4-node ones, which have one strain each in a temperature that changes along the bar (2.6 % measured); shear stresses 0.001 and 0.02; displacements 0.001 and 0.005), along with the temperature as above and the reactions' balance (1e-6 of their gross size).
