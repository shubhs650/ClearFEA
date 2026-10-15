# SPDX-License-Identifier: AGPL-3.0-or-later
"""V-07 geometry: a block resting on its base, written as a STEP file in mm.

    uv run --directory worker python ../verification/cases/V-07-elastic-block/geometry.py OUT.step

100 mm along x, 60 mm along y, 40 mm high along z, from the origin.
"""

import sys

import gmsh

LENGTH, WIDTH, HEIGHT = 100.0, 60.0, 40.0


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
