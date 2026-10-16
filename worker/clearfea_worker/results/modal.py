# SPDX-License-Identifier: AGPL-3.0-or-later
"""Natural frequencies of a modal run from a CalculiX ``.dat`` file (M6.1, ADR-070), and its
mode shapes from the ``.frd`` file (M6.2, ADR-071). Physics-critical.

A frequency step writes its eigenvalues to the .dat file under a heading, one line per mode
(checked with ccx 2.21):

         E I G E N V A L U E   O U T P U T

     MODE NO    EIGENVALUE                       FREQUENCY
                                         REAL PART            IMAGINARY PART
                               (RAD/TIME)      (CYCLES/TIME     (RAD/TIME)

          1  -0.3967380E-04   0.0000000E+00   0.0000000E+00   0.6298714E-02
          7   0.2484587E+09   0.1576257E+05   0.2508691E+04   0.0000000E+00

The eigenvalue is ω² in rad²/s², printed to seven significant digits. Its frequency is
√λ / 2π. A negative eigenvalue comes only from rounding, for the rigid-body modes of a body
nothing holds, and CalculiX writes its frequency as zero with an imaginary part; it is read as
−√|λ| / 2π so the size of the rounding stays visible. Participation factors and effective
masses follow in the file and are not read yet.

The ``.frd`` file holds one ``DISP`` block per mode, mode 1 first, each the eigenvector
CalculiX normalised to unit modal mass (φᵀ M φ = 1, so in 1/√kg). Its size says nothing about
how far the body moves, which a free vibration leaves open, so each shape is kept scaled to a
largest displacement of 1 (a ratio): the shape, not an amount. Its sign is fixed too, since an
eigenvector's is arbitrary: at the node that moves most (the first such node), its largest
component is positive.
"""

import math
import re
from array import array
from dataclasses import dataclass
from pathlib import Path

from .dat import DatError
from .frd import FrdError, iter_nodal_blocks

_HEADING = re.compile(r"^\s*E I G E N V A L U E\s+O U T P U T\s*$")
_ROW = re.compile(r"^\s*(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$")


#: The components of a mode shape, as CalculiX names them in a DISP block.
_DISPLACEMENT = ("D1", "D2", "D3")


@dataclass(frozen=True)
class ModalFields:
    """What a modal run has at the nodes (M6.2): ``shapes[k][3 n + i]``, component i of node
    n's displacement in mode k + 1, scaled so the largest displacement of the mode is 1 and
    signed as normalized_shape says, as float32."""

    node_count: int
    shapes: list[array]


def frequency(eigenvalue: float) -> float:
    """The frequency (Hz) of an eigenvalue ω² (rad²/s²), negative for a negative one."""
    return math.copysign(math.sqrt(abs(eigenvalue)), eigenvalue) / (2.0 * math.pi)


def read_eigenvalues(path: Path) -> list[float]:
    """The eigenvalues (rad²/s²) of the last frequency step in the file, mode 1 first."""
    lines = path.read_text(encoding="ascii", errors="replace").splitlines()
    found: list[float] | None = None
    k = 0
    while k < len(lines):
        if not _HEADING.match(lines[k]):
            k += 1
            continue
        k += 1
        values: list[float] = []
        # The column headings, then the rows; the first blank line after a row ends them.
        while k < len(lines) and not (values and not lines[k].strip()):
            match = _ROW.match(lines[k])
            if match is not None:
                mode = int(match.group(1))
                if mode != len(values) + 1:
                    raise DatError(f"line {k + 1}: mode {mode} of the eigenvalues is out of place.")
                try:
                    values.append(float(match.group(2)))
                except ValueError:
                    raise DatError(f"line {k + 1}: an eigenvalue is unreadable.") from None
            k += 1
        found = values
    if not found:
        raise DatError("The .dat file has no eigenvalues.")
    return found


def normalized_shape(values: array, node_count: int) -> array:
    """A mode's displacements (x, y, z per node) scaled so the largest displacement is 1, with
    the largest component of the node that moves most positive (the first such node and
    component on a tie), as float32. A mode where nothing moves stays zero."""
    largest, node = 0.0, 0
    for n in range(node_count):
        size = values[3 * n] ** 2 + values[3 * n + 1] ** 2 + values[3 * n + 2] ** 2
        if size > largest:
            largest, node = size, n
    if largest == 0.0:
        return array("f", values)
    at = values[3 * node : 3 * node + 3]
    component = max(range(3), key=lambda i: abs(at[i]))
    scale = math.copysign(1.0 / math.sqrt(largest), at[component])
    return array("f", (v * scale for v in values))


def read_mode_shapes(path: Path, node_count: int, modes: int) -> list[array]:
    """The shape of each of the ``modes`` modes in the ``.frd`` file, mode 1 first, as
    normalized_shape gives them. Raises FrdError if the file holds another number of modes or
    a mode lacks a node."""
    shapes: list[array] = []
    for block in iter_nodal_blocks(path, node_count, {"DISP"}):
        if block.components != _DISPLACEMENT:
            raise FrdError(
                f"Mode {len(shapes) + 1} has components {', '.join(block.components)}, "
                f"expected {', '.join(_DISPLACEMENT)}."
            )
        if block.missing():
            raise FrdError(f"Mode {len(shapes) + 1} has no value for {block.missing()} nodes.")
        if not all(math.isfinite(v) for v in block.values):
            raise FrdError(f"Mode {len(shapes) + 1} holds values that are not finite numbers.")
        shapes.append(normalized_shape(block.values, node_count))
    if len(shapes) != modes:
        raise FrdError(f"The result file holds {len(shapes)} mode shapes for {modes} frequencies.")
    return shapes
