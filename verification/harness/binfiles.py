# SPDX-License-Identifier: AGPL-3.0-or-later
"""Readers for a run's viewer files, written from the format notes in packages/spec.

The harness reads `surface.bin` (display-mesh.md) and `fields.bin` (result-fields.md) as the
API serves them, with its own readers rather than the worker's, so that a mistake in the
worker's writer cannot hide behind the same mistake in its reader.
"""

import struct
from dataclasses import dataclass


@dataclass(frozen=True)
class Patch:
    """One face of the run's surface: its tag and its run of vertices and triangles."""

    tag: int
    first_vertex: int
    vertex_count: int
    triangles: list[tuple[int, int, int]]  # indices into the whole file's vertices


@dataclass(frozen=True)
class Surface:
    positions: list[tuple[float, float, float]]  # metres
    patches: list[Patch]


def read_surface(data: bytes) -> Surface:
    magic, version, nv, nt, nf = struct.unpack_from("<4sIIII", data, 0)
    if magic != b"CFDM" or version != 1:
        raise ValueError("surface.bin is not a version 1 display mesh file.")
    offset = 20
    flat = struct.unpack_from(f"<{3 * nv}f", data, offset)
    offset += 12 * nv
    indices = struct.unpack_from(f"<{3 * nt}I", data, offset)
    offset += 12 * nt
    if offset + 20 * nf != len(data):
        raise ValueError("surface.bin's length does not match its header.")
    positions = [(flat[3 * v], flat[3 * v + 1], flat[3 * v + 2]) for v in range(nv)]
    patches = []
    for k in range(nf):
        tag, v0, vn, t0, tn = struct.unpack_from("<iIIII", data, offset + 20 * k)
        triangles = [
            (indices[3 * t], indices[3 * t + 1], indices[3 * t + 2]) for t in range(t0, t0 + tn)
        ]
        patches.append(Patch(tag, v0, vn, triangles))
    return Surface(positions, patches)


def read_fields(data: bytes, vertex_count: int) -> dict[str, list[tuple[float, ...]]]:
    """Field name -> one tuple of components per surface vertex, in SI units."""
    magic, version, nv, nf = struct.unpack_from("<4sIII", data, 0)
    if magic != b"CFRF" or version != 1:
        raise ValueError("fields.bin is not a version 1 result fields file.")
    if nv != vertex_count:
        raise ValueError(f"fields.bin has {nv} vertices but surface.bin has {vertex_count}.")
    offset = 16
    table = []
    for _ in range(nf):
        name, _kind, components = struct.unpack_from("<16s16sI", data, offset)
        table.append((name.rstrip(b"\0").decode("ascii"), components))
        offset += 36
    fields = {}
    for name, components in table:
        values = struct.unpack_from(f"<{components * nv}f", data, offset)
        offset += 4 * components * nv
        fields[name] = [tuple(values[v * components : (v + 1) * components]) for v in range(nv)]
    if offset != len(data):
        raise ValueError("fields.bin's length does not match its field table.")
    return fields
