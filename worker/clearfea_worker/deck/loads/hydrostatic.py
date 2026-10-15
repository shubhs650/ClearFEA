# SPDX-License-Identifier: AGPL-3.0-or-later
"""Hydrostatic pressure: a still fluid's pressure on faces as consistent nodal loads (*CLOAD).

The fluid has density rho, gravity g acts on it and its free surface is the plane through the
point s normal to g. At a point x of a face the pressure is

    p(x) = rho g . (x - s)    where that is positive (below the free surface), else 0,

the depth along g times rho |g|. The fluid is on the outside of each face, so the pressure
pushes on the face towards the body, as a positive pressure does (ADR-026 item 4): the
traction is p times the inward normal.

Its consistent nodal loads are the integral of each node's shape function times that traction
over the element faces, with the seven-point rule of a force on faces (force.py). On a face
wholly below the free surface the rule is exact for flat triangles (p is linear there); a face
the free surface crosses is split into four, again and again where the surface crosses a
piece, down to SPLITS levels, so the kink at the surface is followed closely. A face wholly
above the surface carries nothing.

Unlike a uniform pressure (*DLOAD), these are nodal loads, so the result reader can take the
part landing on held nodes out of the reactions (applied.py), and the pressure varies inside
each element face rather than being one value per face.
"""

from ...meshing.volume import NODES_PER_ELEMENT, TET_FACES, VolumeMesh
from ...spec.simulation_schema import HydrostaticLoad
from ..common import DeckError, si
from ..linalg import Vector, cross, dot, norm
from .force import _TRIANGLE_RULE, _triangle_nodes, _triangle_shape

#: How many times a face piece the free surface crosses is split into four.
SPLITS = 6

#: Parameters (L1, L2) of a piece's corners; the face itself is the reference triangle.
_Piece = tuple[tuple[float, float], tuple[float, float], tuple[float, float]]
_WHOLE: _Piece = ((1.0, 0.0), (0.0, 1.0), (0.0, 0.0))


def hydrostatic_values(load: HydrostaticLoad) -> tuple[float, Vector, Vector]:
    """The fluid density (kg/m³), gravity (m/s²) and free-surface point (m); DeckError when a
    value is missing, the density is not positive or gravity is zero."""
    what = f'Hydrostatic pressure "{load.name}"'
    density = si(load.fluid_density, "density", f"{what}: fluid density")
    if not density > 0.0:
        raise DeckError(f"{what}: the fluid density must be greater than zero.")
    vectors = []
    for part, kind, quantities in (
        ("gravity", "acceleration", load.gravity),
        ("free-surface point", "length", load.free_surface),
    ):
        x, y, z = (
            si(getattr(quantities, axis), kind, f"{what}: {axis} component of its {part}")
            for axis in "xyz"
        )
        vectors.append((x, y, z))
    if norm(vectors[0]) == 0.0:
        raise DeckError(
            f"{what}: gravity is zero, so the fluid has no depth. Enter the direction and size "
            "of gravity, for example z = -1 g."
        )
    return density, vectors[0], vectors[1]


def _split(piece: _Piece) -> list[_Piece]:
    a, b, c = piece
    ab = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    bc = ((b[0] + c[0]) / 2, (b[1] + c[1]) / 2)
    ca = ((c[0] + a[0]) / 2, (c[1] + a[1]) / 2)
    return [(a, ab, ca), (ab, b, bc), (ca, bc, c), (ab, bc, ca)]


class _Fluid:
    """The fluid's pressure on one element face, integrated into nodal loads."""

    def __init__(
        self, order: int, xyz: list[Vector], sign: float, fluid: tuple[float, Vector, Vector]
    ) -> None:
        self.order, self.xyz, self.sign = order, xyz, sign
        self.density, self.gravity, self.surface = fluid
        self.loads: list[list[float]] = [[0.0, 0.0, 0.0] for _ in xyz]

    def at(self, l1: float, l2: float) -> tuple[list[float], list[float], float]:
        """Shape functions, inward area vector per unit parameter area and the head
        g . (x - s) at (L1, L2)."""
        n, d = _triangle_shape(self.order, l1, l2)
        xyz = self.xyz
        x = [sum(n[k] * xyz[k][i] for k in range(len(xyz))) for i in range(3)]
        t1 = [sum(d[k][0] * xyz[k][i] for k in range(len(xyz))) for i in range(3)]
        t2 = [sum(d[k][1] * xyz[k][i] for k in range(len(xyz))) for i in range(3)]
        area = [self.sign * v for v in cross(t1, t2)]
        head = dot(self.gravity, [x[i] - self.surface[i] for i in range(3)])
        return n, area, head

    def add(self, piece: _Piece) -> None:
        """Adds the piece's nodal loads with the seven-point rule."""
        (a1, a2), (b1, b2), (c1, c2) = piece
        # The piece's share of the reference triangle (both measured the same way).
        scale = abs((a1 - c1) * (b2 - c2) - (b1 - c1) * (a2 - c2))
        for w1, w2, w in _TRIANGLE_RULE:
            w3 = 1.0 - w1 - w2
            n, area, head = self.at(w1 * a1 + w2 * b1 + w3 * c1, w1 * a2 + w2 * b2 + w3 * c2)
            if head <= 0.0:
                continue
            # The reference triangle has area 1/2.
            weight = self.density * head * 0.5 * w * scale
            for k, f in enumerate(self.loads):
                for i in range(3):
                    f[i] += n[k] * weight * area[i]

    def integrate(self) -> None:
        """Adds every wet piece of the face, splitting where the free surface crosses."""
        pieces = [(_WHOLE, 0)]
        while pieces:
            piece, level = pieces.pop()
            # The head is quadratic on a six-node face, so the edge midpoints count too.
            (a1, a2), (b1, b2), (c1, c2) = piece
            samples = [
                (a1, a2),
                (b1, b2),
                (c1, c2),
                ((a1 + b1) / 2, (a2 + b2) / 2),
                ((b1 + c1) / 2, (b2 + c2) / 2),
                ((c1 + a1) / 2, (c2 + a2) / 2),
            ]
            heads = [self.at(l1, l2)[2] for l1, l2 in samples]
            if all(h <= 0.0 for h in heads):
                continue
            if all(h >= 0.0 for h in heads) or level == SPLITS:
                self.add(piece)
            else:
                pieces.extend((part, level + 1) for part in _split(piece))


def hydrostatic_nodal_loads(mesh: VolumeMesh, load: HydrostaticLoad) -> dict[int, Vector]:
    """Nodal forces (N) of ``load`` on its faces, 0-based node -> force; faces must exist.

    DeckError when the faces lie wholly above the free surface, since the load would then do
    nothing (most likely a free-surface point or gravity entered the wrong way round)."""
    fluid = hydrostatic_values(load)
    npe = NODES_PER_ELEMENT[mesh.order]
    p = mesh.positions
    loads: dict[int, list[float]] = {}
    for tag in load.faces:
        for element, local in mesh.faces[tag]:
            base = element * npe
            ids = [mesh.elements[base + k] for k in _triangle_nodes(mesh.order, local)]
            xyz: list[Vector] = [(p[3 * n], p[3 * n + 1], p[3 * n + 2]) for n in ids]
            (opposite,) = set(range(4)) - set(TET_FACES[local])
            o = mesh.elements[base + opposite]
            inside = [p[3 * o + i] - xyz[0][i] for i in range(3)]
            # cross(dx/dL1, dx/dL2) turns the way cross(b - a, c - a) does; point it into the
            # element, on the side of the corner opposite the face.
            corners = cross(
                [xyz[1][i] - xyz[0][i] for i in range(3)], [xyz[2][i] - xyz[0][i] for i in range(3)]
            )
            face = _Fluid(mesh.order, xyz, 1.0 if dot(corners, inside) > 0.0 else -1.0, fluid)
            face.integrate()
            for node, f in zip(ids, face.loads, strict=True):
                t = loads.setdefault(node, [0.0, 0.0, 0.0])
                for i in range(3):
                    t[i] += f[i]
    if not any(c != 0.0 for f in loads.values() for c in f):
        raise DeckError(
            f'Hydrostatic pressure "{load.name}": its faces are all above the free surface, so '
            "it presses nowhere. Check the free-surface point and that gravity points from the "
            "surface into the fluid."
        )
    return {node: (f[0], f[1], f[2]) for node, f in sorted(loads.items())}
