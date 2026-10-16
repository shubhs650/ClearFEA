# SPDX-License-Identifier: AGPL-3.0-or-later
"""V-12 geometry: a quarter of a square bar of two materials, two bodies end to end, in mm.

    uv run --directory worker python ../verification/cases/V-12-bimaterial-bar/geometry.py OUT.step

A quarter of a 20 mm square bar: y and z from 0 to 10 mm, the symmetry planes y = 0 and z = 0.
Body 1 runs from x = 0 to 100 mm and body 2 from 100 to 160 mm. They touch over the 10 mm by
10 mm face at x = 100 mm and are not fused: one bond, crossing both symmetry planes.
"""

import sys

import gmsh

L1, L2, HALF = 100.0, 60.0, 10.0


def main(path: str) -> None:
    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        gmsh.model.occ.addBox(0, 0, 0, L1, HALF, HALF)
        gmsh.model.occ.addBox(L1, 0, 0, L2, HALF, HALF)
        gmsh.model.occ.synchronize()
        gmsh.write(path)
    finally:
        gmsh.finalize()


if __name__ == "__main__":
    main(sys.argv[1])
