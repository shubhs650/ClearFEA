# SPDX-License-Identifier: AGPL-3.0-or-later
"""Viewer result files: the mesh's outer surface and the nodal fields on it (ADR-031).

Physics-critical: these files are what the user sees as the result. ARCHITECTURE.md section 7,
results pipeline step 3. Two files per run for the surface:

- ``surface.bin`` in the display mesh format (packages/spec/display-mesh.md): every element
  face listed under a face tag in mesh.bin, oriented outwards. A 10-node element face is drawn
  as four triangles through its mid-edge nodes, so every surface node of the mesh is a vertex
  and curved faces stay curved.
- ``fields.bin`` (packages/spec/result-fields.md): the value of each field at each vertex of
  surface.bin, in SI, as float32: displacement (x, y, z), von Mises stress, and since M3.1 the
  stress components, the principal stresses and the total strain components (ADR-050), and
  since M3.5 the safety factor against yield when the setup gives every material a yield
  strength (ADR-054).

Since M3.4 a third file, ``nodes.bin``, holds the same fields at every node of the mesh in the
same format (vertex v is mesh node v of mesh.bin), so the viewer can draw them on a cut plane
(ADR-053).

No value is computed here: each vertex takes its node's value from the result reader, so the
viewer shows exactly the nodal values CalculiX wrote (and von Mises, the principal stresses and
the safety factor derived from them).
"""

import struct
import sys
from array import array
from dataclasses import dataclass
from pathlib import Path

from ..deck.elements import GMSH_EDGES
from ..geometry.display import FacePatch, write_display
from ..meshing.volume import NODES_PER_ELEMENT, TET_FACES, VolumeMesh
from .fields import NodalFields, ThermalFields, principal_field, von_mises_field

MAGIC = b"CFRF"
VERSION = 1
_HEADER = struct.Struct("<4sIII")
#: Per field: name and units.json quantity kind, both ASCII padded with zero bytes, and the
#: number of components.
_FIELD = struct.Struct("<16s16sI")


@dataclass(frozen=True)
class SurfaceField:
    """``values[v * components + c]`` for vertex ``v`` of the surface, in SI units of ``kind``."""

    name: str
    kind: str
    components: int
    values: array


@dataclass(frozen=True)
class Surface:
    """The surface patches by face tag, and the mesh node behind each patch vertex, in the
    order write_display lays the vertices out (ascending face tag)."""

    patches: list[FacePatch]
    nodes: list[int]


def _sub(p: list[float], a: int, b: int) -> tuple[float, float, float]:
    return (p[3 * a] - p[3 * b], p[3 * a + 1] - p[3 * b + 1], p[3 * a + 2] - p[3 * b + 2])


def _outward(p: list[float], a: int, b: int, c: int, opposite: int) -> bool:
    """Whether the triangle a, b, c (counter-clockwise seen from its normal's side) faces
    away from the element's fourth corner."""
    u, v, w = _sub(p, b, a), _sub(p, c, a), _sub(p, opposite, a)
    normal = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
    return normal[0] * w[0] + normal[1] * w[1] + normal[2] * w[2] < 0


def extract_surface(mesh: VolumeMesh) -> Surface:
    """The outer surface of ``mesh`` as display patches, one per face tag."""
    npe = NODES_PER_ELEMENT[mesh.order]
    mid = {frozenset(edge): 4 + k for k, edge in enumerate(GMSH_EDGES)}
    patches: list[FacePatch] = []
    nodes: list[int] = []
    for tag in sorted(mesh.faces):
        local: dict[int, int] = {}
        positions: list[float] = []
        triangles: list[int] = []
        for element, face in mesh.faces[tag]:
            element_nodes = mesh.elements[element * npe : (element + 1) * npe]
            a, b, c = TET_FACES[face]
            (d,) = {0, 1, 2, 3} - {a, b, c}
            if not _outward(mesh.positions, *(element_nodes[i] for i in (a, b, c, d))):
                b, c = c, b
            if mesh.order == 1:
                corners = [(a, b, c)]
            else:
                ab, bc, ca = (mid[frozenset(edge)] for edge in ((a, b), (b, c), (c, a)))
                # Four triangles with the corner triangle's winding.
                corners = [(a, ab, ca), (ab, b, bc), (ca, bc, c), (ab, bc, ca)]
            for triangle in corners:
                for i in triangle:
                    node = element_nodes[i]
                    if node not in local:
                        local[node] = len(local)
                        positions.extend(mesh.positions[3 * node : 3 * node + 3])
                        nodes.append(node)
                    triangles.append(local[node])
        patches.append(FacePatch(tag, positions, triangles))
    return Surface(patches, nodes)


def node_fields(fields: NodalFields | ThermalFields) -> list[SurfaceField]:
    """Every result field at every node of the mesh, in the order of result-fields.md: what
    nodes.bin holds for cut planes (M3.4, ADR-053). A thermal run has the temperature only
    (M5.1) and its heat flux (M5.3)."""
    if isinstance(fields, ThermalFields):
        return [
            SurfaceField("temperature", "temperature", 1, array("f", fields.temperature)),
            SurfaceField("heatFlux", "heatFlux", 3, array("f", fields.heat_flux)),
        ]
    return [
        SurfaceField("displacement", "length", 3, array("f", fields.displacement)),
        SurfaceField("vonMises", "pressure", 1, array("f", von_mises_field(fields))),
        SurfaceField("stress", "pressure", 6, array("f", fields.stress)),
        SurfaceField("principalStress", "pressure", 3, array("f", principal_field(fields))),
        SurfaceField("strain", "strain", 6, array("f", fields.strain)),
        *(
            [SurfaceField("safetyFactor", "ratio", 1, array("f", fields.safety_factor))]
            if fields.safety_factor is not None
            else []
        ),
    ]


def surface_fields(surface: Surface, fields: list[SurfaceField]) -> list[SurfaceField]:
    """The fields of node_fields at every vertex of ``surface``."""

    def at(f: SurfaceField) -> array:
        width, values = f.components, f.values
        return array("f", (values[width * n + i] for n in surface.nodes for i in range(width)))

    return [SurfaceField(f.name, f.kind, f.components, at(f)) for f in fields]


def _little(values: array) -> bytes:
    if sys.byteorder == "big":
        values = array(values.typecode, values)
        values.byteswap()
    return values.tobytes()


def _name(text: str) -> bytes:
    raw = text.encode("ascii")
    if len(raw) > 16:
        raise ValueError(f"{text!r} is longer than 16 characters.")
    return raw


def write_fields(path: Path, vertex_count: int, fields: list[SurfaceField]) -> None:
    for f in fields:
        if len(f.values) != vertex_count * f.components:
            raise ValueError(f"{f.name} has {len(f.values)} values for {vertex_count} vertices.")
    with path.open("wb") as out:
        out.write(_HEADER.pack(MAGIC, VERSION, vertex_count, len(fields)))
        for f in fields:
            out.write(_FIELD.pack(_name(f.name), _name(f.kind), f.components))
        for f in fields:
            out.write(_little(array("f", f.values)))


def read_fields(path: Path) -> tuple[int, list[SurfaceField]]:
    """Reads a fields file back: the vertex count and the fields, as a viewer would see them."""
    data = path.read_bytes()
    magic, version, vertices, count = _HEADER.unpack_from(data, 0)
    if magic != MAGIC or version != VERSION:
        raise ValueError(f"{path} is not a version {VERSION} result fields file.")
    offset = _HEADER.size
    table = []
    for _ in range(count):
        name, kind, components = _FIELD.unpack_from(data, offset)
        offset += _FIELD.size
        table.append((name.rstrip(b"\0").decode(), kind.rstrip(b"\0").decode(), components))
    fields = []
    for name, kind, components in table:
        n = vertices * components
        values = array("f", struct.unpack_from(f"<{n}f", data, offset))
        offset += 4 * n
        fields.append(SurfaceField(name, kind, components, values))
    if offset != len(data):
        raise ValueError(f"{path} has {len(data)} bytes, which does not match its header.")
    return vertices, fields


@dataclass(frozen=True)
class ViewerFiles:
    surface_path: Path
    fields_path: Path
    nodes_path: Path


def write_viewer_files(
    mesh: VolumeMesh, fields: NodalFields | ThermalFields, out_dir: Path
) -> ViewerFiles:
    """Writes surface.bin, fields.bin and (for cut planes, M3.4) nodes.bin into ``out_dir``."""
    surface = extract_surface(mesh)
    surface_path = out_dir / "surface.bin"
    write_display(surface_path, surface.patches)
    every_node = node_fields(fields)
    fields_path = out_dir / "fields.bin"
    write_fields(fields_path, len(surface.nodes), surface_fields(surface, every_node))
    nodes_path = out_dir / "nodes.bin"
    write_fields(nodes_path, fields.node_count, every_node)
    return ViewerFiles(surface_path, fields_path, nodes_path)
