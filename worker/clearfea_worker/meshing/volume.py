# SPDX-License-Identifier: AGPL-3.0-or-later
"""The volume mesh file (mesh.bin): nodes, tetrahedra by body, element faces by face tag and,
since version 2, the mesh segments along each edge (ADR-105).

Format version 2, little-endian, described for readers in packages/spec/volume-mesh.md:

    header     b"CFVM", then uint32 version, order, nodeCount, elementCount, bodyCount,
               faceCount, entryCount, edgeCount, segmentCount
    positions  float64 x, y, z per node, in metres
    elements   uint32 node indices, 4 or 10 per element, in Gmsh's node order
    bodies     per body: int32 bodyTag, uint32 firstElement, elementCount
    faces      per face: int32 faceTag, uint32 firstEntry, entryCount
    entries    per element face: uint32 element, uint32 localFace (see TET_FACES)
    edges      per edge: int32 edgeTag, uint32 firstSegment, segmentCount
    segments   uint32 node indices, 2 or 3 per segment: its two ends, then its middle node

Version 1 files (meshes made before M9's edge supports) have the shorter header and no edges
or segments; they are still read, with no edges.
"""

import struct
import sys
from array import array
from dataclasses import dataclass, field
from pathlib import Path

MAGIC = b"CFVM"
VERSION = 2
_HEADER_V1 = struct.Struct("<4sIIIIIII")
_HEADER = struct.Struct("<4sIIIIIIIII")
_RANGE = struct.Struct("<iII")

#: Corner nodes of each local face of a tetrahedron, in Gmsh's corner numbering.
TET_FACES = ((0, 1, 2), (0, 1, 3), (0, 2, 3), (1, 2, 3))

#: Nodes per element for each element order.
NODES_PER_ELEMENT = {1: 4, 2: 10}

#: Nodes per edge segment for each element order: two ends, and for order 2 the middle node.
NODES_PER_SEGMENT = {1: 2, 2: 3}


@dataclass(frozen=True)
class VolumeMesh:
    """A tetrahedral mesh with 0-based node and element indices.

    ``elements`` is flat: element ``e`` uses ``elements[e * n : (e + 1) * n]`` with
    ``n = NODES_PER_ELEMENT[order]``. ``bodies`` maps a body tag to its run of elements as
    ``(first, count)``; ``faces`` maps a face tag to its ``(element, localFace)`` pairs;
    ``edges`` maps an edge tag to its segments, flat, ``NODES_PER_SEGMENT[order]`` node indices
    each (empty for a version 1 file).
    """

    order: int
    positions: list[float]
    elements: list[int]
    bodies: dict[int, tuple[int, int]]
    faces: dict[int, list[tuple[int, int]]]
    edges: dict[int, list[int]] = field(default_factory=dict)

    @property
    def node_count(self) -> int:
        return len(self.positions) // 3

    @property
    def element_count(self) -> int:
        return len(self.elements) // NODES_PER_ELEMENT[self.order]


def _little(values: array) -> bytes:
    if sys.byteorder == "big":
        values = array(values.typecode, values)
        values.byteswap()
    return values.tobytes()


def write_volume_mesh(path: Path, mesh: VolumeMesh) -> None:
    if mesh.order not in NODES_PER_ELEMENT:
        raise ValueError(f"Element order {mesh.order} is not 1 or 2.")
    if len(mesh.elements) % NODES_PER_ELEMENT[mesh.order] != 0:
        raise ValueError("The element list does not divide into whole elements.")
    entries = array("I")
    face_rows = []
    for tag in sorted(mesh.faces):
        pairs = mesh.faces[tag]
        face_rows.append((tag, len(entries) // 2, len(pairs)))
        for element, local in pairs:
            entries.extend((element, local))
    body_rows = [(tag, *mesh.bodies[tag]) for tag in sorted(mesh.bodies)]
    nps = NODES_PER_SEGMENT[mesh.order]
    segments = array("I")
    edge_rows = []
    for tag in sorted(mesh.edges):
        flat = mesh.edges[tag]
        if len(flat) % nps != 0:
            raise ValueError(f"Edge {tag}'s node list does not divide into whole segments.")
        edge_rows.append((tag, len(segments) // nps, len(flat) // nps))
        segments.extend(flat)
    with path.open("wb") as f:
        f.write(
            _HEADER.pack(
                MAGIC,
                VERSION,
                mesh.order,
                mesh.node_count,
                mesh.element_count,
                len(body_rows),
                len(face_rows),
                len(entries) // 2,
                len(edge_rows),
                len(segments) // nps,
            )
        )
        f.write(_little(array("d", mesh.positions)))
        f.write(_little(array("I", mesh.elements)))
        for row in body_rows:
            f.write(_RANGE.pack(*row))
        for row in face_rows:
            f.write(_RANGE.pack(*row))
        f.write(_little(entries))
        for row in edge_rows:
            f.write(_RANGE.pack(*row))
        f.write(_little(segments))


def read_volume_mesh(path: Path) -> VolumeMesh:
    """Reads and checks a mesh file. Raises ValueError when it is not a valid version 1 or 2
    file."""
    data = path.read_bytes()
    if len(data) < _HEADER_V1.size:
        raise ValueError(f"{path} is shorter than a volume mesh header.")
    magic, version, order, nn, ne, nb, nf, nentries = _HEADER_V1.unpack_from(data, 0)
    if magic != MAGIC or version not in (1, VERSION) or order not in NODES_PER_ELEMENT:
        raise ValueError(f"{path} is not a version 1 or {VERSION} volume mesh file.")
    header = _HEADER_V1
    ned = nsegments = 0
    if version == 2:
        if len(data) < _HEADER.size:
            raise ValueError(f"{path} is shorter than a volume mesh header.")
        header = _HEADER
        ned, nsegments = _HEADER.unpack_from(data, 0)[8:]
    npe = NODES_PER_ELEMENT[order]
    nps = NODES_PER_SEGMENT[order]
    expected = (
        header.size
        + nn * 24
        + ne * npe * 4
        + (nb + nf + ned) * _RANGE.size
        + nentries * 8
        + nsegments * nps * 4
    )
    if len(data) != expected:
        raise ValueError(f"{path} has {len(data)} bytes, which does not match its header.")
    offset = header.size
    positions = list(struct.unpack_from(f"<{nn * 3}d", data, offset))
    offset += nn * 24
    elements = list(struct.unpack_from(f"<{ne * npe}I", data, offset))
    offset += ne * npe * 4
    if any(n >= nn for n in elements):
        raise ValueError(f"{path}: an element uses a node that does not exist.")
    bodies: dict[int, tuple[int, int]] = {}
    for _ in range(nb):
        tag, first, count = _RANGE.unpack_from(data, offset)
        offset += _RANGE.size
        if first + count > ne:
            raise ValueError(f"{path}: body {tag} runs past the last element.")
        bodies[tag] = (first, count)
    face_rows = []
    for _ in range(nf):
        face_rows.append(_RANGE.unpack_from(data, offset))
        offset += _RANGE.size
    flat = struct.unpack_from(f"<{nentries * 2}I", data, offset)
    faces: dict[int, list[tuple[int, int]]] = {}
    for tag, first, count in face_rows:
        if first + count > nentries:
            raise ValueError(f"{path}: face {tag} runs past the last entry.")
        pairs = [(flat[2 * k], flat[2 * k + 1]) for k in range(first, first + count)]
        if any(e >= ne or local > 3 for e, local in pairs):
            raise ValueError(f"{path}: face {tag} names an element face that does not exist.")
        faces[tag] = pairs
    offset += nentries * 8
    edge_rows = []
    for _ in range(ned):
        edge_rows.append(_RANGE.unpack_from(data, offset))
        offset += _RANGE.size
    nodes = struct.unpack_from(f"<{nsegments * nps}I", data, offset)
    edges: dict[int, list[int]] = {}
    for tag, first, count in edge_rows:
        if first + count > nsegments:
            raise ValueError(f"{path}: edge {tag} runs past the last segment.")
        run = list(nodes[first * nps : (first + count) * nps])
        if any(n >= nn for n in run):
            raise ValueError(f"{path}: edge {tag} uses a node that does not exist.")
        edges[tag] = run
    return VolumeMesh(order, positions, elements, bodies, faces, edges)
