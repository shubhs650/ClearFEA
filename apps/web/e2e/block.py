# SPDX-License-Identifier: AGPL-3.0-or-later
"""The E-01 model: a 40 x 20 x 10 mm block, written as a STEP file in millimetres.

    uv run --project worker python apps/web/e2e/block.py OUT.step

x from 0 to 40, y from 0 to 20, z from 0 to 10. infra/e2e.sh writes it before each run, so no
binary or generated file is committed.
"""

import sys

import gmsh


def main(path: str) -> None:
    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        # OpenCASCADE would otherwise keep the unit of an earlier import (M1.6).
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        gmsh.model.occ.addBox(0, 0, 0, 40, 20, 10)
        gmsh.model.occ.synchronize()
        gmsh.write(path)
    finally:
        gmsh.finalize()


if __name__ == "__main__":
    main(sys.argv[1])
