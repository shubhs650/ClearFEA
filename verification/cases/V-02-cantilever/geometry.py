# SPDX-License-Identifier: AGPL-3.0-or-later
"""V-02 geometry: a square bar along x, written as a STEP file in inches.

    uv run --directory worker python ../verification/cases/V-02-cantilever/geometry.py OUT.step

10 in long (x from 0 to 10), 1 in by 1 in (y and z from 0 to 1). The top face (y = 1) is split
at x = 9 in, so that the last inch of it is a face of its own for the end load. The split is an
imprint: the bar stays one body.
"""

import re
import sys
from pathlib import Path

import gmsh

LENGTH, SIDE, PATCH = 10.0, 1.0, 1.0


def main(path: str) -> None:
    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        # OpenCASCADE writes millimetres; the numbers are drawn as inches and the header's unit
        # is changed to inches below, the way CAD systems that work in inches export.
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        occ = gmsh.model.occ
        bar = occ.addBox(0, 0, 0, LENGTH, SIDE, SIDE)
        patch = occ.addRectangle(LENGTH - PATCH, 0, 0, PATCH, SIDE)
        # The rectangle is drawn in the xy plane; turn it onto the top face y = SIDE.
        occ.rotate([(2, patch)], LENGTH - PATCH, 0, 0, 1, 0, 0, 3.141592653589793 / 2)
        occ.translate([(2, patch)], 0, SIDE, 0)
        occ.fragment([(3, bar)], [(2, patch)])
        occ.synchronize()
        gmsh.write(path)
    finally:
        gmsh.finalize()
    step = Path(path)
    step.write_text(in_inches(step.read_text()))


_MM_UNIT = re.compile(
    r"\(\s*LENGTH_UNIT\(\)\s*NAMED_UNIT\(\*\)\s*SI_UNIT\(\.MILLI\.,\.METRE\.\)\s*\)"
)


def in_inches(text: str) -> str:
    """The STEP text with its millimetre length unit replaced by a conversion-based inch."""
    if len(_MM_UNIT.findall(text)) != 1:
        raise ValueError("expected exactly one millimetre length unit in the STEP file")
    last = max(int(n) for n in re.findall(r"^#(\d+)\s*=", text, re.M))
    a, b, c = last + 1, last + 2, last + 3
    unit = f"( CONVERSION_BASED_UNIT('INCH',#{a}) LENGTH_UNIT() NAMED_UNIT(#{c}) )"
    extra = (
        f"#{a} = LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),#{b});\n"
        f"#{b} = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );\n"
        f"#{c} = DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.);\n"
    )
    end = "ENDSEC;\nEND-ISO-10303-21;"
    if end not in text:
        raise ValueError("the STEP file does not end the way OpenCASCADE writes it")
    return _MM_UNIT.sub(unit, text).replace(end, extra + end)


if __name__ == "__main__":
    main(sys.argv[1])
