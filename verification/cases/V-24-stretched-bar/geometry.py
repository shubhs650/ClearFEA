# SPDX-License-Identifier: AGPL-3.0-or-later
"""V-24 geometry: a quarter of a 1 in square bar, 4 in long along x, written in inches.

    uv run --directory worker python ../verification/cases/V-24-stretched-bar/geometry.py OUT.step

The bar's section is 0.5 in by 0.5 in, from y = 0 and z = 0, which are its symmetry planes.
"""

import sys

import gmsh

LENGTH, HALF = 4.0, 0.5


def main(path: str) -> None:
    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        # OpenCASCADE keeps an earlier import's unit for later writes; say it every time.
        gmsh.option.setString("Geometry.OCCTargetUnit", "INCH")
        gmsh.model.occ.addBox(0, 0, 0, LENGTH, HALF, HALF)
        gmsh.model.occ.synchronize()
        gmsh.write(path)
    finally:
        gmsh.finalize()


if __name__ == "__main__":
    main(sys.argv[1])
