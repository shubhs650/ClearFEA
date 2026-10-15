# M1.8 solve check

Script only, not part of the worker package or its tests. It runs the solve job's own steps (deck generator, `run_calculix`, the result reader in `clearfea_worker/results/`) on a meshed bar and compares the figures the reader produces with closed-form answers, so that what only the reader decides (which values of the `.frd` and `.dat` files become displacement, stress and reaction, their order and sign, the von Mises formula and where extremes are reported) is shown right by a solver. It stands in until V-01, V-02 and `make verify` arrive in M1.13 (ADR-030).

```
cd worker
uv run python spikes/solve_check/check.py --out /tmp/solve-check
```

It reuses the bar of `spikes/deck_check/` (200 × 20 × 20 mm in millimetres, 10-node tetrahedra at 5 mm, 10 bar and 210,000 MPa) and needs the Gmsh system libraries and `ccx` on the PATH. Exit status is non-zero if any check fails.

1. **Compression, Poisson's ratio 0.** The exact answer is a uniform stress −p: σxx = −p at every node, the other components zero, von Mises p everywhere, the free end moving −p·L/E, and a support reaction of +p·A along x. Tolerance 1e-4 (the `.frd` file holds six significant digits).
2. **Compression, Poisson's ratio 0.3.** The clamp restrains the lateral expansion near the fixed end, so the largest von Mises stress must be reported there, while σxx and von Mises at mid-length are p within 0.5 percent.
3. **Cantilever under pressure on the top face.** The free end deflects towards −y by about the Timoshenko beam value (within 3 percent; a coarse solid model with a clamp, so this checks direction and size, not accuracy). The reaction is checked exactly against the applied load less the part on nodes the clamp holds, which CalculiX leaves out of its total (ADR-029).
