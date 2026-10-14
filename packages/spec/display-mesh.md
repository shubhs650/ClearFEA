# Display mesh file (`display.bin`)

The import job tessellates every face of the geometry and writes one binary file that the viewer renders and picks faces on (ARCHITECTURE.md section 3, step 3). It is a curvature-sized surface mesh, separate from the analysis mesh. Writer and reader: `worker/clearfea_worker/geometry/display.py`. Served by `GET /api/geometries/:id/display`.

Version 1, little-endian, no padding:

| Part | Type | Count | Meaning |
| --- | --- | --- | --- |
| magic | 4 bytes | 1 | `CFDM` |
| version | uint32 | 1 | `1` |
| vertexCount | uint32 | 1 | |
| triangleCount | uint32 | 1 | |
| faceCount | uint32 | 1 | |
| positions | float32 | 3 × vertexCount | x, y, z in metres |
| indices | uint32 | 3 × triangleCount | vertex indices into `positions` |
| faces | 5 × 4 bytes | faceCount | int32 `faceTag`, uint32 `firstVertex`, `vertexCount`, `firstTriangle`, `triangleCount` |

The header is 20 bytes, so `positions` starts at byte 20 and can be viewed directly as a `Float32Array`. Faces are stored in ascending tag order. Each face owns its run of vertices (vertices on a shared edge are repeated per face) and its run of triangles, whose indices point only into that face's vertices. A viewer can therefore shade each face smoothly and keep sharp edges between faces, and a picked triangle index resolves to its face tag through the `firstTriangle` ranges. Face tags are the ones in `topology.json`.

A change to this layout bumps the version, and readers refuse versions they do not know.
