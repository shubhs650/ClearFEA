# M2.2 support check

Script only, not part of the worker package or its tests. It solves bars held by the M2.2 supports with CalculiX through the solve job's own steps (deck generator, `run_calculix`, result reader) and compares every node with the closed-form answer, which the verification cases can only sample through the API (ADR-039). Run it by hand after changes to the support translation (`clearfea_worker/deck/constraints.py`, `deck/loads/`) or to how reactions are read.

```
cd worker
uv run python spikes/support_check/check.py --out /tmp/support-check
```

It needs the Gmsh system libraries and `ccx` on the PATH; exit status is non-zero if a check fails. The bar is 200 × 20 × 20 mm, 210 GPa, ν = 0.3, meshed at 5 mm with 4- and 10-node tetrahedra.

1. **Stretched.** Faces y = 0 and z = 0 on one frictionless support, the start held at x = 0 and the end moved by 0.01 cm, both by prescribed displacements with y and z free. Every node must show von Mises E·δ/L and the lateral displacements −ν ε y and −ν ε z (to the six digits of the `.frd` file); the end's reaction must be E·δ/L·A along +x and the start's the opposite, with nothing on the symmetry planes, though their edges share nodes with both ends.
2. **Turned.** The same bar turned 30° about z: its start face and one side lean, so their nodes need local axes (`*TRANSFORM`), and the base is the plane z = 0. A tension of 50 MPa on the far end. Every node must have the exact displacement field, the start's reaction must be the whole pull along the bar, and the leaning side and the base carry nothing. This is the check that found CalculiX's nodal force on a held node also contains the load applied there along the free directions (the pulled end's corners on the side plane), which the reader now leaves out.
3. **Refusals.** A single symmetry plane (the part can slide along y and z and turn about x), a prescribed displacement with every component free, a fixed face next to a face moved along y, and a prescribed move along a frictionless face's normal are refused by the deck generator with a message naming what to change.

Result on 2026-10-15 (CalculiX 2.21, Gmsh 4.15.2): 24 of 24 checks pass.
