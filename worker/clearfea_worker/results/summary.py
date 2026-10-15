# SPDX-License-Identifier: AGPL-3.0-or-later
"""The solve job's result summary (ADR-030). Physics-critical.

Largest displacement magnitude, smallest and largest von Mises stress with the node and
position where each occurs, and the total reaction of every support. SI throughout.
"""

from array import array
from pathlib import Path

from ..deck import REACTION_SET, only_fixed_supports, support_set_names
from ..deck.constraints import support_reactions
from ..meshing.volume import VolumeMesh
from ..spec.simulation_schema import SimulationSpec, SolveResult
from .dat import DatError, read_node_forces, read_reaction_totals
from .fields import NodalFields, displacement_magnitude, read_fields, von_mises_field


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


def summarize(
    spec: SimulationSpec,
    mesh: VolumeMesh,
    fields: NodalFields,
    reactions: list[tuple[float, float, float]],
    calculix: str,
) -> SolveResult:
    """``reactions``: the total reaction of each support, in spec order."""
    magnitude = displacement_magnitude(fields)
    mises = von_mises_field(fields)
    return SolveResult.model_validate(
        {
            "nodes": fields.node_count,
            "displacement": {"max": _at(mesh, magnitude, _argmax(magnitude))},
            "vonMises": {
                "min": _at(mesh, mises, _argmin(mises)),
                "max": _at(mesh, mises, _argmax(mises)),
            },
            "reactions": [
                {"supportId": support.id, "force": list(force)}
                for support, force in zip(spec.supports, reactions, strict=True)
            ],
            "software": {"calculix": calculix},
        }
    )


def read_results(
    spec: SimulationSpec, mesh: VolumeMesh, frd: Path, dat: Path, calculix: str
) -> tuple[NodalFields, SolveResult]:
    """Reads the solver output of a deck made from ``spec`` and ``mesh``."""
    fields = read_fields(frd, mesh.node_count)
    return fields, summarize(spec, mesh, fields, read_reactions(spec, mesh, dat), calculix)


def read_reactions(
    spec: SimulationSpec, mesh: VolumeMesh, dat: Path
) -> list[tuple[float, float, float]]:
    """The total reaction of each support, in spec order (ADR-030, ADR-039).

    With fixed supports only, CalculiX's total for each support's node set. Otherwise the
    force at each held node, shared between the supports holding it (deck.constraints), so a
    node on the edge between a symmetry plane and an end face is not counted twice.
    """
    names = support_set_names(spec)
    if only_fixed_supports(spec):
        totals = read_reaction_totals(dat, names)
        return [totals[name] for name in names]
    forces = read_node_forces(dat, REACTION_SET)
    try:
        return support_reactions(spec, mesh, forces)
    except ValueError as error:
        raise DatError(str(error)) from None
