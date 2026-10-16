# SPDX-License-Identifier: AGPL-3.0-or-later
"""Heat flows of a steady-state thermal run and its heat balance (M5.3). Physics-critical.

Each thermal load's heat flow into the body is worked out node by node, the way CalculiX
applies it (each was checked against ccx 2.21's nodal heat flows, RFL, at free nodes, to its
printed digits):

- a heat flux and, at the solved temperatures, a convection and a radiation: the local heat
  flow into the body times each node's shape function, integrated over the element faces with
  CalculiX's rule for a distributed load on a triangle (three points for a six-node face, as
  for a pressure, loads/pressure.py; one point, the centroid, for a three-node face);
- a heat generation: its power per volume times each node's shape function, integrated over
  the elements of its bodies with the rule of a body load (loads/body.py);
- a fixed temperature: CalculiX's RFL at the nodes it holds, which is the heat the fixed
  temperature supplies plus every load's heat applied there (an edge it shares with a heat flux
  or a convection, a heat generation in the elements around it), so those are taken back out,
  as for a structural reaction (ADR-051). A node two fixed temperatures hold (at the same
  temperature, loads/heat.py) counts for the first of them in spec order.

The convection and radiation use the temperatures CalculiX prints to seven digits for their
nodes (deck EXCHANGE_SET); the .frd file keeps five, which is 0.005 K at 1000 K and would show
as an imbalance where a face is close to its ambient.

The balance: heat in is the sum of the loads' heat flows into the body, heat out the sum of
those out of it. Their difference is measured against half the loads' gross heat flow, the
sum of the sizes of the local heat flows (at each integration point for a load integrated over
faces or bodies, at each node for a fixed temperature), which is the heat in when no load both
heats and cools: a convection that heats part of a face and cools the rest still has its own
size, the trap the structural balance check met with self-cancelling pressures (M3.2). With
no heat flowing at all, the scale is a floor far below any real heat flow (balance_floor).
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from ..deck import EXCHANGE_SET, HEAT_SET
from ..deck.common import si
from ..deck.generator import STEFAN_BOLTZMANN
from ..deck.linalg import cross, norm
from ..deck.loads import pressure_faces
from ..deck.loads.body import BodyLoad, body_load_resultant, body_nodal_forces
from ..deck.loads.force import _triangle_nodes, _triangle_shape
from ..deck.loads.heat import conductivities, convections, fixed_temperatures, radiations
from ..deck.loads.pressure import _LOCAL_FACE, _RULE
from ..meshing.volume import NODES_PER_ELEMENT, VolumeMesh
from ..spec.simulation_schema import (
    ConvectionLoad,
    FixedTemperatureLoad,
    HeatFluxLoad,
    HeatGenerationLoad,
    RadiationLoad,
    SimulationSpec,
)
from .dat import read_node_heat_flows, read_node_temperatures

#: The thermal loads, which have a heat flow.
THERMAL_LOADS = (
    FixedTemperatureLoad,
    HeatFluxLoad,
    ConvectionLoad,
    RadiationLoad,
    HeatGenerationLoad,
)

#: CalculiX's one-point rule for a distributed load on a three-node triangle: (L1, L2, weight).
_CENTROID: tuple[tuple[float, float, float], ...] = ((1 / 3, 1 / 3, 1.0),)


@dataclass(frozen=True)
class HeatFlow:
    """One thermal load's heat flow into the body (W, negative out), the heat it applies at
    each node (0-based node -> W), and its gross size (W, see the module's docstring)."""

    heat: float
    nodal: dict[int, float]
    gross: float


def _face_flows(
    mesh: VolumeMesh,
    pairs: list[tuple[int, int]],
    local: Callable[[float], float],
    temperature: Callable[[int], float],
) -> HeatFlow:
    """The heat flow into the body over the (element, CalculiX face number) ``pairs`` of a
    load whose heat flow per area into the body at a temperature T is ``local(T)``."""
    npe = NODES_PER_ELEMENT[mesh.order]
    p = mesh.positions
    rule = [(w, *_triangle_shape(mesh.order, l1, l2)) for l1, l2, w in _rules(mesh.order)]
    nodal: dict[int, float] = {}
    total, gross = 0.0, 0.0
    for element, face in pairs:
        ids = [
            mesh.elements[element * npe + k] for k in _triangle_nodes(mesh.order, _LOCAL_FACE[face])
        ]
        xyz = [(p[3 * n], p[3 * n + 1], p[3 * n + 2]) for n in ids]
        t = [temperature(n) for n in ids]
        for w, n, d in rule:
            t1 = [sum(d[k][0] * xyz[k][i] for k in range(len(ids))) for i in range(3)]
            t2 = [sum(d[k][1] * xyz[k][i] for k in range(len(ids))) for i in range(3)]
            # The reference triangle has area 1/2.
            area = 0.5 * w * norm(cross(t1, t2))
            q = local(sum(n[k] * t[k] for k in range(len(ids)))) * area
            total += q
            gross += abs(q)
            for k, node in enumerate(ids):
                nodal[node] = nodal.get(node, 0.0) + n[k] * q
    return HeatFlow(total, nodal, gross)


def _rules(order: int) -> tuple[tuple[float, float, float], ...]:
    return _RULE if order == 2 else _CENTROID


def _generation(mesh: VolumeMesh, power: dict[int, float], nodes: set[int]) -> HeatFlow:
    """A heat generation of ``power`` W/m³ in each body tag: its total (the power times the
    volume, integrated as the solver does) and its heat at ``nodes``."""
    unit = BodyLoad((1.0, 0.0, 0.0))
    force, _, gross = body_load_resultant(mesh, power, unit)
    nodal = {n: f[0] for n, f in body_nodal_forces(mesh, power, unit, nodes).items()}
    return HeatFlow(force[0], nodal, gross)


def read_heat_flows(
    spec: SimulationSpec, mesh: VolumeMesh, temperature: Sequence[float], dat: Path
) -> list[HeatFlow]:
    """The heat flow of each thermal load of ``spec``, in spec order, from the solved nodal
    temperatures (``temperature[n]``, K, from the .frd file) and the .dat file of a deck made
    from ``spec`` and ``mesh``. The nodal heat of a heat generation is given only at the nodes
    fixed temperatures hold, which is all the balance needs."""
    loads = [x for x in spec.loads if isinstance(x, THERMAL_LOADS)]
    held = fixed_temperatures(spec, mesh)
    films = {id(x.load): x for x in convections(spec, mesh)}
    radiates = {id(x.load): x for x in radiations(spec, mesh)}
    precise = read_node_temperatures(dat, EXCHANGE_SET) if films or radiates else {}

    def at(node: int) -> float:
        value = precise.get(node)
        return value if value is not None else temperature[node]

    held_nodes = {n for item in held for n in item.nodes}
    flows: dict[int, HeatFlow] = {}
    for k, load in enumerate(loads):
        if isinstance(load, HeatFluxLoad):
            value = si(load.flux, "heatFlux", f'Heat flux "{load.name}"')
            pairs = pressure_faces(mesh, load.faces)
            flows[k] = _face_flows(mesh, pairs, lambda _t, q=value: q, at)
        elif isinstance(load, ConvectionLoad):
            item = films[id(load)]
            flows[k] = _face_flows(
                mesh,
                item.faces,
                lambda t, h=item.value, ambient=item.ambient: h * (ambient - t),
                at,
            )
        elif isinstance(load, RadiationLoad):
            item = radiates[id(load)]
            flows[k] = _face_flows(
                mesh,
                item.faces,
                lambda t, e=item.value, ambient=item.ambient: (
                    e * STEFAN_BOLTZMANN * (ambient**4 - t**4)
                ),
                at,
            )
        elif isinstance(load, HeatGenerationLoad):
            value = si(load.power, "heatGeneration", f'Heat generation "{load.name}"')
            power = {tag: value for tag in load.bodies}
            flows[k] = _generation(mesh, power, held_nodes)

    reactions: dict[int, dict[int, float]] = {}
    if held:
        rfl = read_node_heat_flows(dat, HEAT_SET)
        applied: dict[int, float] = {}
        for flow in flows.values():
            for node, q in flow.nodal.items():
                if node in held_nodes:
                    applied[node] = applied.get(node, 0.0) + q
        owner: dict[int, int] = {}
        for item in held:
            index = next(k for k, x in enumerate(loads) if x is item.load)
            for node in item.nodes:
                owner.setdefault(node, index)
        for node, index in owner.items():
            if node not in rfl:
                raise ValueError(f"The solver gave no heat flow for node {node + 1}.")
            reactions.setdefault(index, {})[node] = rfl[node] - applied.get(node, 0.0)
        for item in held:
            index = next(k for k, x in enumerate(loads) if x is item.load)
            nodal = reactions.get(index, {})
            flows[index] = HeatFlow(sum(nodal.values()), nodal, sum(abs(q) for q in nodal.values()))
    return [flows[k] for k in range(len(loads))]


def heat_balance(flows: list[HeatFlow], floor: float) -> dict[str, float]:
    """Heat in against heat out (W) and their difference as a fraction of half the loads'
    gross heat flow (the module's docstring), or of ``floor`` (W) when that is larger: with
    no heat flowing at all (every face of a body at one fixed temperature), what is left is
    the solver's rounding, which must not be measured against itself."""
    heat_in = sum(f.heat for f in flows if f.heat > 0.0)
    heat_out = -sum(f.heat for f in flows if f.heat < 0.0)
    scale = max(0.5 * sum(f.gross for f in flows), floor)
    return {
        "heatIn": heat_in,
        "heatOut": heat_out,
        "scale": scale,
        "ratio": abs(heat_in - heat_out) / scale if scale > 0.0 else 0.0,
    }


def balance_floor(spec: SimulationSpec, mesh: VolumeMesh, temperature: Sequence[float]) -> float:
    """The smallest scale the heat balance is measured against (W): 1e-12 of the heat a
    conductivity k carries across the model's size L at its highest absolute temperature T,
    k T L, about what rounding leaves in CalculiX's nodal heat flows (1e-13 W for k = 50
    W/(m·K), T = 373 K, L = 1 cm, ratio 4e-16), and far below any heat flow worth showing."""
    k = max(conductivities(spec, mesh).values(), default=0.0)
    p = mesh.positions
    lo = [min(p[i::3]) for i in range(3)]
    hi = [max(p[i::3]) for i in range(3)]
    size = sum((hi[i] - lo[i]) ** 2 for i in range(3)) ** 0.5
    return 1e-12 * k * max(temperature, default=0.0) * size
