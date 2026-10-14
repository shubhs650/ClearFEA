# SPDX-License-Identifier: AGPL-3.0-or-later
"""Read the length unit a STEP file declares (ISO 10303-21 text, AP203/AP214/AP242).

Gmsh converts STEP coordinates to the unit set in ``Geometry.OCCTargetUnit`` but does not
report the unit the file declared, so the import job reads it here. Only the unit's name is
taken from the file; factors come from packages/spec/units.json, except that a
conversion-based unit (inch, foot) carries its own factor, which is cross-checked against the
table.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from clearfea_worker.units import UnitError, to_si

#: SI prefixes on METRE that the units table defines a symbol for. Others are reported as
#: unsupported rather than guessed.
_SI_PREFIX_SYMBOL = {None: "m", "CENTI": "cm", "MILLI": "mm"}
#: Names CAD systems write in CONVERSION_BASED_UNIT for length.
_NAMED_SYMBOL = {"INCH": "in", "INCHES": "in", "FOOT": "ft", "FEET": "ft"}


@dataclass(frozen=True)
class LengthUnit:
    symbol: str | None  # a key of the length kind in units.json, or None when unsupported
    declared: str  # what the file says, for the user and the log
    factor_in_file: float | None = None  # metres per unit, when the file states a factor


@dataclass(frozen=True)
class Detection:
    unit: LengthUnit | None  # None when the file declares no unit or several different ones
    found: tuple[LengthUnit, ...]
    problem: str | None = None


def _instances(text: str) -> dict[int, str]:
    """Map each entity id in the DATA section to its right-hand side, with strings kept."""
    start = text.find("DATA;")
    if start < 0:
        raise ValueError("Not a STEP file: no DATA section.")
    body = text[start + len("DATA;") :]
    out: dict[int, str] = {}
    buf: list[str] = []
    in_string = False
    i = 0
    while i < len(body):
        ch = body[i]
        if in_string:
            buf.append(ch)
            if ch == "'":
                if i + 1 < len(body) and body[i + 1] == "'":
                    buf.append("'")
                    i += 1
                else:
                    in_string = False
        elif ch == "'":
            in_string = True
            buf.append(ch)
        elif ch == "/" and body.startswith("/*", i):
            end = body.find("*/", i + 2)
            i = len(body) if end < 0 else end + 2
            continue
        elif ch == ";":
            stmt = "".join(buf).strip()
            buf = []
            if stmt == "ENDSEC":
                break
            m = re.match(r"#(\d+)\s*=\s*(.*)\Z", stmt, re.S)
            if m:
                out[int(m.group(1))] = re.sub(r"\s+", " ", m.group(2))
        else:
            buf.append(ch)
        i += 1
    return out


def _refs(s: str) -> list[int]:
    return [int(n) for n in re.findall(r"#(\d+)", s)]


def _length_unit(ref: int, inst: dict[int, str], depth: int = 0) -> LengthUnit | None:
    rhs = inst.get(ref, "")
    if "LENGTH_UNIT" not in rhs or depth > 4:
        return None
    si = re.search(r"SI_UNIT\(\s*(\$|\.(\w+)\.)\s*,\s*\.METRE\.\s*\)", rhs)
    if si:
        prefix = si.group(2)
        declared = f"SI_UNIT({si.group(1)},.METRE.)"
        return LengthUnit(_SI_PREFIX_SYMBOL.get(prefix), declared)
    conv = re.search(r"CONVERSION_BASED_UNIT\(\s*'([^']*)'\s*,\s*#(\d+)\s*\)", rhs)
    if conv:
        name = conv.group(1)
        factor = None
        measure = inst.get(int(conv.group(2)), "")
        m = re.search(r"LENGTH_MEASURE\(\s*([-+0-9.Ee]+)\s*\)\s*,\s*#(\d+)", measure)
        if m:
            base = _length_unit(int(m.group(2)), inst, depth + 1)
            if base and base.symbol:
                factor = to_si(float(m.group(1)), base.symbol, "length")
        return LengthUnit(_NAMED_SYMBOL.get(name.strip().upper()), f"'{name}'", factor)
    return None


def detect_length_unit(text: str) -> Detection:
    """Return the length unit declared by the file's geometric contexts."""
    inst = _instances(text)
    found: list[LengthUnit] = []
    for rhs in inst.values():
        m = re.search(r"GLOBAL_UNIT_ASSIGNED_CONTEXT\s*\(\s*\(([^)]*)\)\s*\)", rhs)
        if not m:
            continue
        for ref in _refs(m.group(1)):
            unit = _length_unit(ref, inst)
            if unit is not None and unit not in found:
                found.append(unit)
    if not found:
        return Detection(None, (), "The file does not declare a length unit.")
    if len({u.symbol or u.declared for u in found}) > 1:
        names = ", ".join(u.declared for u in found)
        return Detection(
            None, tuple(found), f"The file declares more than one length unit: {names}."
        )
    unit = found[0]
    if unit.symbol is None:
        return Detection(
            None, tuple(found), f"The file's length unit {unit.declared} is not supported."
        )
    if unit.factor_in_file is not None:
        try:
            table = to_si(1.0, unit.symbol, "length")
        except UnitError as err:
            return Detection(None, tuple(found), str(err))
        if abs(unit.factor_in_file - table) > 1e-9 * table:
            return Detection(
                None,
                tuple(found),
                f"The file defines {unit.declared} as {unit.factor_in_file} m, "
                f"but the units table says {table} m.",
            )
    return Detection(unit, tuple(found))
