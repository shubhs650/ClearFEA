# SPDX-License-Identifier: AGPL-3.0-or-later
"""V-08 geometry: a straight bar of rectangular section, written as a STEP file in mm.

    uv run --directory worker python ../verification/cases/V-08-heated-bar/geometry.py OUT.step

200 mm along x, 20 mm along y and 10 mm along z, from the origin.
"""

import sys

import gmsh

LENGTH, WIDTH, HEIGHT = 200.0, 20.0, 10.0


def main(path: str) -> None:
    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        # OpenCASCADE keeps an earlier import's unit for later writes; say it every time.
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        gmsh.model.occ.addBox(0, 0, 0, LENGTH, WIDTH, HEIGHT)
        gmsh.model.occ.synchronize()
        gmsh.write(path)
    finally:
        gmsh.finalize()


if __name__ == "__main__":
    main(sys.argv[1])
