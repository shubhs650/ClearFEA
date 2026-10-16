# SPDX-License-Identifier: AGPL-3.0-or-later
"""Nodal result blocks of a CalculiX ``.frd`` file in ASCII form (ADR-030).

Physics-critical. The layout follows the CalculiX GraphiX manual's description of the
result format, checked against what CalculiX 2.21 writes:

    "    1PSTEP ..."          a result block begins
    "  100C..."               block header; columns 74-75 hold the format (0 short, 1 long)
    " -4  DISP        4    1" block name and component count
    " -5  D1  ..."            one line per component; ``ALL`` is a derived entry with no data
    " -1<node><values>"       node number (5 digits short, 10 long), then 12-character values
    " -2<values>"             continuation of the previous node's values
    " -3"                     end of block

Values are written as E12.5, so every value carries five significant digits.
"""

import math
from array import array
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

#: Width of the node number for each format code of the block header.
_NODE_WIDTH = {0: 5, 1: 10}
_VALUE_WIDTH = 12


class FrdError(ValueError):
    """The file is not a result file this reader understands, or lacks what was asked for."""


@dataclass(frozen=True)
class NodalBlock:
    """One result block: component names and ``values[n * len(components) + c]`` for node
    index ``n`` (node number - 1) and component ``c``. Nodes with no value hold NaN."""

    name: str
    components: tuple[str, ...]
    values: array

    def missing(self) -> int:
        """Number of nodes with no value."""
        return sum(1 for v in self.values[:: len(self.components)] if math.isnan(v))


def _floats(text: str, line_no: int) -> list[float]:
    values = []
    for k in range(0, len(text.rstrip()), _VALUE_WIDTH):
        field = text[k : k + _VALUE_WIDTH]
        try:
            values.append(float(field))
        except ValueError:
            raise FrdError(f"line {line_no}: {field!r} is not a number.") from None
    return values


def iter_nodal_blocks(path: Path, node_count: int, names: set[str]) -> Iterator[NodalBlock]:
    """Each block of ``names`` in the file, in file order, sized for ``node_count`` nodes.

    A modal run writes one ``DISP`` block per mode (M6.2), so the blocks are handed on one at
    a time and only the current one is held. Raises FrdError if a block is malformed.
    """
    name: str | None = None
    components: list[str] = []
    width = _NODE_WIDTH[1]
    current: list[float] = []
    node = -1
    values: array | None = None

    def store() -> None:
        if values is None or node < 0:
            return
        if len(current) != len(components):
            raise FrdError(
                f"{name}: node {node + 1} has {len(current)} values, expected {len(components)}."
            )
        values[node * len(components) : (node + 1) * len(components)] = array("d", current)

    with path.open(encoding="ascii", errors="replace") as f:
        for line_no, line in enumerate(f, start=1):
            line = line.rstrip("\n")
            key = line[:3]
            if line.startswith("  100C"):
                code = line[73:75].strip()
                format_code = int(code) if code.isdigit() else 0
                if format_code not in _NODE_WIDTH:
                    raise FrdError(
                        f"line {line_no}: result format {format_code} is not ASCII; "
                        "only the short and long ASCII formats are read."
                    )
                width = _NODE_WIDTH[format_code]
                name, components, values = None, [], None
            elif key == " -4":
                fields = line[3:].split()
                name = fields[0] if fields else None
                components = []
                values = None
            elif key == " -5" and name is not None:
                component = line[3:].split()[0]
                if component != "ALL":
                    components.append(component)
            elif key == " -1" and name in names:
                if values is None:
                    if not components:
                        raise FrdError(f"line {line_no}: block {name} names no components.")
                    values = array("d", [math.nan]) * (node_count * len(components))
                store()
                try:
                    number = int(line[3 : 3 + width])
                except ValueError:
                    raise FrdError(f"line {line_no}: no node number.") from None
                if not 1 <= number <= node_count:
                    raise FrdError(
                        f"line {line_no}: node {number} is outside the mesh's {node_count} nodes."
                    )
                node = number - 1
                current = _floats(line[3 + width :], line_no)
            elif key == " -2" and values is not None:
                current.extend(_floats(line[3 + width :], line_no))
            elif key == " -3":
                if values is not None and name is not None:
                    store()
                    yield NodalBlock(name, tuple(components), values)
                name, components, values, node, current = None, [], None, -1, []


def read_nodal_blocks(path: Path, node_count: int, names: set[str]) -> dict[str, NodalBlock]:
    """The last block of each of ``names`` in the file, sized for ``node_count`` nodes.

    For a linear static analysis there is one block of each; taking the last keeps the final
    increment if there are more. Raises FrdError if a block is missing or malformed.
    """
    found: dict[str, NodalBlock] = {}
    for block in iter_nodal_blocks(path, node_count, names):
        found[block.name] = block
    absent = sorted(names - set(found))
    if absent:
        raise FrdError(f"The result file has no {', '.join(absent)} block.")
    return found
