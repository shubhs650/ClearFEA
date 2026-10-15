# SPDX-License-Identifier: AGPL-3.0-or-later
from clearfea_worker import __version__
from clearfea_worker.deck.generator import DECK_FORMAT
from clearfea_worker.versions import (
    calculix_version,
    clearfea_version,
    gmsh_version,
    worker_software,
)


def test_gmsh_package_is_the_pinned_version() -> None:
    assert gmsh_version() == "4.15.2"


def test_missing_calculix_returns_none() -> None:
    assert calculix_version("ccx-that-does-not-exist") is None


def test_clearfea_version_names_the_commit_when_the_build_recorded_one() -> None:
    assert clearfea_version({}) == __version__
    assert (
        clearfea_version({"CLEARFEA_COMMIT": " d9d394b-dirty\n"}) == f"{__version__}+d9d394b-dirty"
    )


def test_worker_software_reports_the_deck_format_and_solvers() -> None:
    software = worker_software({"CLEARFEA_COMMIT": "d9d394b"})
    assert software.clearfea == f"{__version__}+d9d394b"
    assert software.deck_format == DECK_FORMAT
    assert software.gmsh == gmsh_version()
    assert software.calculix == calculix_version()
