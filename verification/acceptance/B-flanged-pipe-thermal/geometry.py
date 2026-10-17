# SPDX-License-Identifier: AGPL-3.0-or-later
"""Acceptance case B geometry: a quarter of a thick-walled flanged pipe section, between the
half-planes x = 0 and y = 0, written as a STEP file in millimetres.

    cd worker
    uv run python ../verification/acceptance/B-flanged-pipe-thermal/geometry.py OUT.step

An original design for this project (M9.4), not taken from a standard, book or drawing:

- Pipe: bore radius 100 mm, outside radius 150 mm (a 50 mm wall), along z from z = 0, the
  mid-length plane of a 800 mm long spool that the model halves, to z = 400 mm.
- Flange: an integral collar of outside radius 230 mm from z = 340 mm to the end at
  z = 400 mm, with the same bore.

One body, named "Flanged pipe" in place of OpenCASCADE's placeholder product name. Away from
the flange (below about z = 140 mm) the wall is a long thick cylinder, whose through-wall
temperatures and thermal stresses have closed forms.
"""

import math
import re
import sys
from pathlib import Path

import gmsh

#: Bore, pipe outside and flange outside radius, in mm.
BORE_R, PIPE_R, FLANGE_R = 100.0, 150.0, 230.0
#: The model's length from the mid-length plane, and where the flange starts, in mm.
LENGTH, FLANGE_Z = 400.0, 340.0


def main(path: str) -> None:
    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        # OpenCASCADE keeps an earlier import's unit for later writes; say it every time.
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        occ = gmsh.model.occ
        quarter = math.pi / 2
        pipe = occ.addCylinder(0, 0, 0, 0, 0, LENGTH, PIPE_R, angle=quarter)
        flange = occ.addCylinder(0, 0, FLANGE_Z, 0, 0, LENGTH - FLANGE_Z, FLANGE_R, angle=quarter)
        body, _ = occ.fuse([(3, pipe)], [(3, flange)])
        bore = occ.addCylinder(0, 0, 0, 0, 0, LENGTH, BORE_R, angle=quarter)
        body, _ = occ.cut(body, [(3, bore)])
        if len(body) != 1:
            raise RuntimeError(f"expected one solid, got {body}")
        occ.synchronize()
        gmsh.write(path)
    finally:
        gmsh.finalize()
    step = Path(path)
    text = step.read_text()
    found = set(re.findall(r"'Open CASCADE STEP translator [0-9.]+ [0-9.]+'", text))
    if len(found) != 1:
        raise ValueError(f"expected one product name, found {found}")
    step.write_text(text.replace(found.pop(), repr("Flanged pipe")))


if __name__ == "__main__":
    main(sys.argv[1])
