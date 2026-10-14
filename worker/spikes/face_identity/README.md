# M1.1 spike: face identity chain

Script only, no UI, not part of the worker package or its tests. It proves the face identity chain in `docs/ARCHITECTURE.md` section 3 on three models and answers whether Gmsh reports a STEP file's length unit. Findings are ADR-023 in `docs/DECISIONS.md`; M1.2 and M1.6 turn the parts that worked into job code.

```
cd worker
uv run --with numpy==2.3.4 python spikes/face_identity/spike.py run --out /tmp/face-identity
```

It needs the Gmsh system libraries (`libglu1-mesa` and friends, see `worker/Dockerfile`) and takes about two minutes. numpy is pulled in for this run only; it is not a worker dependency yet. Exit status is non-zero if any check fails.

| File | Does |
| --- | --- |
| `models.py` | Builds the three models with Gmsh's OpenCASCADE kernel and writes them as STEP (millimetres), and rewrites the unit declaration to make metre and inch variants of the same coordinates |
| `step_units.py` | Reads the declared length unit from the STEP data section; names map to `units.json` symbols, and a conversion-based unit's own factor is cross-checked against the table |
| `spike.py` | Runs each step in its own process, as the jobs will, and checks it |

Models (original geometry, generated on each run, no STEP files in the repository):

- `block`: 100 × 50 × 20 mm, six planes.
- `flanged_pipe`: pipe OD 60, ID 50, length 200, two flanges OD 150 × 15 with six bolt holes each, 5 mm fillets at the pipe-to-flange joints (planes, cylinders, tori; 22 faces).
- `bracket`: L bracket with an 8 mm inside-corner fillet, two filleted outer corners, two holes in the base and one in the web (14 faces).

Each model runs three times: as written (mm) and with the same coordinates declared in metres and in inches.

## What each step checks

1. **import** (fresh process): detect the declared unit, import with `Geometry.OCCTargetUnit = "M"`, write `topology.json` (per face: tag, type, area, centroid, bounding box, parent body), tessellate every face with a curvature-sized surface mesh and write `display.bin` (float32 positions, uint32 indices, triangle ranges per face tag). The check reads `display.bin` back, as the viewer would.
2. **mesh** (fresh process, order 1 and order 2): re-import, compare every face's area, centroid, type and parent body with `topology.json`, mesh the volume with tetrahedra, then map each surface triangle to the tetrahedron face with the same corner nodes. Writes `face_map_p1.json` / `face_map_p2.json` (face tag → list of `[element tag, local face index]`).
3. **rescale** (inch variants only): the user says the file is really in mm. Compares re-importing with `Geometry.OCCScaling` against importing and then calling `occ.dilate`.

The geometric check (`check_faces`) is independent of how triangles were grouped: for each triangle centroid it projects onto every face of the model. A triangle passes if its own face contains the projection (inside the trimmed face, not only the underlying surface), the distance is within tolerance (1e-9 of the model size on planes, 1e-6 for the float32 display file, a quarter of the element's longest edge on curved faces for chord sag), and no other face contains a closer projection. It also sums triangle areas per face against the CAD area.

## Result (2026-10-14, Gmsh 4.15.2, OpenCASCADE 7.8, one thread)

Columns: `scale err` is the worst relative difference of face areas and centroids from the mm variant scaled by the units table factor; `reimport diff` the same between the import and mesh processes; `unmapped/orphan` counts surface triangles with no tetrahedron face and boundary tetrahedron faces with no face tag (order 1 + order 2); `off/wrong` counts triangles off their face and triangles closer to another face (display + p1 + p2); the area error is the discretisation error of the order 1 mesh against the CAD area (polygons standing in for circles).

| model           | declared                 | unit | scale err | faces | display tris | reimport diff | tets p1/p2  | mapped p1/p2 | unmapped/orphan | off/wrong | area err plane/curved (p1) | in→mm re-import / dilate |
| --------------- | ------------------------ | ---- | --------- | ----- | ------------ | ------------- | ----------- | ------------ | --------------- | --------- | -------------------------- | ------------------------ |
| block           | SI_UNIT(.MILLI.,.METRE.) | mm   | 0e+00     | 6     | 1220         | 0e+00         | 864/864     | 542/542      | 0/0             | 0/0       | 2.2e-16/0.0e+00            | -                        |
| block_m         | SI_UNIT($,.METRE.)       | m    | 2e-16     | 6     | 1224         | 0e+00         | 856/856     | 540/540      | 0/0             | 0/0       | 2.3e-16/0.0e+00            | -                        |
| block_in        | 'INCH'                   | in   | 2e-16     | 6     | 1236         | 0e+00         | 842/842     | 540/540      | 0/0             | 0/0       | 1.7e-16/0.0e+00            | 2e-16 / 2e-16 B-spline   |
| flanged_pipe    | SI_UNIT(.MILLI.,.METRE.) | mm   | 0e+00     | 22    | 16680        | 0e+00         | 18251/18251 | 9522/9522    | 0/0             | 0/0       | 1.9e-02/8.3e-03            | -                        |
| flanged_pipe_m  | SI_UNIT($,.METRE.)       | m    | 1e-15     | 22    | 16626        | 0e+00         | 18416/18416 | 9482/9482    | 0/0             | 0/0       | 1.9e-02/8.4e-03            | -                        |
| flanged_pipe_in | 'INCH'                   | in   | 5e-16     | 22    | 16594        | 0e+00         | 18215/18215 | 9466/9466    | 0/0             | 0/0       | 1.9e-02/8.3e-03            | 4e-16 / 3e-03 B-spline   |
| bracket         | SI_UNIT(.MILLI.,.METRE.) | mm   | 0e+00     | 14    | 3988         | 0e+00         | 4311/4311   | 2222/2222    | 0/0             | 0/0       | 2.7e-03/8.0e-03            | -                        |
| bracket_m       | SI_UNIT($,.METRE.)       | m    | 6e-16     | 14    | 3940         | 0e+00         | 4562/4562   | 2278/2278    | 0/0             | 0/0       | 2.7e-03/7.9e-03            | -                        |
| bracket_in      | 'INCH'                   | in   | 4e-16     | 14    | 3986         | 0e+00         | 4386/4386   | 2260/2260    | 0/0             | 0/0       | 2.7e-03/8.0e-03            | 5e-16 / 3e-03 B-spline   |

All checks passed.
