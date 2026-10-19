# SPDX-License-Identifier: AGPL-3.0-or-later
"""The tutorial plate the live site offers for download is the one the guide's script writes.

apps/web/public/tutorial/plate-with-hole.step is served at /tutorial/plate-with-hole.step so
that beta users need no Python to follow docs/USER_GUIDE.md (M10.10, ADR-102). It is written by
docs/tutorial/plate_with_hole.py and must stay what that script writes (needs Gmsh).
"""

import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "docs" / "tutorial" / "plate_with_hole.py"
SERVED = ROOT / "apps" / "web" / "public" / "tutorial" / "plate-with-hole.step"


def _data(step: Path) -> str:
    """The file's DATA section: the header holds the time it was written."""
    text = step.read_text(encoding="utf-8")
    return text[text.index("\nDATA;") :]


def test_the_served_tutorial_plate_is_what_the_script_writes(tmp_path: Path) -> None:
    written = tmp_path / "plate-with-hole.step"
    runpy.run_path(str(SCRIPT))["main"](str(written))
    assert _data(SERVED) == _data(written), (
        "The served tutorial plate differs from docs/tutorial/plate_with_hole.py's. Write it again with "
        "`uv run --project worker python docs/tutorial/plate_with_hole.py "
        "apps/web/public/tutorial/plate-with-hole.step` and say why in the pull request."
    )
