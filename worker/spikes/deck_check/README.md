# M1.7 deck check

Script only, not part of the worker package or its tests. It solves decks written by the deck generator (`clearfea_worker/deck/`) with CalculiX and compares them with closed-form answers, so that the choices only the generator makes (CalculiX node order, face numbers, the sign of a pressure, unit conversion) are shown right by a solver, not just by snapshots. It stands in until the verification cases V-01 and V-02 and `make verify` arrive in M1.13 (ADR-029).

```
cd worker
uv run python spikes/deck_check/check.py --out /tmp/deck-check
```

It needs the Gmsh system libraries (see `worker/Dockerfile`) and `ccx` on the PATH, and takes about 15 seconds. Exit status is non-zero if any check fails.

The model is a 200 × 20 × 20 mm bar written as STEP in millimetres, imported and meshed by the worker's own code at 5 mm, once with 4-node and once with 10-node tetrahedra. Inputs are in mixed units: 10 bar, 210,000 MPa, 5 mm.

1. **Local faces.** The bar's surface uses all four local faces of a tetrahedron, so every face number is exercised.
2. **Pressure on each face.** Each of the six faces in turn carries +10 bar and then −10 bar, with the opposite face fixed. A positive pressure pushes the face towards the body (ADR-026 item 4), so the support's total reaction must be +p·A·n, with n the loaded face's outward normal, and the opposite for suction. A face number mapped wrongly puts the load on another face of the element and turns the reaction.
3. **Stiffness.** The bar in compression with Poisson's ratio 0, so the fixed end restrains nothing and the exact answer is a uniform stress −p: every node of the loaded end must move by −p·L/E. A wrong mid-edge node order distorts C3D10 elements and fails this check (with Gmsh's own order CalculiX stops on a non-positive Jacobian).

Tolerances: reactions within 1e-6 of p·A, displacement within 1e-4 (the `.frd` file holds six significant digits).
