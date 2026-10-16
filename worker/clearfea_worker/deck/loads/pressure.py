# SPDX-License-Identifier: AGPL-3.0-or-later
"""Pressure: a uniform pressure on each element face of the loaded faces (*DLOAD, Pn).

A positive pressure in the spec pushes on the face towards the body (ADR-026 item 4). A
positive CalculiX pressure acts the same way, against the element face's outward normal, so
the value is written unchanged; the deck check in ADR-029 shows this by solving.

CalculiX turns each element face's pressure into nodal loads itself, and its reaction output
(RF) at a held node includes them (manual section 6.11.5). ``pressure_nodal_loads`` works
them out the way CalculiX does, so the result reader can take them back out and add them to
the applied-load totals (M3.2, ADR-051): -p n times each node's shape function over the
curved element face, integrated with a three-point rule (area coordinates 1/6 and 2/3,
weights 1/3), which matches CalculiX 2.21's nodal loads on a curved ten-node face to its
printed digits where the seven-point rule of a force on faces is 3e-4 off.
"""

from ...meshing.volume import NODES_PER_ELEMENT, TET_FACES, VolumeMesh
from ...spec.simulation_schema import PressureLoad, SimulationSpec
from ..common import si
from ..elements import CCX_FACE_NUMBER
from ..linalg import Vector, cross
from .force import _triangle_nodes, _triangle_shape

#: CalculiX's rule for a distributed load on a triangular element face: (L1, L2, weight),
#: weights summing to one. Exact for flat six-node faces; one point would do for three-node.
_RULE: tuple[tuple[float, float, float], ...] = (
    (1 / 6, 1 / 6, 1 / 3),
    (2 / 3, 1 / 6, 1 / 3),
    (1 / 6, 2 / 3, 1 / 3),
)

#: Gmsh local face of each CalculiX face number.
_LOCAL_FACE = {number: local for local, number in enumerate(CCX_FACE_NUMBER)}


def pressure_faces(mesh: VolumeMesh, faces: list[int]) -> list[tuple[int, int]]:
    """The (0-based element, CalculiX face number) pairs that make up ``faces``."""
    return [
        (element, CCX_FACE_NUMBER[local]) for tag in faces for element, local in mesh.faces[tag]
    ]


def element_face_pressures(spec: SimulationSpec, mesh: VolumeMesh) -> dict[tuple[int, int], float]:
    """The pressure (Pa) on each (0-based element, CalculiX face number) of every pressure
    load, loads on the same element face added up (the analysis is linear), in key order.
    DeckError when a load has no magnitude."""
    pressure: dict[tuple[int, int], float] = {}
    for load in spec.loads:
        if isinstance(load, PressureLoad):
            value = si(load.magnitude, "pressure", f"{load.name}: magnitude")
            for key in pressure_faces(mesh, load.faces):
                pressure[key] = pressure.get(key, 0.0) + value
    return dict(sorted(pressure.items()))


def pressure_nodal_loads(
    mesh: VolumeMesh, pressures: dict[tuple[int, int], float]
) -> dict[int, Vector]:
    """Nodal forces (N) CalculiX applies for ``pressures`` (element_face_pressures), 0-based
    node -> force, in node order."""
    npe = NODES_PER_ELEMENT[mesh.order]
    p = mesh.positions
    rule = [(w, *_triangle_shape(mesh.order, l1, l2)) for l1, l2, w in _RULE]
    out: dict[int, list[float]] = {}
    for (element, face), value in pressures.items():
        local = _LOCAL_FACE[face]
        base = element * npe
        ids = [mesh.elements[base + k] for k in _triangle_nodes(mesh.order, local)]
        xyz = [(p[3 * n], p[3 * n + 1], p[3 * n + 2]) for n in ids]
        # The element's fourth corner lies inside, which tells the outward side of the face.
        (opposite,) = {0, 1, 2, 3} - set(TET_FACES[local])
        o = mesh.elements[base + opposite]
        inside = [p[3 * o + i] - sum(xyz[k][i] for k in range(3)) / 3 for i in range(3)]
        for w, n, d in rule:
            t1 = [sum(d[k][0] * xyz[k][i] for k in range(len(ids))) for i in range(3)]
            t2 = [sum(d[k][1] * xyz[k][i] for k in range(len(ids))) for i in range(3)]
            c = cross(t1, t2)  # normal times twice the area per unit reference area
            sign = 1.0 if sum(c[i] * inside[i] for i in range(3)) > 0.0 else -1.0
            # Towards the body: the reference triangle has area 1/2.
            scale = 0.5 * w * value * sign
            for k, node in enumerate(ids):
                f = out.setdefault(node, [0.0, 0.0, 0.0])
                for i in range(3):
                    f[i] += n[k] * scale * c[i]
    return {node: (f[0], f[1], f[2]) for node, f in sorted(out.items())}
