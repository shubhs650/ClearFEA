# SPDX-License-Identifier: AGPL-3.0-or-later
import clearfea_worker


def test_package_imports() -> None:
    assert clearfea_worker.__version__ == "0.0.0"
