# M2.2 support check (and M2.6 elastic support)

Script only, not part of the worker package or its tests. It solves bars held by the M2.2 supports with CalculiX through the solve job's own steps (deck generator, `run_calculix`, result reader) and compares every node with the closed-form answer, which the verification cases can only sample through the API (ADR-039). Run it by hand after changes to the support translation (`clearfea_worker/deck/constraints.py`, `deck/loads/`) or to how reactions are read.

```
cd worker
uv run python spikes/support_check/check.py --out /tmp/support-check
```

It needs the Gmsh system libraries and `ccx` on the PATH; exit status is non-zero if a check fails. The bar is 200 × 20 × 20 mm, 210 GPa, ν = 0.3, meshed at 5 mm with 4- and 10-node tetrahedra.

1. **Stretched.** Faces y = 0 and z = 0 on one frictionless support, the start held at x = 0 and the end moved by 0.01 cm, both by prescribed displacements with y and z free. Every node must show von Mises E·δ/L and the lateral displacements −ν ε y and −ν ε z (to the six digits of the `.frd` file); the end's reaction must be E·δ/L·A along +x and the start's the opposite, with nothing on the symmetry planes, though their edges share nodes with both ends.
2. **Turned.** The same bar turned 30° about z: its start face and one side lean, so their nodes need local axes (`*TRANSFORM`), and the base is the plane z = 0. A tension of 50 MPa on the far end. Every node must have the exact displacement field, the start's reaction must be the whole pull along the bar, and the leaning side and the base carry nothing. This is the check that found CalculiX's nodal force on a held node also contains the load applied there along the free directions (the pulled end's corners on the side plane), which the reader now leaves out.
3. **On a foundation** (M2.6). The turned bar with its leaning side y- on an elastic support of 1,000 N/mm³, the start and the base on frictionless planes, pressed into the foundation by 10 MPa on the side y+. Every node must have the exact field (the side settles by p/k and the bar shortens across by p·y/E, with lateral growth ν p/E), von Mises must equal the pressure at every node (which caught CalculiX counting `SPRINGA` elements in its nodal stress average), the elastic support's reaction must be p·A along the side's normal and the start and base carry nothing. Some nodes are held through `*TRANSFORM` and carry a spring as well.
4. **Refusals.** A single symmetry plane (the part can slide along y and z and turn about x), an elastic support alone on one face (it can slide and turn in the face's plane), a prescribed displacement with every component free, a fixed face next to a face moved along y, and a prescribed move along a frictionless face's normal are refused by the deck generator with a message naming what to change.

Result on 2026-10-15 (CalculiX 2.21, Gmsh 4.15.2): 33 of 33 checks pass (M2.6).
