# SPDX-License-Identifier: AGPL-3.0-or-later
"""The display mesh file (display.bin) the viewer renders and picks faces on.

Format version 1, little-endian, described for readers in packages/spec/display-mesh.md:

    header     b"CFDM", then uint32 version, vertexCount, triangleCount, faceCount
    positions  float32 x, y, z per vertex, in metres
    indices    uint32 three vertex indices per triangle
    faces      per face: int32 faceTag, uint32 firstVertex, vertexCount, firstTriangle,
               triangleCount

Each face has its own run of vertices and triangles, so a viewer can shade a face smoothly
and still keep a sharp edge where two faces meet, and a picked triangle resolves to its face
tag by range.
"""

import struct
import sys
from array import array
from dataclasses import dataclass
from pathlib import Path

MAGIC = b"CFDM"
VERSION = 1
_HEADER = struct.Struct("<4sIIII")
_FACE = struct.Struct("<iIIII")


@dataclass(frozen=True)
class FacePatch:
    """The triangles of one face: positions (x, y, z per vertex) and local vertex indices."""

    tag: int
    positions: list[float]
    triangles: list[int]


def _little(values: array) -> bytes:
    if sys.byteorder == "big":
        values = array(values.typecode, values)
        values.byteswap()
    return values.tobytes()


def write_display(path: Path, patches: list[FacePatch]) -> int:
    """Writes the display file. Returns the number of triangles written."""
    positions = array("f")
    indices = array("I")
    table = []
    vertex_base = 0
    triangle_base = 0
    for patch in sorted(patches, key=lambda p: p.tag):
        vertices = len(patch.positions) // 3
        triangles = len(patch.triangles) // 3
        positions.extend(patch.positions)
        indices.extend(vertex_base + i for i in patch.triangles)
        table.append((patch.tag, vertex_base, vertices, triangle_base, triangles))
        vertex_base += vertices
        triangle_base += triangles
    with path.open("wb") as f:
        f.write(_HEADER.pack(MAGIC, VERSION, vertex_base, triangle_base, len(table)))
        f.write(_little(positions))
        f.write(_little(indices))
        for row in table:
            f.write(_FACE.pack(*row))
    return triangle_base


def read_display(path: Path) -> list[FacePatch]:
    """Reads a display file back into one patch per face, as a viewer would see it."""
    data = path.read_bytes()
    magic, version, nv, nt, nf = _HEADER.unpack_from(data, 0)
    if magic != MAGIC or version != VERSION:
        raise ValueError(f"{path} is not a version {VERSION} display mesh file.")
    offset = _HEADER.size
    positions = struct.unpack_from(f"<{nv * 3}f", data, offset)
    offset += nv * 12
    indices = struct.unpack_from(f"<{nt * 3}I", data, offset)
    offset += nt * 12
    patches = []
    for k in range(nf):
        tag, v0, vn, t0, tn = _FACE.unpack_from(data, offset + k * _FACE.size)
        local = [i - v0 for i in indices[t0 * 3 : (t0 + tn) * 3]]
        if any(i < 0 or i >= vn for i in local):
            raise ValueError(f"{path}: face {tag} uses vertices outside its own range.")
        patches.append(FacePatch(tag, list(positions[v0 * 3 : (v0 + vn) * 3]), local))
    if offset + nf * _FACE.size != len(data):
        raise ValueError(f"{path} has {len(data)} bytes, which does not match its header.")
    return patches
