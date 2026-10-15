# SPDX-License-Identifier: AGPL-3.0-or-later
"""V-24 geometry: a quarter of a 1 in square bar, 4 in long along x, written in inches.

    uv run --directory worker python ../verification/cases/V-24-stretched-bar/geometry.py OUT.step

The bar's section is 0.5 in by 0.5 in, from y = 0 and z = 0, which are its symmetry planes.
The inch header is written the way V-02 writes it (its geometry.py; a copy keeps each case
standalone).
"""

import re
import sys
from pathlib import Path

import gmsh

LENGTH, HALF = 4.0, 0.5


def main(path: str) -> None:
    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        # OpenCASCADE writes millimetres; the numbers are drawn as inches and the header's unit
        # is changed to inches below, the way CAD systems that work in inches export.
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        gmsh.model.occ.addBox(0, 0, 0, LENGTH, HALF, HALF)
        gmsh.model.occ.synchronize()
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
