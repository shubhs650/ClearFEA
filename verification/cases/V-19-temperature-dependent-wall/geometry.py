# SPDX-License-Identifier: AGPL-3.0-or-later
"""V-19 geometry: a flat wall, written as a STEP file in mm.

    cd worker && uv run python \
        ../verification/cases/V-19-temperature-dependent-wall/geometry.py OUT.step

40 mm thick along x and 20 mm by 20 mm along y and z, from the origin.
"""

import sys

import gmsh

THICKNESS, WIDTH, HEIGHT = 40.0, 20.0, 20.0


def main(path: str) -> None:
    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        # OpenCASCADE keeps an earlier import's unit for later writes; say it every time.
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        gmsh.model.occ.addBox(0, 0, 0, THICKNESS, WIDTH, HEIGHT)
        gmsh.model.occ.synchronize()
        gmsh.write(path)
    finally:
        gmsh.finalize()


if __name__ == "__main__":
    main(sys.argv[1])
