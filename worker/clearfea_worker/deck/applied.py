# SPDX-License-Identifier: AGPL-3.0-or-later
"""The nodal loads the solver applies, for taking them back out of its reaction output (M2.3).

Physics-critical. CalculiX's RF at a held node is the reaction plus the load applied at that
node (manual section 6.11.5), so the result reader subtracts the loads this module computes:
forces on faces, remote loads and hydrostatic pressures exactly as the deck writes them
(*CLOAD), and uniform pressures (loads/pressure.py) and gravity and centrifugal loads
(loads/body.py) the way CalculiX integrates them. The same nodal loads, added up over the
whole mesh, give each load's total force and moment for the balance check (M3.2, ADR-051).
"""

from collections.abc import Iterable
from dataclasses import dataclass

from ..meshing.volume import VolumeMesh
from ..spec.simulation_schema import (
    CentrifugalLoad,
    ForceLoad,
    GravityLoad,
    HydrostaticLoad,
    PressureLoad,
    RemoteLoad,
    SimulationSpec,
)
from .common import si
from .linalg import Vector, cross, norm
from .loads import (
    BodyLoad,
    body_load,
    body_load_resultant,
    body_nodal_forces,
    densities,
    element_face_pressures,
    force_nodal_loads,
    hydrostatic_nodal_loads,
    pressure_faces,
    pressure_nodal_loads,
    remote_nodal_loads,
)
from .loads.body import gravity_vector, rotation

#: Nodal force components below this fraction of the largest are rounding and set to zero.
ROUNDING = 1e-12


def force_loads(spec: SimulationSpec, mesh: VolumeMesh) -> dict[int, Vector]:
    """The *CLOAD of every node with a force on it, all force, remote and hydrostatic loads
    added up, in node order."""
    total: dict[int, list[float]] = {}
    for load in spec.loads:
        if isinstance(load, ForceLoad):
            nodal = force_nodal_loads(mesh, load)
        elif isinstance(load, RemoteLoad):
            nodal = remote_nodal_loads(mesh, load)
        elif isinstance(load, HydrostaticLoad):
            nodal = hydrostatic_nodal_loads(mesh, load)
        else:
            continue
        for node, f in nodal.items():
            t = total.setdefault(node, [0.0, 0.0, 0.0])
            for i in range(3):
                t[i] += f[i]
    # A flat six-node triangle's corners carry nothing; the integration leaves about 1e-16 of
    # the force there, which is written as zero.
    size = max((abs(c) for f in total.values() for c in f), default=0.0)
    for f in total.values():
        for i in range(3):
            if abs(f[i]) <= ROUNDING * size:
                f[i] = 0.0
    return {node: (f[0], f[1], f[2]) for node, f in sorted(total.items()) if any(f)}


def applied_nodal_loads(
    spec: SimulationSpec, mesh: VolumeMesh, nodes: Iterable[int]
) -> dict[int, Vector]:
    """Every load applied at ``nodes`` (0-based node -> N); nodes without load are left out."""
    wanted = set(nodes)
    out = {n: list(f) for n, f in force_loads(spec, mesh).items() if n in wanted}
    pressures = element_face_pressures(spec, mesh)
    for n, f in pressure_nodal_loads(mesh, pressures).items():
        if n in wanted:
            t = out.setdefault(n, [0.0, 0.0, 0.0])
            for i in range(3):
                t[i] += f[i]
    load = body_load(spec)
    if load is not None:
        for n, f in body_nodal_forces(mesh, densities(spec, mesh), load, wanted).items():
            t = out.setdefault(n, [0.0, 0.0, 0.0])
            for i in range(3):
                t[i] += f[i]
    return {n: (f[0], f[1], f[2]) for n, f in sorted(out.items())}


@dataclass(frozen=True)
class Resultant:
    """A load's total force (N), its moment about the origin (N·m), and its gross size (N):
    the sum of the sizes of its nodal forces (of its integration points' forces for a body
    load), which stays the load's size when the load cancels itself, as a pressure all
    round a bore does."""

    force: Vector
    moment: Vector
    gross: float


NO_LOAD = Resultant((0.0, 0.0, 0.0), (0.0, 0.0, 0.0), 0.0)


def _nodal_resultant(mesh: VolumeMesh, loads: dict[int, Vector]) -> Resultant:
    """The total of nodal forces, their moment about the origin and their gross size."""
    force = [0.0, 0.0, 0.0]
    moment = [0.0, 0.0, 0.0]
    gross = 0.0
    p = mesh.positions
    for node, f in loads.items():
        m = cross((p[3 * node], p[3 * node + 1], p[3 * node + 2]), f)
        for i in range(3):
            force[i] += f[i]
            moment[i] += m[i]
        gross += norm(f)
    return Resultant((force[0], force[1], force[2]), (moment[0], moment[1], moment[2]), gross)


def load_resultants(spec: SimulationSpec, mesh: VolumeMesh) -> list[Resultant]:
    """Each load's total force (N), its moment about the origin (N·m) and its gross size, in
    spec order, as the solver applies it: the nodal loads above added up over the mesh. A
    temperature change applies none. DeckError when a load lacks a value."""
    out: list[Resultant] = []
    rho: dict[int, float] | None = None
    for load in spec.loads:
        if isinstance(load, PressureLoad):
            value = si(load.magnitude, "pressure", f"{load.name}: magnitude")
            pressures: dict[tuple[int, int], float] = {}
            for key in pressure_faces(mesh, load.faces):
                pressures[key] = pressures.get(key, 0.0) + value
            out.append(_nodal_resultant(mesh, pressure_nodal_loads(mesh, pressures)))
        elif isinstance(load, ForceLoad):
            out.append(_nodal_resultant(mesh, force_nodal_loads(mesh, load)))
        elif isinstance(load, RemoteLoad):
            out.append(_nodal_resultant(mesh, remote_nodal_loads(mesh, load)))
        elif isinstance(load, HydrostaticLoad):
            out.append(_nodal_resultant(mesh, hydrostatic_nodal_loads(mesh, load)))
        elif isinstance(load, (GravityLoad, CentrifugalLoad)):
            if isinstance(load, GravityLoad):
                field = BodyLoad(gravity_vector(load))
            else:
                r = rotation(load)
                field = BodyLoad((0.0, 0.0, 0.0), r.omega**2, r.point, r.axis)
            if rho is None:
                rho = densities(spec, mesh)
            out.append(Resultant(*body_load_resultant(mesh, rho, field)))
        else:
            out.append(NO_LOAD)
    return out
