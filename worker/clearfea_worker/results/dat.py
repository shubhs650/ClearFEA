# SPDX-License-Identifier: AGPL-3.0-or-later
"""Reaction totals from a CalculiX ``.dat`` file (ADR-030). Physics-critical.

The deck asks for ``*NODE PRINT, NSET=<set>, TOTALS=ONLY`` with ``RF``, for which CalculiX
2.21 writes, per set and increment:

     total force (fx,fy,fz) for set S1 and time  0.1000000E+01

            4.000000E+02  2.101885E-12  2.868564E-12

With supports other than fixed ones it asks for ``*NODE PRINT, NSET=RALL, GLOBAL=YES`` with
``RF`` instead (ADR-039), for which CalculiX writes one line per node after the header:

     forces (fx,fy,fz) for set RALL and time  0.1000000E+01

            1 -5.752237E-14 -4.145566E-14  3.483120E-14

With an elastic support it also asks for ``*NODE PRINT, NSET=S<k>, GLOBAL=YES`` with ``U``,
the displacement of each node of the support's faces, in the same layout under
"displacements (vx,vy,vz) for set S<k> and time ...", from which the support's reaction is
worked out (M2.6).
"""

import re
from pathlib import Path

_TOTAL = re.compile(r"^\s*total force \(fx,fy,fz\) for set (\S+) and time\s+(\S+)\s*$")
_FORCES = re.compile(r"^\s*forces \(fx,fy,fz\) for set (\S+) and time\s+(\S+)\s*$")
_DISPLACEMENTS = re.compile(r"^\s*displacements \(vx,vy,vz\) for set (\S+) and time\s+(\S+)\s*$")


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


def read_node_forces(path: Path, name: str) -> dict[int, tuple[float, float, float]]:
    """The last block of reaction forces of each node of set ``name`` (0-based node -> N)."""
    return _read_node_vectors(path, name, _FORCES, "reaction forces")


def read_node_displacements(path: Path, name: str) -> dict[int, tuple[float, float, float]]:
    """The last block of displacements of each node of set ``name`` (0-based node -> m)."""
    return _read_node_vectors(path, name, _DISPLACEMENTS, "displacements")


def _read_node_vectors(
    path: Path, name: str, header: re.Pattern[str], what: str
) -> dict[int, tuple[float, float, float]]:
    lines = path.read_text(encoding="ascii", errors="replace").splitlines()
    found: dict[int, tuple[float, float, float]] | None = None
    k = 0
    while k < len(lines):
        match = header.match(lines[k])
        k += 1
        if match is None or match.group(1).upper() != name.upper():
            continue
        block: dict[int, tuple[float, float, float]] = {}
        while k < len(lines) and not lines[k].strip():
            k += 1
        while k < len(lines) and lines[k].strip():
            values = lines[k].split()
            try:
                if len(values) != 4:
                    raise ValueError
                node = int(values[0])
                fx, fy, fz = (float(v) for v in values[1:])
            except ValueError:
                raise DatError(
                    f"line {k + 1}: a line of the {what} of set {name} is unreadable."
                ) from None
            if node < 1 or node - 1 in block:
                raise DatError(f"line {k + 1}: node {node} of set {name} is out of place.")
            block[node - 1] = (fx, fy, fz)
            k += 1
        found = block
    if found is None:
        raise DatError(f"The .dat file has no {what} for set {name}.")
    return found
