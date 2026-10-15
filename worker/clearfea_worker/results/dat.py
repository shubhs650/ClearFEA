# SPDX-License-Identifier: AGPL-3.0-or-later
"""Reaction totals from a CalculiX ``.dat`` file (ADR-030). Physics-critical.

The deck asks for ``*NODE PRINT, NSET=<set>, TOTALS=ONLY`` with ``RF``, for which CalculiX
2.21 writes, per set and increment:

     total force (fx,fy,fz) for set S1 and time  0.1000000E+01

            4.000000E+02  2.101885E-12  2.868564E-12
"""

import re
from pathlib import Path

_TOTAL = re.compile(r"^\s*total force \(fx,fy,fz\) for set (\S+) and time\s+(\S+)\s*$")


class DatError(ValueError):
    """The file lacks a reaction total that was asked for, or holds one malformed."""


def read_reaction_totals(path: Path, sets: list[str]) -> dict[str, tuple[float, float, float]]:
    """The last total reaction force of each named node set, in newtons."""
    lines = path.read_text(encoding="ascii", errors="replace").splitlines()
    totals: dict[str, tuple[float, float, float]] = {}
    for k, line in enumerate(lines):
        match = _TOTAL.match(line)
        if match is None:
            continue
        name = match.group(1).upper()
        values = next((v for v in lines[k + 1 : k + 4] if v.strip()), "").split()
        try:
            fx, fy, fz = (float(v) for v in values)
        except ValueError:
            raise DatError(f"line {k + 1}: the total force of set {name} is unreadable.") from None
        totals[name] = (fx, fy, fz)
    absent = [s for s in sets if s.upper() not in totals]
    if absent:
        raise DatError(f"The .dat file has no total reaction for {', '.join(absent)}.")
    return {s: totals[s.upper()] for s in sets}
