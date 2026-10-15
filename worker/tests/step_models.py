# SPDX-License-Identifier: AGPL-3.0-or-later
"""STEP models written for these tests with Gmsh's OpenCASCADE kernel (original geometry).

OpenCASCADE writes millimetres. ``with_length_unit`` rewrites only the unit declaration, so
the same coordinates can be tested as if the file had been drawn in another unit.
"""

import re
from pathlib import Path

_MM_UNIT = re.compile(
    r"\(\s*LENGTH_UNIT\(\)\s*NAMED_UNIT\(\*\)\s*SI_UNIT\(\.MILLI\.,\.METRE\.\)\s*\)"
)
_UNIT_LIST = re.compile(r"GLOBAL_UNIT_ASSIGNED_CONTEXT\s*\(\s*\((#\d+),\s*(#\d+),\s*(#\d+)\)\s*\)")


def _write(path: Path, build: str) -> Path:
    import gmsh

    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        # OpenCASCADE keeps the unit of an earlier import in the same process; without this a
        # model written after an import is declared in metres with millimetre coordinates.
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        gmsh.model.add(path.stem)
        occ = gmsh.model.occ
        if build == "block_with_hole":
            # 100 x 50 x 20 mm with a 20 mm diameter hole through the middle: 7 faces.
            box = occ.addBox(0, 0, 0, 100, 50, 20)
            hole = occ.addCylinder(50, 25, -1, 0, 0, 22, 10)
            occ.cut([(3, box)], [(3, hole)])
        elif build == "plate_surface":
            occ.addRectangle(0, 0, 0, 100, 50)
        else:
            raise ValueError(build)
        occ.synchronize()
        gmsh.write(str(path))
    finally:
        gmsh.finalize()
    return path


def block_with_hole(path: Path) -> Path:
    return _write(path, "block_with_hole")


def plate_surface(path: Path) -> Path:
    """A bare rectangular surface: no solid body."""
    return _write(path, "plate_surface")


def with_length_unit(text: str, unit: str) -> str:
    """The STEP text with its millimetre unit replaced by ``m``, ``um``, ``in`` or ``none``."""
    if len(_MM_UNIT.findall(text)) != 1:
        raise ValueError("expected one millimetre length unit")
    if unit == "m":
        return _MM_UNIT.sub("( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT($,.METRE.) )", text)
    if unit == "um":
        return _MM_UNIT.sub("( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MICRO.,.METRE.) )", text)
    if unit == "none":
        found = _UNIT_LIST.search(text)
        if found is None:
            raise ValueError("expected a three-unit context")
        return text.replace(
            found.group(0), f"GLOBAL_UNIT_ASSIGNED_CONTEXT(({found.group(2)},{found.group(3)}))"
        )
    if unit == "in":
        last = max(int(n) for n in re.findall(r"^#(\d+)\s*=", text, re.M))
        a, b, c = last + 1, last + 2, last + 3
        new = f"( CONVERSION_BASED_UNIT('INCH',#{a}) LENGTH_UNIT() NAMED_UNIT(#{c}) )"
        extra = (
            f"#{a} = LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),#{b});\n"
            f"#{b} = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );\n"
            f"#{c} = DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.);\n"
        )
        out = _MM_UNIT.sub(new, text)
        return out.replace("ENDSEC;\nEND-ISO-10303-21;", extra + "ENDSEC;\nEND-ISO-10303-21;")
    raise ValueError(f"unsupported unit {unit!r}")
