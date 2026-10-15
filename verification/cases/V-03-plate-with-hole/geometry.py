# SPDX-License-Identifier: AGPL-3.0-or-later
"""V-03 geometry: a quarter of a plate with a central hole, written as a STEP file in mm.

    uv run --directory worker python ../verification/cases/V-03-plate-with-hole/geometry.py OUT.step

The whole plate is 300 mm long along x, 100 mm wide along y and 5 mm thick, with a 10 mm hole
through its centre. The quarter kept is x from 0 to 150 mm, y from 0 to 50 mm and the lower half
of the thickness, z from 0 to 2.5 mm, with the hole's axis on the z axis.
"""

import sys

import gmsh

HALF_LENGTH, HALF_WIDTH, HALF_THICKNESS, RADIUS = 150.0, 50.0, 2.5, 5.0


def main(path: str) -> None:
    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        # OpenCASCADE keeps an earlier import's unit for later writes; say it every time.
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        occ = gmsh.model.occ
        plate = occ.addBox(0, 0, 0, HALF_LENGTH, HALF_WIDTH, HALF_THICKNESS)
        hole = occ.addCylinder(0, 0, -1, 0, 0, HALF_THICKNESS + 2, RADIUS)
        occ.cut([(3, plate)], [(3, hole)])
        occ.synchronize()
        gmsh.write(path)
    finally:
        gmsh.finalize()


if __name__ == "__main__":
    main(sys.argv[1])
