# SPDX-License-Identifier: AGPL-3.0-or-later
"""Elastic support: faces on an elastic foundation, as grounded springs per node (M2.6).

A foundation of stiffness k (N/m³) pushes back on a face with the pressure k (u · n) along
the face's normal n, wherever the face moves by u; it does not resist sliding along the face
(a Winkler foundation, ADR-043). Its stiffness matrix k ∫ N_i N_j n nᵀ dA is lumped by rows:
node i of a face gets one spring along its own normal d_i with stiffness

    k_i = k w_i,    w_i = ∫ N_i dA,    d_i = ∫ N_i n dA / |∫ N_i n dA|

over the face's element faces, integrated with the seven-point rule of a force on faces
(force.py). The w_i of a face add up to its area, so a face pushed along its normal by a
uniform pressure p moves by exactly p / k, on any mesh: the springs' forces k w_i (p / k) are
the pressure's consistent nodal loads. On a flat six-node triangle the corners have w_i = 0
and get no spring, as they get no share of a force. A node on two faces of the support (an
edge) gets a spring for each face, along that face's normal. Nodes whose w_i is not above
ROUNDING of the support's largest get none (on curved faces a corner's w_i can be slightly
negative, and a spring cannot have a negative stiffness).

Each spring is a CalculiX SPRING1 element at the node, acting along local direction 1 of an
*ORIENTATION whose x axis is d_i, or along the global degree of freedom when d_i is an axis
(checked with ccx 2.21; the spring adds k d dᵀ at the node in global axes, so it needs no
*TRANSFORM and does not clash with the constraint groups of other supports). Not SPRINGA to a
held far node: CalculiX averages nodal stresses over every element at a node and counts a
SPRINGA among them with zero stress, which halved the stress at a spring's node in M2.6's
check, while SPRING1 elements are left out of the average (extrapolate.f). The support's
reaction is worked out from the displacements of its nodes, -k_i d_i (d_i · u_i) at each
spring, which is the force CalculiX's linear SPRING1 applies.
"""

from dataclasses import dataclass

from ...meshing.volume import NODES_PER_ELEMENT, TET_FACES, VolumeMesh
from ...spec.simulation_schema import ElasticSupport
from ..common import DeckError, si
from ..linalg import Vector, cross, dot, norm
from .force import _TRIANGLE_RULE, _triangle_nodes, _triangle_shape

#: A node's share of the face area is rounding, and gets no spring, below this fraction of the
#: largest share in the support.
ROUNDING = 1e-12
#: A spring direction whose other components are all below this is snapped to the axis, so the
#: common case of a face on x, y or z reads plainly in the deck.
NORMAL_SNAP = 1e-9


@dataclass(frozen=True)
class Spring:
    """A grounded spring at a mesh node (0-based) along unit ``direction``, in N/m."""

    node: int
    direction: Vector
    stiffness: float


def elastic_stiffness(support: ElasticSupport) -> float:
    """The foundation stiffness in N/m³; DeckError when missing or not positive."""
    what = f'Elastic support "{support.name}"'
    k = si(support.stiffness, "foundationStiffness", f"{what}: foundation stiffness")
    if not k > 0.0:
        raise DeckError(f"{what}: the foundation stiffness must be greater than zero.")
    return k


def _snap(v: list[float]) -> Vector:
    axis = max(range(3), key=lambda i: abs(v[i]))
    if all(abs(v[i]) < NORMAL_SNAP for i in range(3) if i != axis):
        snapped = [0.0, 0.0, 0.0]
        snapped[axis] = 1.0 if v[axis] > 0 else -1.0
        v = snapped
    return (v[0], v[1], v[2])


def face_node_normals(mesh: VolumeMesh, tag: int) -> dict[int, tuple[float, Vector]]:
    """For each node of face ``tag`` (0-based): (w_i in m², ∫ N_i n dA in m²) with n the
    outward unit normal, each element face turned away from its element's opposite corner."""
    npe = NODES_PER_ELEMENT[mesh.order]
    p = mesh.positions
    rule = [(w, *_triangle_shape(mesh.order, l1, l2)) for l1, l2, w in _TRIANGLE_RULE]
    out: dict[int, tuple[float, list[float]]] = {}
    for element, local in mesh.faces[tag]:
        base = element * npe
        ids = [mesh.elements[base + k] for k in _triangle_nodes(mesh.order, local)]
        xyz = [(p[3 * n], p[3 * n + 1], p[3 * n + 2]) for n in ids]
        (opposite,) = {0, 1, 2, 3} - set(TET_FACES[local])
        o = mesh.elements[base + opposite]
        a = xyz[0]
        inward = [p[3 * o + i] - a[i] for i in range(3)]
        flat = cross([xyz[1][i] - a[i] for i in range(3)], [xyz[2][i] - a[i] for i in range(3)])
        sign = -1.0 if dot(flat, inward) > 0 else 1.0
        for w, n, d in rule:
            t1 = [sum(d[k][0] * xyz[k][i] for k in range(len(ids))) for i in range(3)]
            t2 = [sum(d[k][1] * xyz[k][i] for k in range(len(ids))) for i in range(3)]
            # The area vector of the point; the reference triangle has area 1/2.
            da = [0.5 * w * sign * c for c in cross(t1, t2)]
            size = norm(da)
            for k, node in enumerate(ids):
                share, vector = out.setdefault(node, (0.0, [0.0, 0.0, 0.0]))
                for i in range(3):
                    vector[i] += n[k] * da[i]
                out[node] = (share + n[k] * size, vector)
    return {node: (w, (v[0], v[1], v[2])) for node, (w, v) in sorted(out.items())}


def elastic_springs(mesh: VolumeMesh, support: ElasticSupport) -> list[Spring]:
    """The grounded springs of ``support``, face by face in the support's order, then by node;
    its faces must exist in the mesh."""
    k = elastic_stiffness(support)
    shares = {tag: face_node_normals(mesh, tag) for tag in support.faces}
    largest = max((w for face in shares.values() for w, _ in face.values()), default=0.0)
    if not largest > 0.0:
        raise DeckError(
            f'Elastic support "{support.name}": its faces have no area in the mesh. Mesh the '
            "simulation again."
        )
    springs = []
    for tag in support.faces:
        for node, (w, vector) in shares[tag].items():
            length = norm(vector)
            if w <= ROUNDING * largest or length == 0.0:
                continue
            direction = _snap([c / length for c in vector])
            springs.append(Spring(node, direction, k * w))
    return springs


def spring_reaction(springs: list[Spring], displacements: dict[int, Vector]) -> Vector:
    """The force (N) the springs put on the part when their nodes (0-based) have moved by
    ``displacements`` (m): the sum of -k_i d_i (d_i · u_i). KeyError for a node without one."""
    total = [0.0, 0.0, 0.0]
    for s in springs:
        u = displacements[s.node]
        f = s.stiffness * dot(s.direction, u)
        for i in range(3):
            total[i] -= f * s.direction[i]
    return (total[0], total[1], total[2])
