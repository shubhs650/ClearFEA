# SPDX-License-Identifier: AGPL-3.0-or-later
"""Gravity and centrifugal load: body forces on every element (*DLOAD GRAV and CENTRIF, M2.3).

CalculiX turns a body load into nodal forces itself. Its reaction output (RF) at a held node
is the reaction plus the load applied at that node (manual section 6.11.5), so the result
reader needs the same nodal forces to take the load back out. This module computes them the
way CalculiX does: the body force density rho * a(x) times each shape function, integrated
with the element's own rule (C3D4: one point; C3D10: four points). worker/spikes/load_check
checks the result node by node against CalculiX's own on curved meshes.

The acceleration field is a(x) = g + omega^2 * r(x), with r(x) the distance vector from the
rotation axis to x, at right angles to the axis.
"""

import math
from collections.abc import Iterable
from dataclasses import dataclass

from ...meshing.volume import NODES_PER_ELEMENT, VolumeMesh
from ...spec.simulation_schema import CentrifugalLoad, GravityLoad, SimulationSpec
from ..common import DeckError, si
from ..elements import CCX_NODE_ORDER
from ..linalg import Vector, norm

#: CalculiX's integration rule for each element order: (r, s, t, weight). The four-point rule
#: for C3D10 has a = (5 + 3 sqrt 5) / 20 and b = (5 - sqrt 5) / 20.
_A = 0.5854101966249685
_B = 0.1381966011250105
RULES: dict[int, tuple[tuple[float, float, float, float], ...]] = {
    1: ((0.25, 0.25, 0.25, 1.0 / 6.0),),
    2: (
        (_B, _B, _B, 1.0 / 24.0),
        (_A, _B, _B, 1.0 / 24.0),
        (_B, _A, _B, 1.0 / 24.0),
        (_B, _B, _A, 1.0 / 24.0),
    ),
}


def shape(order: int, r: float, s: float, t: float) -> tuple[list[float], list[Vector]]:
    """Shape functions and their (r, s, t) derivatives in CalculiX's node order (manual
    section 6.2.6 and 6.2.7): corners 1-4 at the origin, r = 1, s = 1, t = 1, then mid-edge
    nodes on edges 1-2, 2-3, 3-1, 1-4, 2-4, 3-4."""
    u = 1.0 - r - s - t
    if order == 1:
        return [u, r, s, t], [(-1.0, -1.0, -1.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)]
    n = [
        u * (2 * u - 1),
        r * (2 * r - 1),
        s * (2 * s - 1),
        t * (2 * t - 1),
        4 * u * r,
        4 * r * s,
        4 * s * u,
        4 * u * t,
        4 * r * t,
        4 * s * t,
    ]
    du = 1 - 4 * u  # d(u(2u - 1))/du times du/dr = -1
    d = [
        (du, du, du),
        (4 * r - 1, 0.0, 0.0),
        (0.0, 4 * s - 1, 0.0),
        (0.0, 0.0, 4 * t - 1),
        (4 * (u - r), -4 * r, -4 * r),
        (4 * s, 4 * r, 0.0),
        (-4 * s, 4 * (u - s), -4 * s),
        (-4 * t, -4 * t, 4 * (u - t)),
        (4 * t, 0.0, 4 * r),
        (0.0, 4 * t, 4 * s),
    ]
    return n, d


@dataclass(frozen=True)
class BodyLoad:
    """The acceleration field of all gravity and centrifugal loads of a setup, in SI.

    ``gravity`` in m/s^2; ``omega2`` the square of the angular velocity in rad^2/s^2 (0 when
    there is no centrifugal load), about the axis through ``point`` (m) along unit ``axis``.
    """

    gravity: Vector
    omega2: float = 0.0
    point: Vector = (0.0, 0.0, 0.0)
    axis: Vector = (0.0, 0.0, 1.0)

    def acceleration(self, x: Vector) -> Vector:
        g = self.gravity
        if self.omega2 == 0.0:
            return g
        d = [x[i] - self.point[i] for i in range(3)]
        along = sum(d[i] * self.axis[i] for i in range(3))
        return (
            g[0] + self.omega2 * (d[0] - along * self.axis[0]),
            g[1] + self.omega2 * (d[1] - along * self.axis[1]),
            g[2] + self.omega2 * (d[2] - along * self.axis[2]),
        )


def gravity_vector(load: GravityLoad) -> Vector:
    """The load's acceleration in m/s^2; DeckError when a component is missing."""
    what = f'Gravity "{load.name}"'
    x, y, z = (
        si(component, "acceleration", f"{what}: {axis} component")
        for axis, component in zip("xyz", (load.x, load.y, load.z), strict=True)
    )
    return (x, y, z)


@dataclass(frozen=True)
class Rotation:
    """A centrifugal load in SI: angular velocity (rad/s), a point on the axis (m) and the
    axis's unit direction."""

    omega: float
    point: Vector
    axis: Vector


def rotation(load: CentrifugalLoad) -> Rotation:
    """The load in SI; DeckError when a value is missing or the direction is zero."""
    what = f'Centrifugal load "{load.name}"'
    omega = si(load.angular_velocity, "angularVelocity", f"{what}: angular velocity")
    p = load.axis_point
    point = tuple(
        si(c, "length", f"{what}: {axis} coordinate of the point on the axis")
        for axis, c in zip("xyz", (p.x, p.y, p.z), strict=True)
    )
    d = load.axis_direction
    direction = (d.x, d.y, d.z)
    for axis, c in zip("xyz", direction, strict=True):
        if c is None:
            raise DeckError(f"{what}: the {axis} component of the axis direction has no value.")
    length = norm([c for c in direction if c is not None])
    if not (length > 0.0 and math.isfinite(length)):
        raise DeckError(f"{what}: the axis direction is zero. Give the axis a direction.")
    unit = tuple(c / length for c in direction if c is not None)
    return Rotation(omega, (point[0], point[1], point[2]), (unit[0], unit[1], unit[2]))


def body_loads(spec: SimulationSpec) -> tuple[Vector | None, Rotation | None]:
    """The setup's gravity loads added up (None without any) and its centrifugal load (None
    without one). DeckError for a second centrifugal load: CalculiX allows one per element set."""
    gravity: list[float] | None = None
    spin: Rotation | None = None
    for load in spec.loads:
        if isinstance(load, GravityLoad):
            g = gravity_vector(load)
            gravity = [(gravity or [0.0] * 3)[i] + g[i] for i in range(3)]
        elif isinstance(load, CentrifugalLoad):
            if spin is not None:
                raise DeckError(
                    f'Centrifugal load "{load.name}" is a second one. A setup can have one '
                    "centrifugal load; delete the other."
                )
            spin = rotation(load)
    return (None if gravity is None else (gravity[0], gravity[1], gravity[2])), spin


def densities(
    spec: SimulationSpec, mesh: VolumeMesh, need: str = "Gravity and centrifugal loads need it"
) -> dict[int, float]:
    """Density (kg/m^3) of every body of the mesh; DeckError for a material without one,
    saying what ``need``s it."""
    material = {m.id: m for m in spec.materials}
    assigned = {b.tag: b.material for b in spec.bodies}
    out = {}
    for tag in sorted(mesh.bodies):
        m = material.get(assigned.get(tag) or "")
        if m is None:
            raise DeckError(f"Body {tag} has no material. Assign a material to it.")
        what = f'Material "{m.name}"'
        if m.density is None:
            raise DeckError(f"{what} has no density. {need}; enter it.")
        value = si(m.density, "density", f"{what}: density")
        if not value > 0.0:
            raise DeckError(f"{what}: the density must be greater than zero.")
        out[tag] = value
    return out


def body_load(spec: SimulationSpec) -> BodyLoad | None:
    """The acceleration field of all body loads of the setup, or None when it has none."""
    gravity, spin = body_loads(spec)
    if gravity is None and spin is None:
        return None
    g = gravity or (0.0, 0.0, 0.0)
    if spin is None:
        return BodyLoad(g)
    return BodyLoad(g, spin.omega**2, spin.point, spin.axis)


def body_nodal_forces(
    mesh: VolumeMesh,
    density: dict[int, float],
    load: BodyLoad,
    nodes: Iterable[int] | None = None,
) -> dict[int, Vector]:
    """Nodal forces (N) of ``load`` on bodies of density ``density`` (body tag -> kg/m^3).

    With ``nodes``, only those nodes' forces are computed (from the elements that use them),
    which is all the result reader needs and much less work on a large mesh.
    """
    npe = NODES_PER_ELEMENT[mesh.order]
    order = CCX_NODE_ORDER[mesh.order]
    wanted = None if nodes is None else set(nodes)
    rule = [(w, *shape(mesh.order, r, s, t)) for r, s, t, w in RULES[mesh.order]]
    p = mesh.positions
    out: dict[int, list[float]] = {}
    for tag, (first, count) in sorted(mesh.bodies.items()):
        rho = density.get(tag, 0.0)
        if rho == 0.0:
            continue
        for e in range(first, first + count):
            ids = [mesh.elements[e * npe + k] for k in order]
            if wanted is not None and wanted.isdisjoint(ids):
                continue
            xyz = [(p[3 * n], p[3 * n + 1], p[3 * n + 2]) for n in ids]
            for weight, n, d in rule:
                j = [
                    [sum(d[k][c] * xyz[k][row] for k in range(npe)) for c in range(3)]
                    for row in range(3)
                ]
                det = (
                    j[0][0] * (j[1][1] * j[2][2] - j[1][2] * j[2][1])
                    - j[0][1] * (j[1][0] * j[2][2] - j[1][2] * j[2][0])
                    + j[0][2] * (j[1][0] * j[2][1] - j[1][1] * j[2][0])
                )
                x = tuple(sum(n[k] * xyz[k][i] for k in range(npe)) for i in range(3))
                a = load.acceleration((x[0], x[1], x[2]))
                scale = rho * weight * abs(det)
                for k, node in enumerate(ids):
                    if wanted is not None and node not in wanted:
                        continue
                    f = out.setdefault(node, [0.0, 0.0, 0.0])
                    for i in range(3):
                        f[i] += n[k] * scale * a[i]
    return {node: (f[0], f[1], f[2]) for node, f in sorted(out.items())}


def body_load_resultant(
    mesh: VolumeMesh, density: dict[int, float], load: BodyLoad
) -> tuple[Vector, Vector, float]:
    """Total force (N) and its moment about the origin (N·m) of ``load``: the sum of
    body_nodal_forces and of their moments, integrated directly (the shape functions add up
    to one and interpolate the position, so the two are the same, with less work); and its
    gross size, the sum of the sizes of the integration points' forces (N)."""
    npe = NODES_PER_ELEMENT[mesh.order]
    order = CCX_NODE_ORDER[mesh.order]
    rule = [(w, *shape(mesh.order, r, s, t)) for r, s, t, w in RULES[mesh.order]]
    p = mesh.positions
    force = [0.0, 0.0, 0.0]
    moment = [0.0, 0.0, 0.0]
    gross = 0.0
    for tag, (first, count) in sorted(mesh.bodies.items()):
        rho = density.get(tag, 0.0)
        if rho == 0.0:
            continue
        for e in range(first, first + count):
            ids = [mesh.elements[e * npe + k] for k in order]
            xyz = [(p[3 * n], p[3 * n + 1], p[3 * n + 2]) for n in ids]
            for weight, n, d in rule:
                j = [
                    [sum(d[k][c] * xyz[k][row] for k in range(npe)) for c in range(3)]
                    for row in range(3)
                ]
                det = (
                    j[0][0] * (j[1][1] * j[2][2] - j[1][2] * j[2][1])
                    - j[0][1] * (j[1][0] * j[2][2] - j[1][2] * j[2][0])
                    + j[0][2] * (j[1][0] * j[2][1] - j[1][1] * j[2][0])
                )
                x = tuple(sum(n[k] * xyz[k][i] for k in range(npe)) for i in range(3))
                a = load.acceleration((x[0], x[1], x[2]))
                scale = rho * weight * abs(det)
                f = (scale * a[0], scale * a[1], scale * a[2])
                gross += norm(f)
                for i in range(3):
                    force[i] += f[i]
                moment[0] += x[1] * f[2] - x[2] * f[1]
                moment[1] += x[2] * f[0] - x[0] * f[2]
                moment[2] += x[0] * f[1] - x[1] * f[0]
    return (force[0], force[1], force[2]), (moment[0], moment[1], moment[2]), gross
