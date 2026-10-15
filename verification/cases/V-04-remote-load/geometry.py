# SPDX-License-Identifier: AGPL-3.0-or-later
"""V-04 geometry: a round stub along x, written as a STEP file in millimetres.

    uv run --directory worker python ../verification/cases/V-04-remote-load/geometry.py OUT.step

Radius 15 mm, length 200 mm, from x = 0 to x = 200, its axis on the x axis.
"""

import sys

import gmsh

RADIUS, LENGTH = 15.0, 200.0


def main(path: str) -> None:
    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        # OpenCASCADE keeps an earlier import's unit for later writes; say it every time.
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        gmsh.model.occ.addCylinder(0, 0, 0, LENGTH, 0, 0, RADIUS)
        gmsh.model.occ.synchronize()
        gmsh.write(path)
    finally:
        gmsh.finalize()


if __name__ == "__main__":
    main(sys.argv[1])
