# Result fields file (`fields.bin`)

The solve job writes two files for the viewer next to a run's solver output (ARCHITECTURE.md section 7, results pipeline step 3; ADR-031):

- `surface.bin`: the outer surface of the run's mesh in the display mesh format (`display-mesh.md`). It holds every element face that mesh.bin lists under a face tag, oriented outwards. A 10-node element face is drawn as four triangles through its mid-edge nodes, so every surface node of the mesh is a vertex. Served by `GET /api/runs/:id/surface`.
- `fields.bin`: the result values at each vertex of that `surface.bin`, described here. Served by `GET /api/runs/:id/fields`.

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

Version 1 holds:

| name | kind | components | Meaning |
| --- | --- | --- | --- |
| `displacement` | `length` | 3 | x, y, z, in metres |
| `vonMises` | `pressure` | 1 | von Mises equivalent stress, in pascals |

Readers find fields by name, so a later version may add fields (principal stresses, temperature) to the table without changing the layout. A change to the layout bumps the version, and readers refuse versions they do not know.
