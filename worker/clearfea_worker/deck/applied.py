# SPDX-License-Identifier: AGPL-3.0-or-later
"""The nodal loads the solver applies, for taking them back out of its reaction output (M2.3).

Physics-critical. CalculiX's RF at a held node is the reaction plus the load applied at that
node (manual section 6.11.5), so the result reader subtracts the loads this module computes:
forces on faces, remote loads and hydrostatic pressures exactly as the deck writes them
(*CLOAD) and gravity and centrifugal loads the way CalculiX integrates them (loads/body.py).
Uniform pressures are not included yet: a pressure on a held node still shows in its
support's reaction (ADR-029, M3.2).
"""

from collections.abc import Iterable

from ..meshing.volume import VolumeMesh
from ..spec.simulation_schema import ForceLoad, HydrostaticLoad, RemoteLoad, SimulationSpec
from .linalg import Vector
from .loads import (
    body_load,
    body_nodal_forces,
    densities,
    force_nodal_loads,
    hydrostatic_nodal_loads,
    remote_nodal_loads,
)

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
    """Force and body loads at ``nodes`` (0-based node -> N); nodes without load are left out."""
    wanted = set(nodes)
    out = {n: list(f) for n, f in force_loads(spec, mesh).items() if n in wanted}
    load = body_load(spec)
    if load is not None:
        for n, f in body_nodal_forces(mesh, densities(spec, mesh), load, wanted).items():
            t = out.setdefault(n, [0.0, 0.0, 0.0])
            for i in range(3):
                t[i] += f[i]
    return {n: (f[0], f[1], f[2]) for n, f in sorted(out.items())}
