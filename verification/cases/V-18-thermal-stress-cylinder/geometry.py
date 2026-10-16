# SPDX-License-Identifier: AGPL-3.0-or-later
"""V-18 geometry: a quarter of a thick-walled tube between the half-planes x = 0 and y = 0, a
slice along z, written as a STEP file in millimetres.

    cd worker
    uv run python ../verification/cases/V-18-thermal-stress-cylinder/geometry.py OUT.step

Inner radius 40 mm, outer radius 60 mm, from z = 0 to z = 20 mm.
"""

import math
import sys

import gmsh

INNER, OUTER, LENGTH = 40.0, 60.0, 20.0


def main(path: str) -> None:
    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        # OpenCASCADE keeps an earlier import's unit for later writes; say it every time.
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        occ = gmsh.model.occ
        outer = occ.addCylinder(0, 0, 0, 0, 0, LENGTH, OUTER, angle=math.pi / 2)
        inner = occ.addCylinder(0, 0, 0, 0, 0, LENGTH, INNER, angle=math.pi / 2)
        occ.cut([(3, outer)], [(3, inner)])
        occ.synchronize()
        gmsh.write(path)
    finally:
        gmsh.finalize()


if __name__ == "__main__":
    main(sys.argv[1])
