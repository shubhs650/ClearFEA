# SPDX-License-Identifier: AGPL-3.0-or-later
"""Supports as constraints on nodes (M2.2). Physics-critical.

Every support says, at each node of its faces, that the displacement u along some unit
direction d has a given value: a fixed support u·x = u·y = u·z = 0, a prescribed
displacement u·axis = value for each component that is not free, a frictionless support
u·n = 0 with n the face's normal. A node on the faces of several supports collects all of
their constraints. This module turns each node's constraints into the directions it is held
in and the displacement along each (a Hold), refuses supports that disagree, finds rigid-body
motions the supports leave free, and shares a node's reaction force between the supports
holding it. The deck generator writes the Holds; the result reader uses the sharing.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass

from ..meshing.volume import VolumeMesh
from ..spec.simulation_schema import (
    ElasticSupport,
    FixedSupport,
    FrictionlessSupport,
    PrescribedDisplacement,
    SimulationSpec,
)
from .common import DeckError
from .linalg import Vector, cross, dot, norm, solve, symmetric_eigen
from .loads import Spring, face_normal, fixed_support_nodes, prescribed_components

AXES: tuple[Vector, Vector, Vector] = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))

#: A constraint direction counts as new at a node when it differs from the span of the ones
#: before it by more than this (a sine of about 1e-6 rad).
INDEPENDENT = 1e-6
#: Constraints at one node agree when they are met to this fraction of the largest value.
AGREE = 1e-6
#: The supports hold the part when every rigid-body motion is resisted: the smallest
#: eigenvalue of the normalised 6x6 matrix below is at least this fraction of the largest.
RIGID = 1e-10


@dataclass(frozen=True)
class Constraint:
    """u·direction = value at a node, from spec.supports[support]; value in metres."""

    support: int
    direction: Vector
    value: float


@dataclass(frozen=True)
class Hold:
    """The orthonormal directions a node is held in and its displacement along each."""

    basis: tuple[Vector, ...]
    values: tuple[float, ...]
    #: Every constraint at the node lies along a global axis.
    on_axes: bool

    def displacement(self) -> Vector:
        u = [0.0, 0.0, 0.0]
        for q, v in zip(self.basis, self.values, strict=True):
            for i in range(3):
                u[i] += v * q[i]
        return (u[0], u[1], u[2])


def support_kind(
    support: FixedSupport | PrescribedDisplacement | FrictionlessSupport | ElasticSupport,
) -> str:
    """The support's type as the deck comments and messages name it."""
    return {
        "fixed": "Fixed support",
        "displacement": "Prescribed displacement",
        "frictionless": "Frictionless support",
        "elastic": "Elastic support",
    }[support.type]


def node_constraints(spec: SimulationSpec, mesh: VolumeMesh) -> dict[int, list[Constraint]]:
    """The constraints at every supported node (0-based), in spec order. Faces must exist.

    Elastic supports hold nothing; their springs are separate elements (loads/elastic.py)."""
    out: dict[int, list[Constraint]] = {}

    def add(nodes: Sequence[int], constraint: Constraint) -> None:
        for n in nodes:
            out.setdefault(n, []).append(constraint)

    for k, support in enumerate(spec.supports):
        if isinstance(support, FixedSupport):
            nodes = fixed_support_nodes(mesh, support.faces)
            for axis in AXES:
                add(nodes, Constraint(k, axis, 0.0))
        elif isinstance(support, PrescribedDisplacement):
            nodes = fixed_support_nodes(mesh, support.faces)
            for axis, value in prescribed_components(support):
                add(nodes, Constraint(k, AXES[axis], value))
        elif isinstance(support, FrictionlessSupport):
            what = f'Frictionless support "{support.name}"'
            for tag in support.faces:
                normal = face_normal(mesh, tag, what)
                add(fixed_support_nodes(mesh, [tag]), Constraint(k, normal, 0.0))
    return dict(sorted(out.items()))


def frictionless_normals(spec: SimulationSpec, mesh: VolumeMesh) -> dict[int, Vector]:
    """Face tag -> unit normal of every face of a frictionless support, for the deck comments."""
    normals = {}
    for support in spec.supports:
        if isinstance(support, FrictionlessSupport):
            what = f'Frictionless support "{support.name}"'
            for tag in support.faces:
                normals[tag] = face_normal(mesh, tag, what)
    return normals


def _basis(directions: Sequence[Vector]) -> list[Vector]:
    """An orthonormal basis of the span of ``directions``, by Gram-Schmidt in their order."""
    basis: list[Vector] = []
    for d in directions:
        v = list(d)
        for q in basis:
            p = dot(v, q)
            v = [v[i] - p * q[i] for i in range(3)]
        length = norm(v)
        if length > INDEPENDENT:
            basis.append((v[0] / length, v[1] / length, v[2] / length))
    return basis


def _position(mesh: VolumeMesh, node: int) -> Vector:
    p = mesh.positions
    return (p[3 * node], p[3 * node + 1], p[3 * node + 2])


def hold(
    spec: SimulationSpec, mesh: VolumeMesh, node: int, constraints: Sequence[Constraint]
) -> Hold:
    """What ``constraints`` at ``node`` hold; DeckError when they ask for different motions."""
    basis = _basis([c.direction for c in constraints])
    rows = [[dot(c.direction, q) for q in basis] for c in constraints]
    rhs = [c.value for c in constraints]
    r = len(basis)
    normal = [[sum(row[i] * row[j] for row in rows) for j in range(r)] for i in range(r)]
    values = solve(
        normal, [sum(row[i] * b for row, b in zip(rows, rhs, strict=True)) for i in range(r)]
    )
    scale = max(abs(b) for b in rhs)
    miss = max(abs(dot(row, values) - b) for row, b in zip(rows, rhs, strict=True))
    if miss > AGREE * scale:
        names = []
        for c in constraints:
            support = spec.supports[c.support]
            label = f'{support_kind(support).lower()} "{support.name}"'
            if label not in names:
                names.append(label)
        x, y, z = _position(mesh, node)
        raise DeckError(
            f"The {' and the '.join(names)} meet at the node at ({x:.6g}, {y:.6g}, {z:.6g}) m "
            "and ask it to move in different ways. Change them so that they agree where "
            "their faces touch."
        )
    on_axes = all(sorted(abs(x) for x in c.direction) == [0.0, 0.0, 1.0] for c in constraints)
    return Hold(tuple(basis), tuple(values), on_axes)


def holds(spec: SimulationSpec, mesh: VolumeMesh) -> dict[int, Hold]:
    """The Hold of every supported node (0-based), in node order."""
    return {n: hold(spec, mesh, n, cs) for n, cs in node_constraints(spec, mesh).items()}


_MOTIONS = (
    "slide along x",
    "slide along y",
    "slide along z",
    "turn about the x axis",
    "turn about the y axis",
    "turn about the z axis",
)


def free_motions(
    mesh: VolumeMesh, held: dict[int, Hold], springs: Sequence[Spring] = ()
) -> list[str]:
    """Rigid-body motions of the part that no support resists, in words; empty when held.

    A rigid-body motion u(p) = t + w × (p - c) is resisted at a node held along q when
    q·u = t·q + w·((p - c) × q) is not zero. Summing the outer products of the rows
    (q, (p - c) × q / R) over every held direction gives a 6x6 matrix whose eigenvectors with
    a (relative) zero eigenvalue are the free motions. c is the centre of the mesh's bounding
    box and R half its diagonal, so the translation and rotation parts are comparable. A
    grounded spring of an elastic support resists motion along its direction like a hold.
    """
    p = mesh.positions
    lo = [min(p[i::3]) for i in range(3)]
    hi = [max(p[i::3]) for i in range(3)]
    centre = [(lo[i] + hi[i]) / 2 for i in range(3)]
    radius = norm([hi[i] - lo[i] for i in range(3)]) / 2 or 1.0
    matrix = [[0.0] * 6 for _ in range(6)]
    rows = [(node, q) for node, h in held.items() for q in h.basis]
    rows.extend((s.node, s.direction) for s in springs)
    for node, q in rows:
        x = _position(mesh, node)
        arm = [(x[i] - centre[i]) / radius for i in range(3)]
        row = (*q, *cross(arm, q))
        for i in range(6):
            for j in range(6):
                matrix[i][j] += row[i] * row[j]
    values, vectors = symmetric_eigen(matrix)
    largest = values[-1]
    if largest <= 0.0:
        return list(_MOTIONS)
    free = [v for value, v in zip(values, vectors, strict=True) if value < RIGID * largest]
    if not free:
        return []
    # Name each of the six basic motions that lies (almost) wholly in the free space.
    named = [
        name
        for k, name in enumerate(_MOTIONS)
        if math.sqrt(sum(v[k] ** 2 for v in free)) > 1 - 1e-6
    ]
    if len(named) < len(free):
        others = len(free) - len(named)
        named.append(f"move in {others} other way{'s' if others > 1 else ''}")
    return named


def check_held(mesh: VolumeMesh, held: dict[int, Hold], springs: Sequence[Spring] = ()) -> None:
    """DeckError when the supports leave the part free to move as a rigid body."""
    motions = free_motions(mesh, held, springs)
    if motions:
        listed = ", ".join(motions[:-1]) + (" and " if len(motions) > 1 else "") + motions[-1]
        raise DeckError(
            f"The supports do not hold the part in place: it can still {listed}. CalculiX "
            "would solve this without a warning and give meaningless displacements. Add "
            "supports that stop these motions, for example a fixed support or frictionless "
            "supports on faces facing other directions (an elastic support only resists motion "
            "along its faces' normals)."
        )


def share_reaction(
    spec: SimulationSpec, constraints: Sequence[Constraint], force: Vector
) -> dict[int, Vector]:
    """A node's reaction force shared between the supports holding it (support index -> force).

    CalculiX's RF at a node is the whole nodal force K·u, which along a direction no support
    holds is the applied load there, not a reaction (a pulled end's corner on a symmetry
    plane). So only the part of the force in the span of the node's constraint directions is
    a reaction. That part is written as a sum of forces along the directions with the smallest
    coefficients (least squares), and each support takes the part along its own directions:
    supports holding different directions (a symmetry plane and an end face) get exactly
    their own components, and where two hold the same direction they share it equally.
    """
    supports = sorted({c.support for c in constraints})
    # Coefficients lambda = D^T (D D^T)^+ f, with D the 3 x m matrix of directions.
    dd = [
        [sum(c.direction[i] * c.direction[j] for c in constraints) for j in range(3)]
        for i in range(3)
    ]
    values, vectors = symmetric_eigen(dd)
    top = values[-1]
    g = [0.0, 0.0, 0.0]  # (D D^T)^+ f
    for value, v in zip(values, vectors, strict=True):
        if value > INDEPENDENT * top:
            p = dot(v, force) / value
            for i in range(3):
                g[i] += p * v[i]
    shares: dict[int, list[float]] = {k: [0.0, 0.0, 0.0] for k in supports}
    for c in constraints:
        coefficient = dot(c.direction, g)
        for i in range(3):
            shares[c.support][i] += coefficient * c.direction[i]
    return {k: (v[0], v[1], v[2]) for k, v in shares.items()}


def support_node_reactions(
    spec: SimulationSpec, mesh: VolumeMesh, forces: dict[int, Vector]
) -> list[dict[int, Vector]]:
    """Each support's reaction at each of its held nodes (0-based node -> newtons), in spec
    order, from the reaction force at each held node. ValueError if a held node has no force."""
    out: list[dict[int, Vector]] = [{} for _ in spec.supports]
    for node, constraints in node_constraints(spec, mesh).items():
        if node not in forces:
            raise ValueError(f"The solver gave no reaction force for node {node + 1}.")
        for k, share in share_reaction(spec, constraints, forces[node]).items():
            out[k][node] = share
    return out


def support_reactions(
    spec: SimulationSpec, mesh: VolumeMesh, forces: dict[int, Vector]
) -> list[Vector]:
    """Total reaction of each support, in spec order, from the reaction force at each held
    node (0-based node -> newtons). ValueError if a held node has no force."""
    totals = []
    for shares in support_node_reactions(spec, mesh, forces):
        t = [sum(f[i] for f in shares.values()) for i in range(3)]
        totals.append((t[0], t[1], t[2]))
    return totals
