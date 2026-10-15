# SPDX-License-Identifier: AGPL-3.0-or-later
"""Read the length unit a STEP file declares (ISO 10303-21 text, AP203/AP214/AP242).

Gmsh converts STEP coordinates to the unit set in ``Geometry.OCCTargetUnit`` but does not
report the unit the file declared, so the import job reads it here (ADR-023). Only the unit's
name is taken from the file; factors come from packages/spec/units.json, except that a
conversion-based unit (inch, foot) carries its own factor, which is cross-checked against the
table.

The detection also says how OpenCASCADE itself reads the file's coordinates (the reading
factor, metres per file coordinate), so a unit the user chooses can be applied by re-importing
with ``Geometry.OCCScaling`` (ADR-024). Where that cannot be known, the factor is None and the
file cannot be used.
"""

import re
from dataclasses import dataclass

from clearfea_worker.units import UnitError, to_si

#: SI prefixes on METRE that the units table defines a symbol for. Others are reported as
#: unsupported rather than guessed.
_SI_PREFIX_SYMBOL = {None: "m", "CENTI": "cm", "MILLI": "mm"}
#: Names CAD systems write in CONVERSION_BASED_UNIT for length.
_NAMED_SYMBOL = {"INCH": "in", "INCHES": "in", "FOOT": "ft", "FEET": "ft"}
#: OpenCASCADE takes the coordinates of a file that declares no length unit as already being
#: in its target unit, which the import job sets to metres (checked by experiment with
#: Gmsh 4.15.2 and OpenCASCADE 7.8.1, ADR-024; tests/test_geometry_import.py keeps it true).
NO_UNIT_READING_FACTOR = 1.0


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
    #: Metres per file coordinate as OpenCASCADE reads the file; None when that is unknown.
    reading_factor: float | None = None

    @property
    def declared(self) -> str | None:
        """The declared unit as written, or a list when the file declares several."""
        if not self.found:
            return None
        return ", ".join(u.declared for u in self.found)


class StepFormatError(ValueError):
    """The text is not an ISO 10303-21 (STEP) file."""


def _instances(text: str) -> dict[int, str]:
    """Map each entity id in the DATA section to its right-hand side, with strings kept."""
    start = text.find("DATA;")
    if not text.lstrip("\ufeff \t\r\n").startswith("ISO-10303-21") or start < 0:
        raise StepFormatError("Not a STEP file: no ISO-10303-21 header and DATA section.")
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
    """The length unit entity at ``ref``, or None if the entity is not a length unit."""
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
    # A length unit written in a form this reader does not know. Report it rather than
    # treating the file as if it declared no unit.
    return LengthUnit(None, rhs[:120])


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
        return Detection(
            None, (), "The file does not declare a length unit.", NO_UNIT_READING_FACTOR
        )
    if len({u.symbol or u.declared for u in found}) > 1:
        names = ", ".join(u.declared for u in found)
        return Detection(
            None, tuple(found), f"The file declares more than one length unit: {names}."
        )
    unit = found[0]
    if unit.symbol is None:
        # OpenCASCADE applies a conversion-based unit's own factor, so a unit the user
        # chooses can still be applied; an unknown SI prefix cannot, because the units
        # table has no factor for it.
        return Detection(
            None,
            tuple(found),
            f"The file's length unit {unit.declared} is not supported.",
            unit.factor_in_file,
        )
    try:
        table = to_si(1.0, unit.symbol, "length")
    except UnitError as err:
        return Detection(None, tuple(found), str(err))
    if unit.factor_in_file is not None:
        if abs(unit.factor_in_file - table) > 1e-9 * table:
            return Detection(
                None,
                tuple(found),
                f"The file defines {unit.declared} as {unit.factor_in_file} m, "
                f"but the units table says {table} m.",
                unit.factor_in_file,
            )
        return Detection(unit, tuple(found), None, unit.factor_in_file)
    return Detection(unit, tuple(found), None, table)
