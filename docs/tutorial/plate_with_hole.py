# SPDX-License-Identifier: AGPL-3.0-or-later
"""The user guide's tutorial model: a plate with a central hole, written as a STEP file in mm.

    uv run --project worker python docs/tutorial/plate_with_hole.py plate-with-hole.step

The plate is 300 mm long along x, 100 mm wide along y and 5 mm thick along z, with a 10 mm hole
through its centre. x runs from 0 to 300 mm, y from 0 to 100 mm and z from 0 to 5 mm, so the
hole's axis is the line x = 150 mm, y = 50 mm. It is the whole plate of verification case V-03,
which models one eighth of it. No STEP file is kept in the repository.
"""

import sys

import gmsh

LENGTH, WIDTH, THICKNESS, RADIUS = 300.0, 100.0, 5.0, 5.0


def main(path: str) -> None:
    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        # OpenCASCADE keeps an earlier import's unit for later writes; say it every time.
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        occ = gmsh.model.occ
        plate = occ.addBox(0, 0, 0, LENGTH, WIDTH, THICKNESS)
        hole = occ.addCylinder(LENGTH / 2, WIDTH / 2, -1, 0, 0, THICKNESS + 2, RADIUS)
        occ.cut([(3, plate)], [(3, hole)])
        occ.synchronize()
        gmsh.write(path)
    finally:
        gmsh.finalize()


if __name__ == "__main__":
    main(sys.argv[1])
