# SPDX-License-Identifier: AGPL-3.0-or-later
"""V-26 geometry: a quarter of a 20 mm square bar, 200 mm long along x, written in mm.

    uv run --directory worker python ../verification/cases/V-26-first-order-bar/geometry.py OUT.step

The section is 10 mm by 10 mm, from y = 0 and z = 0, which are the bar's symmetry planes.
"""

import sys

import gmsh

LENGTH, HALF = 200.0, 10.0


def main(path: str) -> None:
    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        # OpenCASCADE keeps an earlier import's unit for later writes; say it every time.
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        gmsh.model.occ.addBox(0, 0, 0, LENGTH, HALF, HALF)
        gmsh.model.occ.synchronize()
        gmsh.write(path)
    finally:
        gmsh.finalize()


if __name__ == "__main__":
    main(sys.argv[1])
