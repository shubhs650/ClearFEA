# SPDX-License-Identifier: AGPL-3.0-or-later
"""Fixed support: every node on the faces, corner and mid-edge, held in x, y and z.

A fixed support or a prescribed displacement may also hold edges (ADR-105): every node of the
mesh segments along them, ends and middle nodes.
"""

import math
from collections.abc import Sequence

from ...meshing.volume import NODES_PER_ELEMENT, NODES_PER_SEGMENT, VolumeMesh
from ...spec.simulation_schema import FixedSupport, PrescribedDisplacement
from ..common import DeckError
from ..elements import FACE_NODES


def fixed_support_nodes(mesh: VolumeMesh, faces: list[int]) -> list[int]:
    """Sorted 0-based indices of the nodes on ``faces``. Every tag must be in the mesh."""
    npe = NODES_PER_ELEMENT[mesh.order]
    rows = FACE_NODES[mesh.order]
    nodes: set[int] = set()
    for tag in faces:
        for element, local in mesh.faces[tag]:
            base = element * npe
            nodes.update(mesh.elements[base + k] for k in rows[local])
    return sorted(nodes)


def edge_nodes(mesh: VolumeMesh, edges: Sequence[int]) -> list[int]:
    """Sorted 0-based indices of the nodes along ``edges``. Every tag must be in the mesh."""
    nodes: set[int] = set()
    for tag in edges:
        nodes.update(mesh.edges[tag])
    return sorted(nodes)


def support_nodes(mesh: VolumeMesh, support: FixedSupport | PrescribedDisplacement) -> list[int]:
    """Sorted 0-based indices of the nodes a fixed support or prescribed displacement holds:
    those on its faces and along its edges."""
    nodes = set(fixed_support_nodes(mesh, support.faces))
    nodes.update(edge_nodes(mesh, support.edges or []))
    return sorted(nodes)


def edges_centroid(mesh: VolumeMesh, edges: Sequence[int]) -> tuple[float, float, float]:
    """The length centroid of ``edges`` (m), over their straight mesh segments between end
    nodes; DeckError when they have no length in the mesh."""
    per = NODES_PER_SEGMENT[mesh.order]
    p = mesh.positions
    length = 0.0
    moment = [0.0, 0.0, 0.0]
    for tag in edges:
        flat = mesh.edges[tag]
        for k in range(0, len(flat), per):
            a, b = flat[k], flat[k + 1]
            pa, pb = p[3 * a : 3 * a + 3], p[3 * b : 3 * b + 3]
            dl = math.dist(pa, pb)
            length += dl
            for i in range(3):
                moment[i] += 0.5 * (pa[i] + pb[i]) * dl
    if not length > 0.0:
        raise DeckError("A support's edges have no length in the mesh. Mesh the simulation again.")
    return (moment[0] / length, moment[1] / length, moment[2] / length)
