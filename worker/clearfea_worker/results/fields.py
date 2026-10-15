# SPDX-License-Identifier: AGPL-3.0-or-later
"""Nodal displacement and stress from the solver output, and the derived von Mises stress.

Physics-critical (ADR-030). CalculiX writes stresses extrapolated from the integration points
to the nodes and averaged over the elements that share a node; von Mises is derived from
those nodal stresses. Everything is SI: metres and pascals.
"""

import math
from array import array
from dataclasses import dataclass
from pathlib import Path

from .frd import FrdError, NodalBlock, read_nodal_blocks

DISPLACEMENT = ("D1", "D2", "D3")
#: CalculiX's order: normal stresses, then the shear stresses xy, yz, zx.
STRESS = ("SXX", "SYY", "SZZ", "SXY", "SYZ", "SZX")


@dataclass(frozen=True)
class NodalFields:
    """``displacement[3 n + i]`` (m) and ``stress[6 n + i]`` (Pa, in STRESS order) of node n."""

    node_count: int
    displacement: array
    stress: array


def von_mises(sxx: float, syy: float, szz: float, sxy: float, syz: float, szx: float) -> float:
    """Von Mises equivalent stress of a stress tensor given by its six components."""
    normal = (sxx - syy) ** 2 + (syy - szz) ** 2 + (szz - sxx) ** 2
    return math.sqrt(0.5 * normal + 3.0 * (sxy**2 + syz**2 + szx**2))


def _ordered(block: NodalBlock, names: tuple[str, ...]) -> array:
    """The block's values with components in ``names`` order."""
    if set(block.components) != set(names) or len(block.components) != len(names):
        raise FrdError(
            f"{block.name} has components {', '.join(block.components)}, "
            f"expected {', '.join(names)}."
        )
    if block.missing():
        raise FrdError(f"{block.name} has no value for {block.missing()} nodes of the mesh.")
    if block.components == names:
        return block.values
    index = [block.components.index(name) for name in names]
    width = len(names)
    src = block.values
    return array("d", (src[n * width + i] for n in range(len(src) // width) for i in index))


def read_fields(frd: Path, node_count: int) -> NodalFields:
    """Displacement and stress of every node from the ``.frd`` file."""
    blocks = read_nodal_blocks(frd, node_count, {"DISP", "STRESS"})
    fields = NodalFields(
        node_count,
        _ordered(blocks["DISP"], DISPLACEMENT),
        _ordered(blocks["STRESS"], STRESS),
    )
    if not all(math.isfinite(v) for v in (*fields.displacement, *fields.stress)):
        raise FrdError("The result file holds values that are not finite numbers.")
    return fields


def displacement_magnitude(fields: NodalFields) -> array:
    d = fields.displacement
    return array(
        "d",
        (
            math.sqrt(d[3 * n] ** 2 + d[3 * n + 1] ** 2 + d[3 * n + 2] ** 2)
            for n in range(fields.node_count)
        ),
    )


def von_mises_field(fields: NodalFields) -> array:
    s = fields.stress
    return array("d", (von_mises(*s[6 * n : 6 * n + 6]) for n in range(fields.node_count)))
