# SPDX-License-Identifier: AGPL-3.0-or-later
"""Fixed support: every node on the faces, corner and mid-edge, held in x, y and z."""

from ...meshing.volume import NODES_PER_ELEMENT, VolumeMesh
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
