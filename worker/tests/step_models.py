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
        elif build == "two_blocks":
            # A 50 x 20 x 20 mm base and a 30 x 20 x 20 mm lug touching it at x = 50 mm.
            occ.addBox(0, 0, 0, 50, 20, 20)
            occ.addBox(50, 0, 0, 30, 20, 20)
        elif build == "block_on_plate":
            # Bond detection (M4.2). A 100 x 100 x 20 mm plate; an 80 x 80 x 30 mm block on it,
            # overhanging two sides (40 x 40 mm touching); a 30 x 30 x 30 mm block touching the
            # plate only along an edge.
            occ.addBox(0, 0, 0, 100, 100, 20)
            occ.addBox(60, 60, 20, 80, 80, 30)
            occ.addBox(100, 0, 20, 30, 30, 30)
        elif build == "blocks_with_gap":
            # Two 20 x 20 mm faces 0.5 mm apart: a clearance, not a bond.
            occ.addBox(0, 0, 0, 50, 20, 20)
            occ.addBox(50.5, 0, 0, 30, 20, 20)
        elif build == "pin_in_hole":
            # A 20 mm pin, 40 mm long, through a 20 mm hole in a 60 x 60 x 20 mm block.
            block = occ.addBox(-30, -30, 0, 60, 60, 20)
            hole = occ.addCylinder(0, 0, -1, 0, 0, 22, 10)
            occ.cut([(3, block)], [(3, hole)])
            occ.addCylinder(0, 0, -10, 0, 0, 40, 10)
        elif build == "pad_on_shell":
            # A 30 mm thick pad, 100 mm tall and 120 mm wide, on the outside of a shell of
            # 200 mm outer radius. The pad straddles the shell's seam, so its inner face is two.
            shell = occ.addCylinder(0, 0, 0, 0, 0, 300, 200)
            bore = occ.addCylinder(0, 0, -1, 0, 0, 302, 180)
            occ.cut([(3, shell)], [(3, bore)])
            ring = occ.addCylinder(0, 0, 100, 0, 0, 100, 230)
            inner = occ.addCylinder(0, 0, 99, 0, 0, 102, 200)
            (cut,), _ = occ.cut([(3, ring)], [(3, inner)])
            occ.intersect([cut], [(3, occ.addBox(150, -60, 90, 200, 120, 120))])
        elif build == "cylinder_on_plate":
            # A 20 mm rod lying on a plate: a line contact, not a bond.
            occ.addBox(0, 0, 0, 100, 100, 10)
            occ.addCylinder(10, 50, 20, 80, 0, 0, 10)
        else:
            raise ValueError(build)
        occ.synchronize()
        gmsh.write(str(path))
    finally:
        gmsh.finalize()
    return path


def block_with_hole(path: Path) -> Path:
    return _write(path, "block_with_hole")


def two_blocks(path: Path, names: tuple[str, str, str] | None = None) -> Path:
    """Two touching blocks as an assembly of two parts (M4.1), not fused.

    OpenCASCADE names its products "Open CASCADE STEP translator 7.8 N" (the assembly), "... N.1"
    and "... N.2" (the parts), N counting the files written in the process. ``names`` replaces
    these with an assembly name and two part names, as a CAD system writes them.
    """
    _write(path, "two_blocks")
    if names is not None:
        text = path.read_text()
        found = list(
            dict.fromkeys(re.findall(r"'Open CASCADE STEP translator [0-9.]+ [0-9.]+'", text))
        )
        if len(found) != 3:
            raise ValueError(f"expected three product names, found {found}")
        for placeholder, name in zip(found, names, strict=True):
            text = text.replace(placeholder, repr(name))
        path.write_text(text)
    return path


def bond_model(path: Path, build: str) -> Path:
    """A multi-body model for bond detection (M4.2): ``block_on_plate``, ``blocks_with_gap``,
    ``pin_in_hole``, ``pad_on_shell`` or ``cylinder_on_plate``."""
    return _write(path, build)


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
