# M5.1 and M5.2 heat check

Script only, not part of the worker package or its tests. It solves steady-state thermal decks written by the deck generator (`clearfea_worker/deck/`) with CalculiX and reads them back with the result reader (`clearfea_worker/results/`), so the choices only they make (the temperature degree of freedom, the offsets of °C and °F, the conductivity's unit, the sign, unit and keyword of each thermal load, the `NDTEMP` block) are shown right by a solver at every node, not just by snapshots (ADR-064, ADR-065). Run it by hand after changes to the thermal deck or the temperature reader, beside `make verify`.

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
