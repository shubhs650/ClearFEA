# SPDX-License-Identifier: AGPL-3.0-or-later
"""Small hand-made volume meshes for the deck generator tests (no Gmsh needed).

Two tetrahedra share a face: A B C D and B C D E, both positively oriented, with corners
at the origin and on the axes of a 10 mm cube. Face tags: 1 is A C D (x = 0), 2 is A B C
(z = 0), 3 is the two faces B C E and B D E, 4 is A B D (y = 0) and C D E.
"""

from clearfea_worker.deck.elements import GMSH_EDGES
from clearfea_worker.meshing.volume import VolumeMesh

__all__ = ["GMSH_EDGES", "two_tets"]

_CORNERS = [
    (0.0, 0.0, 0.0),
    (0.01, 0.0, 0.0),
    (0.0, 0.01, 0.0),
    (0.0, 0.0, 0.01),
    (0.01, 0.01, 0.01),
]
_TETS = [(0, 1, 2, 3), (1, 2, 3, 4)]
#: face tag -> (element, Gmsh local face) pairs; local faces as in TET_FACES.
_FACES = {1: [(0, 2)], 2: [(0, 0)], 3: [(1, 1), (1, 2)], 4: [(0, 1), (1, 3)]}


def two_tets(order: int, bodies: int = 1) -> VolumeMesh:
    """The two-element mesh, as one body (tag 1) or as two (tags 1 and 2, one element each)."""
    positions = [c for corner in _CORNERS for c in corner]
    elements: list[int] = []
    mids: dict[frozenset[int], int] = {}
    for tet in _TETS:
        elements.extend(tet)
        if order == 2:
            for a, b in GMSH_EDGES:
                key = frozenset((tet[a], tet[b]))
                if key not in mids:
                    mids[key] = len(positions) // 3
                    positions.extend(
                        (positions[3 * tet[a] + i] + positions[3 * tet[b] + i]) / 2
                        for i in range(3)
                    )
                elements.append(mids[key])
    body_map = {1: (0, 2)} if bodies == 1 else {1: (0, 1), 2: (1, 1)}
    return VolumeMesh(order, positions, elements, body_map, {k: list(v) for k, v in _FACES.items()})
