# SPDX-License-Identifier: AGPL-3.0-or-later
"""V-11 geometry: V-02's cantilever cut across at x = 3 in into two touching bodies, in inches.

    uv run --directory worker python ../verification/cases/V-11-bonded-blocks/geometry.py OUT.step

10 in long (x from 0 to 10), 1 in by 1 in (y and z from 0 to 1), as two parts of an assembly:
a root block from x = 0 to 3 in and an outer block from 3 to 10 in. They touch over the
1 in by 1 in face at x = 3 in and are not fused, so each has its own face there: one bond.
As in V-02 the top face is split at x = 9 in for the end load, an imprint on the outer block
only (imprinting both would fuse them).
"""

import re
import sys
from pathlib import Path

import gmsh

LENGTH, SIDE, PATCH, CUT = 10.0, 1.0, 1.0, 3.0


def main(path: str) -> None:
    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        # OpenCASCADE writes millimetres; the numbers are drawn as inches and the header's unit
        # is changed to inches below, the way CAD systems that work in inches export.
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        occ = gmsh.model.occ
        occ.addBox(0, 0, 0, CUT, SIDE, SIDE)
        outer = occ.addBox(CUT, 0, 0, LENGTH - CUT, SIDE, SIDE)
        patch = occ.addRectangle(LENGTH - PATCH, 0, 0, PATCH, SIDE)
        # The rectangle is drawn in the xy plane; turn it onto the top face y = SIDE.
        occ.rotate([(2, patch)], LENGTH - PATCH, 0, 0, 1, 0, 0, 3.141592653589793 / 2)
        occ.translate([(2, patch)], 0, SIDE, 0)
        occ.fragment([(3, outer)], [(2, patch)])
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
    """The STEP text with its millimetre length units replaced by a conversion-based inch."""
    # An assembly declares the unit once per part and once for the assembly.
    if not _MM_UNIT.findall(text):
        raise ValueError("expected a millimetre length unit in the STEP file")
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
