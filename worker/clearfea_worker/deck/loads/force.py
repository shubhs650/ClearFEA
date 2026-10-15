# SPDX-License-Identifier: AGPL-3.0-or-later
"""Force on faces: a total force spread over the faces as a uniform traction (*CLOAD, M2.3).

The traction is the force over the faces' total area, the same everywhere on them. Its
consistent nodal loads are t times the integral of each node's shape function over the
element faces (ARCHITECTURE.md section 7): on a flat six-node triangle the corners get
nothing and each mid-edge node a third of the triangle's force; on a three-node triangle each
corner a third. Curved six-node triangles are integrated with a seven-point rule, which is
exact for flat ones. Each node's share is the same fraction of every component, and the
shares add up to one, so the nodal loads sum to the entered force.
"""

from ...meshing.volume import NODES_PER_ELEMENT, TET_FACES, VolumeMesh
from ...spec.simulation_schema import ForceLoad
from ..common import DeckError, si
from ..elements import GMSH_EDGES
from ..linalg import Vector, cross, norm

#: Seven-point rule on the triangle, exact to degree 5 (Dunavant 1985): (L1, L2, weight),
#: weights summing to one.
_TRIANGLE_RULE: tuple[tuple[float, float, float], ...] = (
    (1 / 3, 1 / 3, 0.225),
    (0.059715871789770, 0.470142064105115, 0.132394152788506),
    (0.470142064105115, 0.059715871789770, 0.132394152788506),
    (0.470142064105115, 0.470142064105115, 0.132394152788506),
    (0.797426985353087, 0.101286507323456, 0.125939180544827),
    (0.101286507323456, 0.797426985353087, 0.125939180544827),
    (0.101286507323456, 0.101286507323456, 0.125939180544827),
)


def _triangle_nodes(order: int, local: int) -> tuple[int, ...]:
    """Gmsh local nodes of a tetrahedron's local face: corners a, b, c, then for order 2 the
    mid-edge nodes on a-b, b-c and c-a."""
    a, b, c = TET_FACES[local]
    if order == 1:
        return (a, b, c)
    mid = {frozenset(edge): 4 + k for k, edge in enumerate(GMSH_EDGES)}
    return (a, b, c, mid[frozenset((a, b))], mid[frozenset((b, c))], mid[frozenset((c, a))])


def _triangle_shape(
    order: int, l1: float, l2: float
) -> tuple[list[float], list[tuple[float, float]]]:
    """Shape functions of the triangle's nodes and their derivatives along L1 and L2."""
    l3 = 1.0 - l1 - l2
    if order == 1:
        return [l1, l2, l3], [(1.0, 0.0), (0.0, 1.0), (-1.0, -1.0)]
    n = [
        l1 * (2 * l1 - 1),
        l2 * (2 * l2 - 1),
        l3 * (2 * l3 - 1),
        4 * l1 * l2,
        4 * l2 * l3,
        4 * l3 * l1,
    ]
    d = [
        (4 * l1 - 1, 0.0),
        (0.0, 4 * l2 - 1),
        (1 - 4 * l3, 1 - 4 * l3),
        (4 * l2, 4 * l1),
        (-4 * l2, 4 * (l3 - l2)),
        (4 * (l3 - l1), -4 * l1),
    ]
    return n, d


def face_node_weights(mesh: VolumeMesh, faces: list[int]) -> dict[int, float]:
    """The integral of each node's shape function over ``faces`` (m²), 0-based node -> weight.

    The weights add up to the faces' area.
    """
    npe = NODES_PER_ELEMENT[mesh.order]
    p = mesh.positions
    rule = [(w, *_triangle_shape(mesh.order, l1, l2)) for l1, l2, w in _TRIANGLE_RULE]
    weights: dict[int, float] = {}
    for tag in faces:
        for element, local in mesh.faces[tag]:
            base = element * npe
            ids = [mesh.elements[base + k] for k in _triangle_nodes(mesh.order, local)]
            xyz = [(p[3 * n], p[3 * n + 1], p[3 * n + 2]) for n in ids]
            for w, n, d in rule:
                t1 = [sum(d[k][0] * xyz[k][i] for k in range(len(ids))) for i in range(3)]
                t2 = [sum(d[k][1] * xyz[k][i] for k in range(len(ids))) for i in range(3)]
                # The reference triangle has area 1/2.
                da = 0.5 * w * norm(cross(t1, t2))
                for k, node in enumerate(ids):
                    weights[node] = weights.get(node, 0.0) + n[k] * da
    return weights


def force_vector(load: ForceLoad) -> Vector:
    """The load's total force in newtons; DeckError when a component is missing."""
    what = f'Force "{load.name}"'
    x, y, z = (
        si(component, "force", f"{what}: {axis} component")
        for axis, component in zip("xyz", (load.x, load.y, load.z), strict=True)
    )
    return (x, y, z)


def force_nodal_loads(mesh: VolumeMesh, load: ForceLoad) -> dict[int, Vector]:
    """Nodal forces (N) of ``load`` on its faces, 0-based node -> force; faces must exist."""
    force = force_vector(load)
    weights = face_node_weights(mesh, load.faces)
    area = sum(weights.values())
    if not area > 0.0:
        raise DeckError(
            f'Force "{load.name}": its faces have no area in the mesh. Mesh the simulation again.'
        )
    return {
        node: (force[0] * w / area, force[1] * w / area, force[2] * w / area)
        for node, w in sorted(weights.items())
    }
