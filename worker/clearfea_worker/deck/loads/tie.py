# SPDX-License-Identifier: AGPL-3.0-or-later
"""Bonds as ties: each node of one face follows the other face where it lies on it (M4.3).

Physics-critical. Each body is meshed on its own (ADR-058), so the two faces of a bond have
their own nodes. For every bond the user has not removed (ADR-059), the nodes of one face,
the slave, are tied to the element faces of the other, the master: a slave node's
displacement equals the master surface's displacement at the point closest to it, the
master nodes' shape functions there times their displacements. The deck writes these as
*EQUATION lines rather than CalculiX's *TIE, so that the coefficients are known here: CalculiX
prints a held node's raw nodal force, which leaves out the share of the tie forces a master
node on a support carries, and the result reader adds that share back (ADR-060).

A slave node's equations are written in its own deck directions (deck.constraints.Frame), one
for every direction no support holds; a master node's terms are in its own directions too, so
nodes with a *TRANSFORM take part correctly. No node depends on another dependent node:
a slave node already tied, or already used as a master node, is not tied again, and a slave
node whose closest master element face has a tied node is left untied. That only happens
where three bodies meet, and the deck comment counts such nodes.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass

from ...meshing.volume import NODES_PER_ELEMENT, VolumeMesh
from ...spec.simulation_schema import Bond, SimulationSpec
from ..common import DeckError
from ..constraints import FREE, Frame
from ..linalg import Vector, dot
from .force import _triangle_nodes, _triangle_shape

#: A slave node is tied when it lies within this fraction of the longest edge of the master
#: element face closest to it. Bonded faces touch within 1e-4 of the model size (ADR-059);
#: the rest allows for a first-order element face's chord across a curved face (h^2 / 8R, a
#: twelfth of the edge when the edge is two thirds of the radius).
TIE_TOLERANCE = 0.1

#: Coefficients smaller than this are rounding (a shape function at a node of the face) and
#: are left out of the equation.
ROUNDING = 1e-12

#: Gauss-Newton steps to find the closest point on a curved six-node element face.
_STEPS = 8


@dataclass(frozen=True)
class Term:
    """``coefficient`` times the displacement of ``node`` along its deck direction
    ``direction`` (0-based, deck.constraints.Frame)."""

    node: int
    direction: int
    coefficient: float


#: One linear equation, sum of terms = 0. The first term is the dependent one: a slave node's
#: free direction, coefficient 1.
Equation = tuple[Term, ...]


@dataclass(frozen=True)
class Tie:
    """The ties of one bond: ``slave`` face's nodes follow ``master`` face."""

    bond: tuple[int, int]
    slave: int
    master: int
    slave_body: int
    master_body: int
    #: Nodes of the slave face.
    nodes: int
    equations: tuple[Equation, ...]
    #: Slave nodes with at least one equation.
    tied: int
    #: Slave nodes held in every direction by supports, so nothing is left to tie.
    held: int
    #: Slave nodes farther from the master face than the tolerance (an overhang).
    off: int
    #: Slave nodes left untied because they, or the master nodes they would follow, are tied
    #: by another bond already (where three bodies meet).
    shared: int


def tied_bonds(spec: SimulationSpec) -> list[Bond]:
    """The bonds the deck ties: every bond of the spec that the user has not removed. A spec
    without a bond list has none; the API writes the list into every run's spec."""
    return [b for b in spec.bonds or [] if b.status != "removed"]


def _body_of_face(mesh: VolumeMesh, tag: int) -> int:
    ranges = sorted((first, first + count, body) for body, (first, count) in mesh.bodies.items())
    bodies = set()
    for element, _ in mesh.faces[tag]:
        for first, end, body in ranges:
            if first <= element < end:
                bodies.add(body)
                break
    if len(bodies) != 1:
        raise DeckError(
            f"Face {tag} of a bond does not belong to exactly one body of the mesh. Mesh the "
            "simulation again."
        )
    return bodies.pop()


@dataclass(frozen=True)
class _Patch:
    """An element face: its nodes (corners, then mid-edge nodes for order 2) and positions."""

    nodes: tuple[int, ...]
    points: tuple[Vector, ...]

    @property
    def longest(self) -> float:
        a, b, c = self.points[:3]
        return max(math.dist(a, b), math.dist(b, c), math.dist(c, a))

    @property
    def area(self) -> float:
        a, b, c = self.points[:3]
        u = [b[i] - a[i] for i in range(3)]
        v = [c[i] - a[i] for i in range(3)]
        n = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
        return 0.5 * math.sqrt(dot(n, n))


def _patches(mesh: VolumeMesh, tag: int) -> list[_Patch]:
    npe = NODES_PER_ELEMENT[mesh.order]
    p = mesh.positions
    out = []
    for element, local in mesh.faces[tag]:
        ids = tuple(mesh.elements[element * npe + k] for k in _triangle_nodes(mesh.order, local))
        out.append(_Patch(ids, tuple((p[3 * n], p[3 * n + 1], p[3 * n + 2]) for n in ids)))
    return out


def _clamp(l1: float, l2: float) -> tuple[float, float]:
    """The nearest point of the reference triangle l1, l2 >= 0, l1 + l2 <= 1 (in l1, l2)."""
    l1, l2 = max(l1, 0.0), max(l2, 0.0)
    excess = l1 + l2 - 1.0
    if excess > 0.0:
        l1, l2 = l1 - excess / 2, l2 - excess / 2
        if l1 < 0.0:
            l1, l2 = 0.0, 1.0
        elif l2 < 0.0:
            l1, l2 = 1.0, 0.0
    return l1, l2


def _point(order: int, patch: _Patch, l1: float, l2: float) -> tuple[Vector, Vector, Vector]:
    """Position on the element face at (l1, l2) and its derivatives along l1 and l2."""
    n, d = _triangle_shape(order, l1, l2)
    x = [sum(n[k] * patch.points[k][i] for k in range(len(n))) for i in range(3)]
    t1 = [sum(d[k][0] * patch.points[k][i] for k in range(len(n))) for i in range(3)]
    t2 = [sum(d[k][1] * patch.points[k][i] for k in range(len(n))) for i in range(3)]
    return (x[0], x[1], x[2]), (t1[0], t1[1], t1[2]), (t2[0], t2[1], t2[2])


def closest_point(order: int, patch: _Patch, q: Vector) -> tuple[float, float, float]:
    """(l1, l2, distance) of the point of the element face closest to ``q``.

    Gauss-Newton on the face's own shape (exact in one step for a flat face), each step kept
    inside the triangle, started from the corners' plane."""
    l1, l2 = 1 / 3, 1 / 3
    steps = 2 if order == 1 else _STEPS
    for _ in range(steps):
        x, t1, t2 = _point(order, patch, l1, l2)
        r = [q[i] - x[i] for i in range(3)]
        a11, a12, a22 = dot(t1, t1), dot(t1, t2), dot(t2, t2)
        b1, b2 = dot(t1, r), dot(t2, r)
        det = a11 * a22 - a12 * a12
        if det <= 0.0:
            break
        d1 = (a22 * b1 - a12 * b2) / det
        d2 = (a11 * b2 - a12 * b1) / det
        n1, n2 = _clamp(l1 + d1, l2 + d2)
        if n1 == l1 and n2 == l2:
            break
        l1, l2 = n1, n2
    x, _, _ = _point(order, patch, l1, l2)
    return l1, l2, math.dist(x, q)


class _Grid:
    """Element faces binned by their boxes, grown by the tie tolerance, on a uniform grid."""

    def __init__(self, patches: Sequence[_Patch]) -> None:
        self.patches = patches
        self.cell = max(p.longest for p in patches)
        self.bins: dict[tuple[int, int, int], list[int]] = {}
        for k, patch in enumerate(patches):
            grow = TIE_TOLERANCE * patch.longest
            lo = [min(x[i] for x in patch.points) - grow for i in range(3)]
            hi = [max(x[i] for x in patch.points) + grow for i in range(3)]
            a, b = self._key(lo), self._key(hi)
            for i in range(a[0], b[0] + 1):
                for j in range(a[1], b[1] + 1):
                    for m in range(a[2], b[2] + 1):
                        self.bins.setdefault((i, j, m), []).append(k)

    def _key(self, x: Sequence[float]) -> tuple[int, int, int]:
        return (
            math.floor(x[0] / self.cell),
            math.floor(x[1] / self.cell),
            math.floor(x[2] / self.cell),
        )

    def near(self, q: Vector) -> list[int]:
        return self.bins.get(self._key(q), [])


def _slave_and_master(mesh: VolumeMesh, bond: Bond) -> tuple[int, int, list[_Patch], list[_Patch]]:
    """The bond's slave face and master face with their element faces. The slave is the face
    with the finer mesh (the smaller mean element face); when the two are within a quarter of
    each other, the face with the smaller area, then the larger tag."""
    a, b = bond.faces
    pa, pb = _patches(mesh, a), _patches(mesh, b)
    area_a, area_b = sum(p.area for p in pa), sum(p.area for p in pb)
    mean_a, mean_b = area_a / len(pa), area_b / len(pb)
    if mean_a < 0.75 * mean_b:
        slave_first = True
    elif mean_b < 0.75 * mean_a:
        slave_first = False
    elif area_a != area_b:
        slave_first = area_a < area_b
    else:
        slave_first = a > b
    return (a, b, pa, pb) if slave_first else (b, a, pb, pa)


def ties(spec: SimulationSpec, mesh: VolumeMesh, frames: dict[int, Frame]) -> list[Tie]:
    """The ties of every bond not removed, in spec order. ``frames`` holds each held node's
    deck directions (deck.constraints.node_frames). DeckError when a bond does not fit the
    mesh."""
    out: list[Tie] = []
    dependent: set[int] = set()
    masters: set[int] = set()
    p = mesh.positions
    for bond in tied_bonds(spec):
        unknown = [f for f in bond.faces if f not in mesh.faces]
        if unknown:
            raise DeckError(
                f"The bond between faces {bond.faces[0]} and {bond.faces[1]} uses faces "
                f"{unknown}, which the mesh does not have. Mesh the simulation again."
            )
        slave, master, slave_patches, master_patches = _slave_and_master(mesh, bond)
        slave_body, master_body = _body_of_face(mesh, slave), _body_of_face(mesh, master)
        if slave_body == master_body:
            raise DeckError(
                f"The bond between faces {bond.faces[0]} and {bond.faces[1]} joins body "
                f"{slave_body} to itself. Bonds join different bodies; mesh the simulation "
                "again."
            )
        grid = _Grid(master_patches)
        nodes = sorted({n for patch in slave_patches for n in patch.nodes})
        equations: list[Equation] = []
        tied = held = off = shared = 0
        for s in nodes:
            frame = frames.get(s, FREE)
            free = [j for j in range(3) if j not in frame.held]
            if not free:
                held += 1
                continue
            if s in dependent or s in masters:
                shared += 1
                continue
            q = (p[3 * s], p[3 * s + 1], p[3 * s + 2])
            best: tuple[float, int, float, float] | None = None
            for k in grid.near(q):
                l1, l2, distance = closest_point(mesh.order, master_patches[k], q)
                if best is None or (distance, k) < (best[0], best[1]):
                    best = (distance, k, l1, l2)
            if best is None or best[0] > TIE_TOLERANCE * master_patches[best[1]].longest:
                off += 1
                continue
            _, k, l1, l2 = best
            patch = master_patches[k]
            if any(n in dependent for n in patch.nodes):
                shared += 1
                continue
            shape, _ = _triangle_shape(mesh.order, l1, l2)
            for j in free:
                e = frame.axes[j]
                terms = [Term(s, j, 1.0)]
                for n, weight in zip(patch.nodes, shape, strict=True):
                    axes = frames.get(n, FREE).axes
                    for m in range(3):
                        c = -weight * dot(e, axes[m])
                        if abs(c) > ROUNDING:
                            terms.append(Term(n, m, c))
                equations.append(tuple(terms))
            tied += 1
            dependent.add(s)
            masters.update(patch.nodes)
        out.append(
            Tie(
                (bond.faces[0], bond.faces[1]),
                slave,
                master,
                slave_body,
                master_body,
                len(nodes),
                tuple(equations),
                tied,
                held,
                off,
                shared,
            )
        )
    return out


def tie_forces(
    ties_: Sequence[Tie], frames: dict[int, Frame], residual: dict[int, Vector]
) -> dict[int, Vector]:
    """The force each node receives through the ties, from the solver's ``residual`` at every
    tied slave node (its nodal force less the load applied there, global axes).

    CalculiX eliminates each equation's dependent direction and passes the force there, lambda,
    to the other terms' directions, each times minus its coefficient; its printed nodal force
    leaves this out. Added to a held master node's printed force, it gives the node's true
    reaction (ADR-060)."""
    out: dict[int, list[float]] = {}
    for tie in ties_:
        for equation in tie.equations:
            first = equation[0]
            r = residual[first.node]
            lam = dot(r, frames.get(first.node, FREE).axes[first.direction]) / first.coefficient
            for term in equation[1:]:
                axis = frames.get(term.node, FREE).axes[term.direction]
                f = out.setdefault(term.node, [0.0, 0.0, 0.0])
                for i in range(3):
                    f[i] -= term.coefficient * lam * axis[i]
    return {n: (f[0], f[1], f[2]) for n, f in sorted(out.items())}
