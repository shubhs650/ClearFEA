# SPDX-License-Identifier: AGPL-3.0-or-later
"""The volume mesh file (mesh.bin): nodes, tetrahedra by body, and element faces by face tag.

Format version 1, little-endian, described for readers in packages/spec/volume-mesh.md:

    header     b"CFVM", then uint32 version, order, nodeCount, elementCount, bodyCount,
               faceCount, entryCount
    positions  float64 x, y, z per node, in metres
    elements   uint32 node indices, 4 or 10 per element, in Gmsh's node order
    bodies     per body: int32 bodyTag, uint32 firstElement, elementCount
    faces      per face: int32 faceTag, uint32 firstEntry, entryCount
    entries    per element face: uint32 element, uint32 localFace (see TET_FACES)
"""

import struct
import sys
from array import array
from dataclasses import dataclass
from pathlib import Path

MAGIC = b"CFVM"
VERSION = 1
_HEADER = struct.Struct("<4sIIIIIII")
_RANGE = struct.Struct("<iII")

#: Corner nodes of each local face of a tetrahedron, in Gmsh's corner numbering.
TET_FACES = ((0, 1, 2), (0, 1, 3), (0, 2, 3), (1, 2, 3))

#: Nodes per element for each element order.
NODES_PER_ELEMENT = {1: 4, 2: 10}


@dataclass(frozen=True)
class VolumeMesh:
    """A tetrahedral mesh with 0-based node and element indices.

    ``elements`` is flat: element ``e`` uses ``elements[e * n : (e + 1) * n]`` with
    ``n = NODES_PER_ELEMENT[order]``. ``bodies`` maps a body tag to its run of elements as
    ``(first, count)``; ``faces`` maps a face tag to its ``(element, localFace)`` pairs.
    """

    order: int
    positions: list[float]
    elements: list[int]
    bodies: dict[int, tuple[int, int]]
    faces: dict[int, list[tuple[int, int]]]

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
            )
        )
        f.write(_little(array("d", mesh.positions)))
        f.write(_little(array("I", mesh.elements)))
        for row in body_rows:
            f.write(_RANGE.pack(*row))
        for row in face_rows:
            f.write(_RANGE.pack(*row))
        f.write(_little(entries))


def read_volume_mesh(path: Path) -> VolumeMesh:
    """Reads and checks a mesh file. Raises ValueError when it is not a valid version 1 file."""
    data = path.read_bytes()
    if len(data) < _HEADER.size:
        raise ValueError(f"{path} is shorter than a volume mesh header.")
    magic, version, order, nn, ne, nb, nf, nentries = _HEADER.unpack_from(data, 0)
    if magic != MAGIC or version != VERSION or order not in NODES_PER_ELEMENT:
        raise ValueError(f"{path} is not a version {VERSION} volume mesh file.")
    npe = NODES_PER_ELEMENT[order]
    expected = _HEADER.size + nn * 24 + ne * npe * 4 + (nb + nf) * _RANGE.size + nentries * 8
    if len(data) != expected:
        raise ValueError(f"{path} has {len(data)} bytes, which does not match its header.")
    offset = _HEADER.size
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
    return VolumeMesh(order, positions, elements, bodies, faces)
