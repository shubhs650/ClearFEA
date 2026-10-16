# SPDX-License-Identifier: AGPL-3.0-or-later
"""V-21 geometry: a slender bar, written as a STEP file in mm (V-20, V-21 and V-22 share it).

    cd worker
    uv run python ../verification/cases/V-21-clamped-beam-frequencies/geometry.py OUT.step

800 mm long along x, 16 mm wide along y and 8 mm deep along z, from the origin.
"""

import sys

import gmsh

LENGTH, WIDTH, DEPTH = 800.0, 16.0, 8.0


def main(path: str) -> None:
    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        # OpenCASCADE keeps an earlier import's unit for later writes; say it every time.
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        gmsh.model.occ.addBox(0, 0, 0, LENGTH, WIDTH, DEPTH)
        gmsh.model.occ.synchronize()
        gmsh.write(path)
    finally:
        gmsh.finalize()


if __name__ == "__main__":
    main(sys.argv[1])
