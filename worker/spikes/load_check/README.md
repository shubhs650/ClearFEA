# M2.3 load check

Script only, not part of the worker package or its tests. It solves parts under the M2.3 loads with CalculiX through the solve job's own steps (deck generator, `run_calculix`, result reader) and compares them with closed-form answers and with equilibrium, which the verification cases can only sample through the API (ADR-040). Run it by hand after changes to the load translation (`clearfea_worker/deck/loads/`, `deck/applied.py`) or to how reactions are read.

```
cd worker
uv run python spikes/load_check/check.py --out /tmp/load-check
```

It needs the Gmsh system libraries and `ccx` on the PATH; exit status is non-zero if a check fails. Steel, 210 GPa, ν = 0.3, density 7.85 g/cm³, with 4- and 10-node tetrahedra.

1. **Pulled.** A quarter of a 200 × 20 × 20 mm bar on two symmetry planes, held along x at the start, with a force of 20 kN along x on the end face. The nodal loads must add up to the force exactly, every node must show von Mises F/A and the x displacement ε·x, the start's reaction must be −F and the symmetry planes, whose edges touch the loaded face, carry nothing.
2. **Column.** A 20 × 20 × 200 mm column on a fixed base under −1 g. The base reaction must be the weight ρgV (the weight of the base layer's nodes taken back out of CalculiX's RF), and the mid-height nodes must show ρgh/2 (to 0.1 percent with ten-node elements, 1 percent with four-node ones, whose stress is constant per element).
3. **Ring.** A quarter of a ring (radii 90 and 100 mm, 5 mm high) on symmetry planes x = 0, y = 0 and z = 0, spun at 10,000 rpm about z and weighed under −1 g, at 2.5 mm. The reactions must balance the loads to the solver's printed digits, each cut plane must carry ρω²t(b³ − a³)/3, the mid-plane the weight, and the outer face's nodes the plane stress disc's hoop stress and radial growth (1 percent; 3 percent with four-node elements). Then the same ring on a fixed bottom is pushed by a force of (−3, 1, 2) kN on its curved outer face, which touches the bottom: the reaction must be the force's opposite.
4. **Refusals.** Gravity without a density, two centrifugal loads, an axis direction of zero and a gravity component left empty are refused by the deck generator with a message naming what to change.

Result on 2026-10-15 (CalculiX 2.21, Gmsh 4.15.2): 34 of 34 checks pass.
