# SPDX-License-Identifier: AGPL-3.0-or-later
"""V-05 geometry: a strip of tank wall standing on its base, written as a STEP file in mm.

    uv run --directory worker python ../verification/cases/V-05-tank-wall/geometry.py OUT.step

Width 100 mm along x, thickness 20 mm along y, height 500 mm along z, from the origin. The
water is on the y = 0 side.
"""

import sys

import gmsh

WIDTH, THICKNESS, HEIGHT = 100.0, 20.0, 500.0


def main(path: str) -> None:
    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        # OpenCASCADE keeps an earlier import's unit for later writes; say it every time.
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        gmsh.model.occ.addBox(0, 0, 0, WIDTH, THICKNESS, HEIGHT)
        gmsh.model.occ.synchronize()
        gmsh.write(path)
    finally:
        gmsh.finalize()


if __name__ == "__main__":
    main(sys.argv[1])
