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
from collections.abc import Collection, Sequence
from dataclasses import dataclass

from ..meshing.volume import NODES_PER_ELEMENT, VolumeMesh
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


@dataclass(frozen=True)
class Frame:
    """The directions 1 to 3 of a node's degrees of freedom in the deck (global unit vectors)
    and which of them supports hold (0-based). A held node off the global axes gets its own
    directions through a *TRANSFORM (``transformed``); every other node uses x, y and z."""

    axes: tuple[Vector, Vector, Vector]
    held: frozenset[int]
    transformed: bool


#: The frame of a node no support holds.
FREE = Frame(AXES, frozenset(), False)


def perpendicular(a: Vector) -> Vector:
    """A unit vector at right angles to unit vector ``a``, the same for the same ``a``."""
    axis = min(range(3), key=lambda i: (abs(a[i]), i))
    e = AXES[axis]
    d = sum(a[i] * e[i] for i in range(3))
    v = [e[i] - d * a[i] for i in range(3)]
    length = sum(x * x for x in v) ** 0.5
    return (v[0] / length, v[1] / length, v[2] / length)


def hold_frame(h: "Hold") -> Frame:
    """How the deck writes ``h``: in global axes when every constraint lies along an axis or
    the node is held in all three directions, otherwise in the node's own directions (a
    *TRANSFORM, TYPE=R through its first held direction and a second one at right angles,
    the third their cross product), holding the first len(basis) of them."""
    if h.on_axes or len(h.basis) == 3:
        held = {0, 1, 2}
        if len(h.basis) < 3:
            held = {max(range(3), key=lambda i: abs(q[i])) for q in h.basis}
        return Frame(AXES, frozenset(held), False)
    a = h.basis[0]
    b = h.basis[1] if len(h.basis) == 2 else perpendicular(a)
    return Frame((a, b, cross(a, b)), frozenset(range(len(h.basis))), True)


def node_frames(held: dict[int, "Hold"]) -> dict[int, Frame]:
    """The Frame of every held node; nodes left out are FREE."""
    return {n: hold_frame(h) for n, h in held.items()}


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
    mesh: VolumeMesh,
    held: dict[int, Hold],
    springs: Sequence[Spring] = (),
    nodes: Collection[int] | None = None,
) -> list[str]:
    """Rigid-body motions of the part that no support resists, in words; empty when held.

    A rigid-body motion u(p) = t + w × (p - c) is resisted at a node held along q when
    q·u = t·q + w·((p - c) × q) is not zero. Summing the outer products of the rows
    (q, (p - c) × q / R) over every held direction gives a 6x6 matrix whose eigenvectors with
    a (relative) zero eigenvalue are the free motions. c is the centre of the bounding box of
    the nodes and R half its diagonal, so the translation and rotation parts are comparable. A
    grounded spring of an elastic support resists motion along its direction like a hold.
    ``nodes`` limits the check to the nodes of some bodies (one group of bonded bodies, M4.4);
    None looks at the whole mesh.
    """
    p = mesh.positions
    if nodes is None:
        lo = [min(p[i::3]) for i in range(3)]
        hi = [max(p[i::3]) for i in range(3)]
    else:
        lo = [min(p[3 * n + i] for n in nodes) for i in range(3)]
        hi = [max(p[3 * n + i] for n in nodes) for i in range(3)]
    centre = [(lo[i] + hi[i]) / 2 for i in range(3)]
    radius = norm([hi[i] - lo[i] for i in range(3)]) / 2 or 1.0
    matrix = [[0.0] * 6 for _ in range(6)]
    rows = [(node, q) for node, h in held.items() for q in h.basis]
    rows.extend((s.node, s.direction) for s in springs)
    if nodes is not None:
        rows = [(node, q) for node, q in rows if node in nodes]
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


def _listed(words: Sequence[str]) -> str:
    """ "a", "a and b", "a, b and c"."""
    return ", ".join(words[:-1]) + (" and " if len(words) > 1 else "") + words[-1]


def body_nodes(mesh: VolumeMesh, bodies: Collection[int]) -> set[int]:
    """The nodes of the elements of ``bodies`` (tags)."""
    npe = NODES_PER_ELEMENT[mesh.order]
    out: set[int] = set()
    for tag in bodies:
        first, count = mesh.bodies[tag]
        out.update(mesh.elements[first * npe : (first + count) * npe])
    return out


def check_held(
    mesh: VolumeMesh,
    held: dict[int, Hold],
    springs: Sequence[Spring] = (),
    groups: Sequence[Sequence[int]] | None = None,
) -> None:
    """DeckError when the supports leave the part free to move as a rigid body.

    ``groups`` lists the bodies (tags) that bonds join into one piece (M4.4, deck.loads.tie
    .body_groups). Bodies of an assembly are meshed apart and share no nodes (ADR-058), so
    with more than one group each must be held on its own: supports that hold one body say
    nothing about a body no bond joins to it. None, or one group, checks the whole model.
    """
    if groups is None or len(groups) < 2:
        motions = free_motions(mesh, held, springs)
        if motions:
            raise DeckError(
                f"The supports do not hold the part in place: it can still {_listed(motions)}. "
                "CalculiX would solve this without a warning and give meaningless "
                "displacements. Add supports that stop these motions, for example a fixed "
                "support or frictionless supports on faces facing other directions (an elastic "
                "support only resists motion along its faces' normals)."
            )
        return
    problems = []
    for group in groups:
        nodes = body_nodes(mesh, group)
        motions = free_motions(mesh, held, springs, nodes)
        if not motions:
            continue
        tags = sorted(group)
        if len(tags) == 1:
            what = f"body {tags[0]}"
        else:
            what = f"bodies {_listed([str(t) for t in tags])} (bonded to each other)"
        if len(motions) == len(_MOTIONS):
            problems.append(
                f"No support holds {what} and no bond joins "
                f"{'it' if len(tags) == 1 else 'them'} to a held body, so "
                f"{'it is' if len(tags) == 1 else 'they are'} free to move."
            )
        else:
            problems.append(
                f"The supports do not hold {what} in place: it can still {_listed(motions)}."
            )
    if problems:
        raise DeckError(
            " ".join(problems)
            + " Bodies are joined only by the bonds listed under Bonds. CalculiX would solve "
            "this without a warning and give meaningless displacements. Add supports on each "
            "free body, or keep a bond that joins it to a held body."
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
