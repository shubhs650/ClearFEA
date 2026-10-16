# SPDX-License-Identifier: AGPL-3.0-or-later
"""The solve job's result summary (ADR-030, ADR-051). Physics-critical.

Largest displacement magnitude, smallest and largest von Mises stress and (M3.5) the smallest
safety factor against yield with the node and position where each occurs, the reaction force
and moment of every support, each load's total force and moment, and the balance check of the
two. For a steady-state thermal run, the smallest and largest temperature (M5.1), the largest
heat flux, each thermal load's heat flow and the heat balance (M5.3, results.heat); a thermal
stress run has both (M5.4). A modal run has its natural frequencies (M6.1, results.modal);
its mode shapes are fields (M6.2).
SI throughout.
"""

import math
from array import array
from dataclasses import dataclass, replace
from pathlib import Path

from ..deck import REACTION_SET, TIE_SET, support_set_names
from ..deck.applied import Resultant, applied_nodal_loads, load_resultants
from ..deck.constraints import holds, node_constraints, node_frames, support_node_reactions
from ..deck.linalg import Vector, cross, norm
from ..deck.loads import elastic_springs, faces_centroid, spring_forces
from ..deck.loads.tie import tie_forces, ties
from ..meshing.volume import VolumeMesh
from ..spec.simulation_schema import ElasticSupport, SimulationSpec, SolveResult
from .dat import DatError, read_node_displacements, read_node_forces
from .fields import (
    NodalFields,
    ThermalFields,
    displacement_magnitude,
    heat_flux_magnitude,
    read_fields,
    read_thermal_fields,
    von_mises_field,
)
from .heat import THERMAL_LOADS, HeatFlow, balance_floor, heat_balance, read_heat_flows
from .modal import ModalFields, frequency, read_eigenvalues, read_mode_shapes
from .safety import safety_factor_field


@dataclass(frozen=True)
class Reaction:
    """One support's reaction: total force (N), its moment (N·m) about ``point`` (m), the area
    centroid of the support's faces, its moment about the origin for the balance check, and
    the sum of the sizes of its nodal forces (N), which the balance check is measured against
    when no load is applied (M5.4)."""

    force: Vector
    moment: Vector
    point: Vector
    origin_moment: Vector
    gross: float = 0.0


def _at(mesh: VolumeMesh, field: array, node: int) -> dict[str, object]:
    return {
        "value": field[node],
        "node": node,
        "position": list(mesh.positions[3 * node : 3 * node + 3]),
    }


def _argmax(field: array) -> int:
    # First occurrence of the largest value, so the answer does not depend on float noise order.
    return max(range(len(field)), key=field.__getitem__)


def _argmin(field: array) -> int:
    return min(range(len(field)), key=field.__getitem__)


def _diagonal(mesh: VolumeMesh) -> float:
    p = mesh.positions
    lo = [min(p[i::3]) for i in range(3)]
    hi = [max(p[i::3]) for i in range(3)]
    return math.dist(lo, hi)


def balance(
    mesh: VolumeMesh, loads: list[Resultant], reactions: list[Reaction]
) -> dict[str, object]:
    """The balance check (ADR-051): applied loads against reactions, both about the origin.

    The imbalance is measured against the larger of the loads' gross size (the sum of the
    sizes of their nodal forces, so a load that cancels itself, like a pressure all round a
    bore, is still measured against its own size) and the sum of the reactions' sizes (a
    temperature change or a prescribed displacement applies no load, and its reactions must
    balance each other, as in the verification harness, ADR-039); its moment also against
    that force times the model's size, so a load through the origin does not leave the
    moment measured against nothing. With no load at all, the reactions' sizes are those of
    their nodal forces: a body heated on one fixed support pushes on it at every node while
    the total is zero, which would otherwise measure the rounding against itself (ADR-067).
    """
    applied_f = [sum(load.force[i] for load in loads) for i in range(3)]
    applied_m = [sum(load.moment[i] for load in loads) for i in range(3)]
    reaction_f = [sum(r.force[i] for r in reactions) for i in range(3)]
    reaction_m = [sum(r.origin_moment[i] for r in reactions) for i in range(3)]
    applied = sum(load.gross for load in loads)
    held = sum(max(r.gross, norm(r.force)) if applied == 0.0 else norm(r.force) for r in reactions)
    force_scale = max(applied, held)
    moment_scale = max(
        norm(applied_m),
        sum(norm(r.origin_moment) for r in reactions),
        force_scale * _diagonal(mesh),
    )
    miss_f = norm([applied_f[i] + reaction_f[i] for i in range(3)])
    miss_m = norm([applied_m[i] + reaction_m[i] for i in range(3)])
    return {
        "appliedForce": applied_f,
        "appliedMoment": applied_m,
        "reactionForce": reaction_f,
        "reactionMoment": reaction_m,
        "forceScale": force_scale,
        "momentScale": moment_scale,
        "forceRatio": miss_f / force_scale if force_scale > 0.0 else 0.0,
        "momentRatio": miss_m / moment_scale if moment_scale > 0.0 else 0.0,
    }


def summarize(
    spec: SimulationSpec,
    mesh: VolumeMesh,
    fields: NodalFields,
    reactions: list[Reaction],
    calculix: str,
) -> SolveResult:
    """``reactions``: the reaction of each support, in spec order. The loads are the
    structural ones; a thermal stress run's thermal loads apply no force (M5.4)."""
    magnitude = displacement_magnitude(fields)
    mises = von_mises_field(fields)
    pairs = [
        (load, total)
        for load, total in zip(spec.loads, load_resultants(spec, mesh), strict=True)
        if not isinstance(load, THERMAL_LOADS)
    ]
    loads = [total for _, total in pairs]
    return SolveResult.model_validate(
        {
            "nodes": fields.node_count,
            "displacement": {"max": _at(mesh, magnitude, _argmax(magnitude))},
            "vonMises": {
                "min": _at(mesh, mises, _argmin(mises)),
                "max": _at(mesh, mises, _argmax(mises)),
            },
            "reactions": [
                {
                    "supportId": support.id,
                    "force": list(r.force),
                    "moment": list(r.moment),
                    "point": list(r.point),
                }
                for support, r in zip(spec.supports, reactions, strict=True)
            ],
            "loads": [
                {"loadId": load.id, "force": list(total.force), "moment": list(total.moment)}
                for load, total in pairs
            ],
            "balance": balance(mesh, loads, reactions),
            **(
                {"safetyFactor": {"min": _at(mesh, factor, _argmin(factor))}}
                if (factor := fields.safety_factor) is not None
                else {}
            ),
            "software": {"calculix": calculix},
        }
    )


def summarize_thermal(
    spec: SimulationSpec,
    mesh: VolumeMesh,
    fields: ThermalFields,
    flows: list[HeatFlow],
    calculix: str,
) -> SolveResult:
    """A steady-state thermal run's summary: the smallest and largest temperature (M5.1), the
    largest heat flux, and the heat flow of each thermal load (``flows``, in spec order, from
    results.heat) with the heat balance (M5.3)."""
    return SolveResult.model_validate(
        {
            "nodes": fields.node_count,
            **_thermal_summary(spec, mesh, fields, flows),
            "software": {"calculix": calculix},
        }
    )


def summarize_modal(eigenvalues: list[float], mesh: VolumeMesh, calculix: str) -> SolveResult:
    """A modal run's summary (M6.1): the frequency of each mode in hertz, lowest first."""
    return SolveResult.model_validate(
        {
            "nodes": mesh.node_count,
            "frequencies": [frequency(value) for value in eigenvalues],
            "software": {"calculix": calculix},
        }
    )


def _thermal_summary(
    spec: SimulationSpec, mesh: VolumeMesh, fields: ThermalFields, flows: list[HeatFlow]
) -> dict[str, object]:
    t = fields.temperature
    q = heat_flux_magnitude(fields)
    loads = [x for x in spec.loads if isinstance(x, THERMAL_LOADS)]
    return {
        "temperature": {"min": _at(mesh, t, _argmin(t)), "max": _at(mesh, t, _argmax(t))},
        "heatFlux": {"max": _at(mesh, q, _argmax(q))},
        "heatFlows": [
            {"loadId": load.id, "heat": flow.heat} for load, flow in zip(loads, flows, strict=True)
        ],
        "heatBalance": heat_balance(flows, balance_floor(spec, mesh, t)),
    }


def _read_thermal(
    spec: SimulationSpec, mesh: VolumeMesh, frd: Path, dat: Path
) -> tuple[ThermalFields, list[HeatFlow]]:
    thermal = read_thermal_fields(frd, mesh.node_count)
    try:
        flows = read_heat_flows(spec, mesh, thermal.temperature, dat)
    except ValueError as error:
        raise DatError(str(error)) from None
    return thermal, flows


def read_results(
    spec: SimulationSpec, mesh: VolumeMesh, frd: Path, dat: Path, calculix: str
) -> tuple[NodalFields | ThermalFields | ModalFields, SolveResult]:
    """Reads the solver output of a deck made from ``spec`` and ``mesh``, with the safety
    factor against yield when every material has a yield strength (ADR-054). A steady-state
    thermal run has temperatures and heat fluxes (M5.1, M5.3); a thermal stress run has those
    of its heat transfer step beside the structural results of its static step (M5.4): each
    block of the result files is asked for in one step only, so each is read as before. A
    modal run has its natural frequencies (M6.1, ADR-070) and since M6.2 its mode shapes
    (ADR-071)."""
    if spec.analysis == "modal":
        eigenvalues = read_eigenvalues(dat)
        shapes = read_mode_shapes(frd, mesh.node_count, len(eigenvalues))
        return ModalFields(mesh.node_count, shapes), summarize_modal(eigenvalues, mesh, calculix)
    if spec.analysis == "steady_thermal":
        thermal, flows = _read_thermal(spec, mesh, frd, dat)
        return thermal, summarize_thermal(spec, mesh, thermal, flows, calculix)
    fields = read_fields(frd, mesh.node_count)
    fields = replace(fields, safety_factor=safety_factor_field(spec, mesh, fields))
    result = summarize(spec, mesh, fields, read_reactions(spec, mesh, dat), calculix)
    if spec.analysis != "thermal_stress":
        return fields, result
    thermal, flows = _read_thermal(spec, mesh, frd, dat)
    summary = result.model_dump(by_alias=True, exclude_none=True)
    summary.update(_thermal_summary(spec, mesh, thermal, flows))
    return replace(fields, thermal=thermal), SolveResult.model_validate(summary)


def read_reactions(spec: SimulationSpec, mesh: VolumeMesh, dat: Path) -> list[Reaction]:
    """The reaction of each support, in spec order (ADR-030, ADR-039, ADR-040, ADR-051).

    The force at each held node, shared between the supports holding it (deck.constraints),
    so a node on the edge between two supports is counted once. CalculiX's figure includes
    every load applied at the held nodes, which is taken back out (deck.applied). An elastic
    support's reaction is the force of its springs, worked out from the displacement of their
    nodes (deck.loads.elastic, M2.6). Moments are summed node by node at the undeformed
    positions (a linear analysis). Where bonds are tied (M4.3), a held node that tied nodes
    follow also carries its share of the tie forces, which CalculiX leaves out of its figure
    and the reader adds back (deck.loads.tie, ADR-060).
    """
    names = support_set_names(spec)
    held = node_constraints(spec, mesh)
    forces = read_node_forces(dat, REACTION_SET) if held else {}
    applied = applied_nodal_loads(spec, mesh, held)
    for node, (lx, ly, lz) in applied.items():
        if node in forces:
            fx, fy, fz = forces[node]
            forces[node] = (fx - lx, fy - ly, fz - lz)
    if held and spec.bonds:
        frames = node_frames(holds(spec, mesh))
        tie_list = ties(spec, mesh, frames)
        if any(t.equations for t in tie_list):
            residual = read_node_forces(dat, TIE_SET)
            loads = applied_nodal_loads(spec, mesh, residual)
            for node, (lx, ly, lz) in loads.items():
                fx, fy, fz = residual[node]
                residual[node] = (fx - lx, fy - ly, fz - lz)
            for node, (tx, ty, tz) in tie_forces(tie_list, frames, residual).items():
                if node in forces:
                    fx, fy, fz = forces[node]
                    forces[node] = (fx + tx, fy + ty, fz + tz)
    try:
        nodal = support_node_reactions(spec, mesh, forces)
    except ValueError as error:
        raise DatError(str(error)) from None
    for k, support in enumerate(spec.supports):
        if isinstance(support, ElasticSupport):
            nodal[k] = _spring_forces(mesh, support, dat, names[k])
    return [_reaction(mesh, s.faces, f) for s, f in zip(spec.supports, nodal, strict=True)]


def _reaction(mesh: VolumeMesh, faces: list[int], nodal: dict[int, Vector]) -> Reaction:
    point = faces_centroid(mesh, faces)
    p = mesh.positions
    force = [0.0, 0.0, 0.0]
    moment = [0.0, 0.0, 0.0]
    origin = [0.0, 0.0, 0.0]
    gross = 0.0
    for node, f in nodal.items():
        gross += norm(f)
        x = (p[3 * node], p[3 * node + 1], p[3 * node + 2])
        about = cross([x[i] - point[i] for i in range(3)], f)
        m0 = cross(x, f)
        for i in range(3):
            force[i] += f[i]
            moment[i] += about[i]
            origin[i] += m0[i]
    return Reaction(
        (force[0], force[1], force[2]),
        (moment[0], moment[1], moment[2]),
        point,
        (origin[0], origin[1], origin[2]),
        gross,
    )


def _spring_forces(
    mesh: VolumeMesh, support: ElasticSupport, dat: Path, name: str
) -> dict[int, Vector]:
    displacements = read_node_displacements(dat, name)
    try:
        return spring_forces(elastic_springs(mesh, support), displacements)
    except KeyError as error:
        raise DatError(f"The solver gave no displacement for node {error.args[0] + 1}.") from None
