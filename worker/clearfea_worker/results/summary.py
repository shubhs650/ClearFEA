# SPDX-License-Identifier: AGPL-3.0-or-later
"""The solve job's result summary (ADR-030). Physics-critical.

Largest displacement magnitude, smallest and largest von Mises stress with the node and
position where each occurs, and the total reaction of every support. SI throughout.
"""

from array import array
from pathlib import Path

from ..deck import support_set_names
from ..meshing.volume import VolumeMesh
from ..spec.simulation_schema import SimulationSpec, SolveResult
from .dat import read_reaction_totals
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
    reactions: dict[str, tuple[float, float, float]],
    calculix: str,
) -> SolveResult:
    magnitude = displacement_magnitude(fields)
    mises = von_mises_field(fields)
    names = support_set_names(spec)
    return SolveResult.model_validate(
        {
            "nodes": fields.node_count,
            "displacement": {"max": _at(mesh, magnitude, _argmax(magnitude))},
            "vonMises": {
                "min": _at(mesh, mises, _argmin(mises)),
                "max": _at(mesh, mises, _argmax(mises)),
            },
            "reactions": [
                {"supportId": support.id, "force": list(reactions[name])}
                for support, name in zip(spec.supports, names, strict=True)
            ],
            "software": {"calculix": calculix},
        }
    )


def read_results(
    spec: SimulationSpec, mesh: VolumeMesh, frd: Path, dat: Path, calculix: str
) -> tuple[NodalFields, SolveResult]:
    """Reads the solver output of a deck made from ``spec`` and ``mesh``."""
    fields = read_fields(frd, mesh.node_count)
    reactions = read_reaction_totals(dat, support_set_names(spec))
    return fields, summarize(spec, mesh, fields, reactions, calculix)
