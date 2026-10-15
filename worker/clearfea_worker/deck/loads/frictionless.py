# SPDX-License-Identifier: AGPL-3.0-or-later
"""Frictionless support: each flat face held along its own normal, free in its plane (M2.2).

The normal comes from the mesh, so it is the plane the solver sees: the sum of the element
faces' area vectors, each turned away from its element's opposite corner. Every node of the
face, corner and mid-edge, must lie in that plane (DECISIONS.md: planar faces only). A normal
within NORMAL_SNAP of a global axis is taken as that axis, so the common case of a symmetry
plane on x, y or z needs no local coordinate system in the deck.
"""

from ...meshing.volume import NODES_PER_ELEMENT, TET_FACES, VolumeMesh
from ..common import DeckError
from ..elements import FACE_NODES
from ..linalg import Vector, cross, dot, norm

#: Largest distance of a face node from the face's plane, as a fraction of the face's size.
FLATNESS = 1e-6
#: A unit normal whose other components are all below this is snapped to the axis.
NORMAL_SNAP = 1e-9


def _point(mesh: VolumeMesh, node: int) -> Vector:
    p = mesh.positions
    return (p[3 * node], p[3 * node + 1], p[3 * node + 2])


def face_normal(mesh: VolumeMesh, tag: int, what: str) -> Vector:
    """The unit outward normal of flat face ``tag``; DeckError if the face is not flat."""
    npe = NODES_PER_ELEMENT[mesh.order]
    rows = FACE_NODES[mesh.order]
    total = [0.0, 0.0, 0.0]
    nodes: set[int] = set()
    for element, local in mesh.faces[tag]:
        base = element * npe
        corners = TET_FACES[local]
        (opposite,) = {0, 1, 2, 3} - set(corners)
        a, b, c = (_point(mesh, mesh.elements[base + k]) for k in corners)
        o = _point(mesh, mesh.elements[base + opposite])
        n = cross([b[i] - a[i] for i in range(3)], [c[i] - a[i] for i in range(3)])
        sign = -1.0 if dot(n, [o[i] - a[i] for i in range(3)]) > 0 else 1.0
        for i in range(3):
            total[i] += sign * n[i]
        nodes.update(mesh.elements[base + k] for k in rows[local])
    length = norm(total)
    if length == 0.0:
        raise DeckError(f"{what}: face {tag} has no area in the mesh. Mesh the simulation again.")
    normal = [x / length for x in total]
    points = [_point(mesh, n) for n in sorted(nodes)]
    centre = [sum(p[i] for p in points) / len(points) for i in range(3)]
    size = max(norm([p[i] - centre[i] for i in range(3)]) for p in points)
    off = max(abs(dot(normal, [p[i] - centre[i] for i in range(3)])) for p in points)
    if off > FLATNESS * size:
        raise DeckError(
            f"{what}: face {tag} is not flat. A frictionless support holds flat faces only; "
            "use a fixed support or a prescribed displacement on a curved face."
        )
    axis = max(range(3), key=lambda i: abs(normal[i]))
    if all(abs(normal[i]) < NORMAL_SNAP for i in range(3) if i != axis):
        snapped = [0.0, 0.0, 0.0]
        snapped[axis] = 1.0 if normal[axis] > 0 else -1.0
        normal = snapped
    return (normal[0], normal[1], normal[2])
