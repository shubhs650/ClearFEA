# SPDX-License-Identifier: AGPL-3.0-or-later
from clearfea_worker.versions import calculix_version, gmsh_version


def test_gmsh_package_is_the_pinned_version() -> None:
    assert gmsh_version() == "4.15.2"


def test_missing_calculix_returns_none() -> None:
    assert calculix_version("ccx-that-does-not-exist") is None
