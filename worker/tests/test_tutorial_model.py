# SPDX-License-Identifier: AGPL-3.0-or-later
"""The tutorial plate the live site offers for download is the one the guide's script writes.

apps/web/public/tutorial/plate-with-hole.step is served at /tutorial/plate-with-hole.step so
that beta users need no Python to follow docs/USER_GUIDE.md (M10.10, ADR-102). It is written by
docs/tutorial/plate_with_hole.py and must stay the same part (needs Gmsh). The files are compared
as geometry, not text: OpenCASCADE numbers its writes within a process and stamps the time.
"""

import math
import runpy
from pathlib import Path

import gmsh
import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "docs" / "tutorial" / "plate_with_hole.py"
SERVED = ROOT / "apps" / "web" / "public" / "tutorial" / "plate-with-hole.step"


def _part(step: Path) -> tuple[int, int, float, list[float]]:
    """Bodies, faces, volume (mm³) and bounding box (mm) of a STEP file read in mm."""
    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        gmsh.model.occ.importShapes(str(step))
        gmsh.model.occ.synchronize()
        bodies = gmsh.model.getEntities(3)
        volume = sum(gmsh.model.occ.getMass(3, tag) for _, tag in bodies)
        return (
            len(bodies),
            len(gmsh.model.getEntities(2)),
            volume,
            list(gmsh.model.getBoundingBox(-1, -1)),
        )
    finally:
        gmsh.finalize()


def test_the_served_tutorial_plate_is_what_the_script_writes(tmp_path: Path) -> None:
    written = tmp_path / "plate-with-hole.step"
    runpy.run_path(str(SCRIPT))["main"](str(written))
    served, expected = _part(SERVED), _part(written)
    assert served[:2] == expected[:2] == (1, 7)
    assert served[2] == pytest.approx(expected[2], rel=1e-9)
    assert served[2] == pytest.approx(300 * 100 * 5 - math.pi * 5**2 * 5, rel=1e-6)
    assert served[3] == pytest.approx(expected[3], abs=1e-6)
    assert served[3][3:] == pytest.approx([300, 100, 5], abs=1e-3)
