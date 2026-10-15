# SPDX-License-Identifier: AGPL-3.0-or-later
"""V-25 geometry: V-09's quarter tube, between half-planes at 30 and 120 degrees about z,
written as a STEP file in millimetres.

    cd worker
    uv run python ../verification/cases/V-25-tube-in-elastic-sleeve/geometry.py OUT.step

Inner radius 40 mm, outer radius 60 mm, length 100 mm from z = 0 to z = 100. The cut faces
lean against the x and y axes on purpose, so the symmetry planes need the deck's local axes.
"""

import math
import sys

import gmsh

INNER, OUTER, LENGTH = 40.0, 60.0, 100.0
START, OPENING = 30.0, 90.0  # degrees about z


def main(path: str) -> None:
    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        # OpenCASCADE keeps an earlier import's unit for later writes; say it every time.
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        occ = gmsh.model.occ
        angle = math.radians(OPENING)
        outer = occ.addCylinder(0, 0, 0, 0, 0, LENGTH, OUTER, angle=angle)
        inner = occ.addCylinder(0, 0, 0, 0, 0, LENGTH, INNER, angle=angle)
        tube, _ = occ.cut([(3, outer)], [(3, inner)])
        occ.rotate(tube, 0, 0, 0, 0, 0, 1, math.radians(START))
        occ.synchronize()
        gmsh.write(path)
    finally:
        gmsh.finalize()


if __name__ == "__main__":
    main(sys.argv[1])
