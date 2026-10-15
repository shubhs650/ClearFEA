# SPDX-License-Identifier: AGPL-3.0-or-later
"""Tetrahedra in Gmsh's numbering (mesh.bin) mapped to CalculiX's C3D4 and C3D10.

Physics-critical: a wrong node order inverts or distorts every element, and a wrong face
number puts a pressure on the wrong face. Both tables follow the CalculiX 2.21 manual
(section 6.2.6/6.2.7 for node numbering, section 7.43 *DLOAD for face numbering) and are
checked by solving with CalculiX (worker/spikes/deck_check, ADR-029).
"""

from ..meshing.volume import TET_FACES

#: CalculiX element type for each element order.
ELEMENT_TYPE = {1: "C3D4", 2: "C3D10"}

#: Mid-edge nodes in Gmsh's order (packages/spec/volume-mesh.md): node 4 + k lies on edge k.
GMSH_EDGES = ((0, 1), (1, 2), (2, 0), (3, 0), (3, 2), (3, 1))

#: Mid-edge nodes in CalculiX's order: nodes 5 to 10 lie on edges 1-2, 2-3, 3-1, 1-4, 2-4,
#: 3-4 (1-based), written here 0-based.
CCX_EDGES = ((0, 1), (1, 2), (2, 0), (0, 3), (1, 3), (2, 3))

#: Faces of a tetrahedron by corner nodes in CalculiX's numbering, 0-based: face 1 is 1-2-3,
#: face 2 is 1-4-2, face 3 is 2-4-3, face 4 is 3-4-1 (manual, *DLOAD).
CCX_FACES = ((0, 1, 2), (0, 3, 1), (1, 3, 2), (2, 3, 0))


def _ccx_node_order(order: int) -> tuple[int, ...]:
    """Position k of a CalculiX element holds Gmsh local node ``result[k]``."""
    if order == 1:
        return (0, 1, 2, 3)
    gmsh_mid = {frozenset(edge): 4 + k for k, edge in enumerate(GMSH_EDGES)}
    return (0, 1, 2, 3, *(gmsh_mid[frozenset(edge)] for edge in CCX_EDGES))


def _ccx_face_numbers() -> tuple[int, ...]:
    """The CalculiX face number (1 to 4) of each Gmsh local face."""
    ccx = {frozenset(corners): k + 1 for k, corners in enumerate(CCX_FACES)}
    return tuple(ccx[frozenset(corners)] for corners in TET_FACES)


def _face_nodes(order: int) -> tuple[tuple[int, ...], ...]:
    """Gmsh local nodes on each Gmsh local face: the corners, then mid-edge nodes for order 2."""
    rows = []
    for corners in TET_FACES:
        mids = []
        if order == 2:
            mids = [4 + k for k, edge in enumerate(GMSH_EDGES) if set(edge) <= set(corners)]
        rows.append((*corners, *mids))
    return tuple(rows)


#: For each element order, the Gmsh local node at each CalculiX node position.
CCX_NODE_ORDER = {order: _ccx_node_order(order) for order in ELEMENT_TYPE}

#: CalculiX face number of Gmsh local faces 0 to 3: (1, 2, 4, 3).
CCX_FACE_NUMBER = _ccx_face_numbers()

#: Gmsh local nodes lying on each Gmsh local face, by element order.
FACE_NODES = {order: _face_nodes(order) for order in ELEMENT_TYPE}
