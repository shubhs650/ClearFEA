# SPDX-License-Identifier: AGPL-3.0-or-later
"""V-06 geometry: a quarter of a thin ring, written as a STEP file in millimetres.

    uv run --directory worker python ../verification/cases/V-06-rotating-ring/geometry.py OUT.step

Inner radius 90 mm, outer radius 100 mm, in the quadrant x >= 0, y >= 0, from z = 0 to
z = 5 mm: a quarter of the upper half of a 10 mm thick ring, whose cut faces x = 0 and y = 0
and mid-plane z = 0 are its symmetry planes.
"""

import sys

import gmsh

INNER, OUTER, HALF = 90.0, 100.0, 5.0


def main(path: str) -> None:
    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        # OpenCASCADE keeps an earlier import's unit for later writes; say it every time.
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        occ = gmsh.model.occ
        quarter = 3.141592653589793 / 2
        outer = occ.addCylinder(0, 0, 0, 0, 0, HALF, OUTER, angle=quarter)
        inner = occ.addCylinder(0, 0, 0, 0, 0, HALF, INNER, angle=quarter)
        occ.cut([(3, outer)], [(3, inner)])
        occ.synchronize()
        gmsh.write(path)
    finally:
        gmsh.finalize()


if __name__ == "__main__":
    main(sys.argv[1])
