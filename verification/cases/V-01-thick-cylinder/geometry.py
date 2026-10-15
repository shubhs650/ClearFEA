# SPDX-License-Identifier: AGPL-3.0-or-later
"""V-01 geometry: a thick-walled tube along z, written as a STEP file in millimetres.

    uv run --directory worker python ../verification/cases/V-01-thick-cylinder/geometry.py OUT.step

Inner radius 40 mm, outer radius 60 mm, length 300 mm, from z = 0 to z = 300.
"""

import sys

import gmsh

INNER, OUTER, LENGTH = 40.0, 60.0, 300.0


def main(path: str) -> None:
    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        # OpenCASCADE keeps an earlier import's unit for later writes; say it every time.
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        occ = gmsh.model.occ
        outer = occ.addCylinder(0, 0, 0, 0, 0, LENGTH, OUTER)
        inner = occ.addCylinder(0, 0, 0, 0, 0, LENGTH, INNER)
        occ.cut([(3, outer)], [(3, inner)])
        occ.synchronize()
        gmsh.write(path)
    finally:
        gmsh.finalize()


if __name__ == "__main__":
    main(sys.argv[1])
