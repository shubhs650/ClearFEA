# SPDX-License-Identifier: AGPL-3.0-or-later
"""V-27 geometry: a quarter of a tube of two layers between the half-planes x = 0 and y = 0, a
slice along z, two bodies written as a STEP file in millimetres.

    uv run --directory worker python ../verification/cases/V-27-two-layer-tube/geometry.py OUT.step

Body 1, the inner layer, from radius 40 to 50 mm; body 2, the outer layer, from 50 to 60 mm;
both from z = 0 to z = 20 mm. They touch over the cylinder r = 50 mm and are not fused: one
bond, a curved face crossing both cut planes.
"""

import math
import sys

import gmsh

INNER, MIDDLE, OUTER, LENGTH = 40.0, 50.0, 60.0, 20.0


def main(path: str) -> None:
    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        # OpenCASCADE keeps an earlier import's unit for later writes; say it every time.
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        occ = gmsh.model.occ
        for inner, outer in ((INNER, MIDDLE), (MIDDLE, OUTER)):
            ring = occ.addCylinder(0, 0, 0, 0, 0, LENGTH, outer, angle=math.pi / 2)
            hole = occ.addCylinder(0, 0, 0, 0, 0, LENGTH, inner, angle=math.pi / 2)
            occ.cut([(3, ring)], [(3, hole)])
        occ.synchronize()
        gmsh.write(path)
    finally:
        gmsh.finalize()


if __name__ == "__main__":
    main(sys.argv[1])
