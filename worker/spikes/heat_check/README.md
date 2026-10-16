# M5.1 heat check

Script only, not part of the worker package or its tests. It solves steady-state thermal decks written by the deck generator (`clearfea_worker/deck/`) with CalculiX and reads them back with the result reader (`clearfea_worker/results/`), so the choices only they make (the temperature degree of freedom, the offsets of °C and °F, the conductivity's unit, the `NDTEMP` block) are shown right by a solver at every node, not just by snapshots (ADR-064). Run it by hand after changes to the thermal deck or the temperature reader, beside `make verify`.

```
cd worker
uv run python spikes/heat_check/check.py --out /tmp/heat-check
```

It needs the Gmsh system libraries (see `worker/Dockerfile`) and `ccx` on the PATH, and takes a few seconds. Exit status is non-zero if any check fails.

The model is a 200 × 20 × 20 mm bar written as STEP in millimetres, imported and meshed by the worker's own code at 10 mm, once with 4-node and once with 10-node tetrahedra. The end x = 0 is held at 100 °C and the end x = 200 mm at 68 °F (293.15 K), the conductivity is 26 BTU/(h·ft·°F), and every other face is insulated. The exact temperature is linear in x, which both element orders represent exactly, so every node must be within 0.01 K of it (the `.frd` file keeps five significant digits), and the summary's highest and lowest temperatures must be the two fixed ones.
