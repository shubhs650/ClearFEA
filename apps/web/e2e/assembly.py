# SPDX-License-Identifier: AGPL-3.0-or-later
"""The E-03 model: two blocks touching end to end, written as a STEP assembly in millimetres.

    uv run --project worker python apps/web/e2e/assembly.py OUT.step

"Base" is 40 x 20 x 10 mm, x from 0 to 40; "Lug" is 30 x 20 x 10 mm, x from -30 to 0. Both span
y from 0 to 20 and z from 0 to 10, so they touch over the 20 x 10 mm face at x = 0, which the
import finds as one bond (ADR-059). The parts are not fused: each is a body of its own (ADR-058).
OpenCASCADE names its products "Open CASCADE STEP translator ..."; they are replaced with an
assembly name and two part names, as a CAD system writes them. infra/e2e.sh writes the file
before each run, so no binary or generated file is committed.
"""

import re
import sys
from pathlib import Path

import gmsh

NAMES = ("Bracket", "Base", "Lug")


def main(path: str) -> None:
    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        # OpenCASCADE would otherwise keep the unit of an earlier import (M1.6).
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        gmsh.model.occ.addBox(0, 0, 0, 40, 20, 10)
        gmsh.model.occ.addBox(-30, 0, 0, 30, 20, 10)
        gmsh.model.occ.synchronize()
        gmsh.write(path)
    finally:
        gmsh.finalize()
    out = Path(path)
    text = out.read_text()
    # The assembly first, then the parts in the order they were made.
    found = list(
        dict.fromkeys(
            re.findall(r"'Open CASCADE STEP translator [0-9.]+ [0-9.]+'", text)
        )
    )
    if len(found) != 3:
        raise ValueError(f"expected three product names, found {found}")
    for placeholder, name in zip(found, NAMES, strict=True):
        text = text.replace(placeholder, repr(name))
    out.write_text(text)


if __name__ == "__main__":
    main(sys.argv[1])
