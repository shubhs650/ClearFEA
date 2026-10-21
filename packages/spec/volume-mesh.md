# Volume mesh file (`mesh.bin`)

The mesh job writes the analysis mesh of a geometry as one binary file (ARCHITECTURE.md section 3, step 5; ADR-028). It holds the nodes, the tetrahedra grouped by body, for every face tag the element faces that lie on it, so the deck generator (M1.7) can turn a face tag into a CalculiX surface without Gmsh, and since version 2 for every edge tag the mesh segments along it, for supports on edges (ADR-105). Writer and reader: `worker/clearfea_worker/meshing/volume.py`. The viewer draws the mesh from its own display file (`display.bin` of the mesh, same format as `display-mesh.md`). Since M3.4 the API also serves a run's `mesh.bin` (`GET /api/runs/:id/mesh`) for cut planes, which the viewer reads with `apps/web/src/viewer/section.ts` (ADR-053).

Version 2, little-endian, no padding:

| Part | Type | Count | Meaning |
| --- | --- | --- | --- |
| magic | 4 bytes | 1 | `CFVM` |
| version | uint32 | 1 | `2` |
| order | uint32 | 1 | `1` (4-node tetrahedra) or `2` (10-node tetrahedra) |
| nodeCount | uint32 | 1 | |
| elementCount | uint32 | 1 | |
| bodyCount | uint32 | 1 | |
| faceCount | uint32 | 1 | |
| entryCount | uint32 | 1 | total element faces over all faces |
| edgeCount | uint32 | 1 | |
| segmentCount | uint32 | 1 | total mesh segments over all edges |
| positions | float64 | 3 × nodeCount | x, y, z in metres |
| elements | uint32 | n × elementCount | node indices into `positions`, n = 4 or 10 |
| bodies | 3 × 4 bytes | bodyCount | int32 `bodyTag`, uint32 `firstElement`, `elementCount` |
| faces | 3 × 4 bytes | faceCount | int32 `faceTag`, uint32 `firstEntry`, `entryCount` |
| entries | 2 × 4 bytes | entryCount | uint32 `element`, uint32 `localFace` |
| edges | 3 × 4 bytes | edgeCount | int32 `edgeTag`, uint32 `firstSegment`, `segmentCount` |
| segments | n × 4 bytes | segmentCount | uint32 node indices, n = 2 (order 1) or 3 (order 2): the segment's two ends, then its middle node |

The header is 40 bytes, so `positions` starts on an 8-byte boundary. Node and element numbers are 0-based indices into their arrays; the deck generator adds 1 when it writes CalculiX ids. Bodies, faces and edges are stored in ascending tag order, and each body owns one contiguous run of elements. Body and face tags are the ones in `topology.json`.

Each element lists its nodes in Gmsh's order: the four corners first, then, for order 2, the mid-edge nodes of edges (0,1), (1,2), (2,0), (3,0), (3,2), (3,1). This is not CalculiX's C3D10 order; the deck generator maps it.

`localFace` names the element face by its three corner nodes, in Gmsh's corner numbering:

| localFace | Corners |
| --- | --- |
| 0 | 0, 1, 2 |
| 1 | 0, 1, 3 |
| 2 | 0, 2, 3 |
| 3 | 1, 2, 3 |

The order inside a row says nothing about the face's orientation. Mapping these to CalculiX's face numbers is the deck generator's job and is checked there against the CalculiX manual.

A change to this layout bumps the version, and readers refuse versions they do not know.

Version 1 (meshes made before 2026-10-21) has the 32-byte header without `edgeCount` and `segmentCount`, and no `edges` or `segments`; readers still read it, with no edges. A setup with a support on edges needs a version 2 mesh (`MeshView.edgesKept`), so such a mesh is made again.
