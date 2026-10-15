# SPDX-License-Identifier: AGPL-3.0-or-later
"""Remote force and moment: a load at a reference point carried to faces (*CLOAD, M2.4).

The force F and moment M act at the reference point P. On the faces they become the linear
traction that is statically equivalent to them and spread as evenly as it can be, the way a
deformable (distributing) coupling with weights by area carries a load:

    t(x) = F / A + alpha x (x - c),    J alpha = M + (P - c) x F

with A the faces' area, c their centroid and J = integral of (|r|² I - r r^T) dA, r = x - c,
the faces' polar second moment of area about c. The constant part sums to F and has no
moment about c; the linear part sums to nothing and has the moment J alpha about c. So the
traction has the force F and, about P, the moment M.

Its consistent nodal loads are the integral of each node's shape function times t over the
element faces, with the same seven-point rule as a force on faces (force.py). Because the
rule's points sit where the shape functions put them, the nodal loads have exactly the
traction's force and moment as the rule sums them, to rounding: they add up to F and their
moment about P is M. The faces deform freely; no reference node or extra stiffness is added.
"""

from ...meshing.volume import VolumeMesh
from ...spec.simulation_schema import RemoteLoad
from ..common import DeckError, si
from ..linalg import Vector, cross, solve
from .force import face_points


def remote_vectors(load: RemoteLoad) -> tuple[Vector, Vector, Vector]:
    """The reference point (m), force (N) and moment (N·m); DeckError when a value is missing."""
    what = f'Remote load "{load.name}"'
    out = []
    for part, kind, quantities in (
        ("reference point", "length", load.point),
        ("force", "force", load.force),
        ("moment", "moment", load.moment),
    ):
        x, y, z = (
            si(getattr(quantities, axis), kind, f"{what}: {axis} component of its {part}")
            for axis in "xyz"
        )
        out.append((x, y, z))
    return out[0], out[1], out[2]


def remote_nodal_loads(mesh: VolumeMesh, load: RemoteLoad) -> dict[int, Vector]:
    """Nodal forces (N) of ``load`` on its faces, 0-based node -> force; faces must exist."""
    point, force, moment = remote_vectors(load)
    points = list(face_points(mesh, load.faces))
    area = sum(da for _, _, da, _ in points)
    if not area > 0.0:
        raise DeckError(
            f'Remote load "{load.name}": its faces have no area in the mesh. Mesh the '
            "simulation again."
        )
    c = [sum(da * x[i] for _, _, da, x in points) / area for i in range(3)]
    j = [[0.0] * 3 for _ in range(3)]
    for _, _, da, x in points:
        r = [x[i] - c[i] for i in range(3)]
        rr = sum(v * v for v in r)
        for a in range(3):
            for b in range(3):
                j[a][b] += da * ((rr if a == b else 0.0) - r[a] * r[b])
    arm = cross([point[i] - c[i] for i in range(3)], force)
    alpha = solve(j, [moment[i] + arm[i] for i in range(3)])
    uniform = [force[i] / area for i in range(3)]
    loads: dict[int, list[float]] = {}
    for ids, n, da, x in points:
        turn = cross(alpha, [x[i] - c[i] for i in range(3)])
        t = [uniform[i] + turn[i] for i in range(3)]
        for k, node in enumerate(ids):
            f = loads.setdefault(node, [0.0, 0.0, 0.0])
            for i in range(3):
                f[i] += n[k] * da * t[i]
    return {node: (f[0], f[1], f[2]) for node, f in sorted(loads.items())}
