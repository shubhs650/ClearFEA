# SPDX-License-Identifier: AGPL-3.0-or-later
"""Natural frequencies of a modal run from a CalculiX ``.dat`` file (M6.1, ADR-070).
Physics-critical.

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
"""

import math
import re
from dataclasses import dataclass
from pathlib import Path

from .dat import DatError

_HEADING = re.compile(r"^\s*E I G E N V A L U E\s+O U T P U T\s*$")
_ROW = re.compile(r"^\s*(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$")


@dataclass(frozen=True)
class ModalFields:
    """What a modal run has at the nodes: nothing yet; the mode shapes are M6.2's."""

    node_count: int


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
