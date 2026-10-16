# Result fields file (`fields.bin`)

The solve job writes two files for the viewer next to a run's solver output (ARCHITECTURE.md section 7, results pipeline step 3; ADR-031):

- `surface.bin`: the outer surface of the run's mesh in the display mesh format (`display-mesh.md`). It holds every element face that mesh.bin lists under a face tag, oriented outwards. A 10-node element face is drawn as four triangles through its mid-edge nodes, so every surface node of the mesh is a vertex. Served by `GET /api/runs/:id/surface`.
- `fields.bin`: the result values at each vertex of that `surface.bin`, described here. Served by `GET /api/runs/:id/fields`.

Since M3.4 the solve job also writes `nodes.bin` in the same format with `vertexCount` equal to the mesh's node count: vertex v is node v of the run's `mesh.bin` (`volume-mesh.md`), interior nodes included, with the same fields in the same order. It is what a cut plane draws (ADR-053). `GET /api/runs/:id/nodes` serves it whole, and `GET /api/runs/:id/nodes?field=<name>` serves a file in this format holding that one field (the header's `fieldCount` is 1), read from storage by range, so the viewer downloads only the fields it draws. Runs solved before M3.4 have no `nodes.bin` and cannot be cut.

Writer and reader: `worker/clearfea_worker/results/surface.py`; the viewer's reader is `apps/web/src/viewer/resultFields.ts`. Both are tested against `fixtures/result-fields-three-vertices.bin`.

Version 1, little-endian, no padding:

| Part | Type | Count | Meaning |
| --- | --- | --- | --- |
| magic | 4 bytes | 1 | `CFRF` |
| version | uint32 | 1 | `1` |
| vertexCount | uint32 | 1 | equals the vertex count of the run's `surface.bin` |
| fieldCount | uint32 | 1 | |
| fields | 36 bytes | fieldCount | 16-byte ASCII `name`, 16-byte ASCII `kind`, uint32 `components`; names and kinds are padded with zero bytes |
| values | float32 | components × vertexCount per field | the fields' values one after the other, in table order; `values[v * components + c]` for vertex `v` |

`kind` is a quantity kind of `units.json`, and every value is in that kind's SI unit, so the viewer converts for display with the same table as everything else. Vertex `v` carries the value CalculiX wrote for the mesh node at that vertex (stress extrapolated to the nodes and averaged over the elements that share it), and derived fields are computed from those nodal values. float32 is enough for drawing; the run's summary keeps the extremes in float64.

Version 1 holds, in this order:

| name | kind | components | Meaning | Since |
| --- | --- | --- | --- | --- |
| `displacement` | `length` | 3 | x, y, z, in metres | M1.9 |
| `vonMises` | `pressure` | 1 | von Mises equivalent stress, in pascals | M1.9 |
| `stress` | `pressure` | 6 | stress components xx, yy, zz, xy, yz, zx (CalculiX's order), in pascals | M3.1 |
| `principalStress` | `pressure` | 3 | principal stresses σ1 ≥ σ2 ≥ σ3, the eigenvalues of the nodal stress tensor, in pascals | M3.1 |
| `strain` | `strain` | 6 | total strain (elastic plus thermal) xx, yy, zz, xy, yz, zx, in m/m; the shear components are tensor components, half the engineering shear strain γ | M3.1 |
| `safetyFactor` | `ratio` | 1 | safety factor against yield: the yield strength of the node's material over its von Mises stress, at most 15 (15 where there is no stress); only when every material of the setup has a yield strength (ADR-054) | M3.5 |
| `temperature` | `temperature` | 1 | nodal temperature, absolute, in kelvin; a field of a steady-state thermal and a thermal stress run (ADR-064, ADR-067) | M5.1 |
| `heatFlux` | `heatFlux` | 3 | heat flux q = −k grad T, x, y, z, in W/m², extrapolated to the nodes and averaged by CalculiX like the stress; a field of a steady-state thermal and a thermal stress run (ADR-066, ADR-067) | M5.3 |
| `mode1`, `mode2`, … | `ratio` | 3 | a modal run's shape of each mode, mode 1 first, one field per mode: x, y, z displacement scaled so the largest over the mesh is 1, and signed so the largest component of the node that moves most is positive (ADR-071) | M6.2 |

A modal run (M6.2) has its `mode<N>` fields only, one per mode it found; one solved under M6.1 has none. A steady-state thermal run (M5.1) has `temperature` and, since M5.3, `heatFlux`, and none of the structural fields. A thermal stress run (M5.4) has the structural fields, then `temperature` and `heatFlux` (ADR-067). Runs solved before M3.1 have only `displacement` and `vonMises`; the viewer says so when asked for another quantity (ADR-050).

Readers find fields by name, so a later version may add fields (principal stresses, temperature) to the table without changing the layout. A change to the layout bumps the version, and readers refuse versions they do not know.
