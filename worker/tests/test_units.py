# SPDX-License-Identifier: AGPL-3.0-or-later
"""Checks the unit module against the shared fixture that the TypeScript side also runs."""

import json
import math
from pathlib import Path

import pytest

from clearfea_worker.units import UnitError, default_table, from_si, load_table, to_si

FIXTURE = Path(__file__).resolve().parents[2] / "packages" / "spec" / "fixtures"
CASES = json.loads((FIXTURE / "unit-conversions.json").read_text(encoding="utf-8"))
TOLERANCE = CASES["relativeTolerance"]


def _label(case: dict) -> str:
    return f"{case['value']} {case['unit']} ({case['kind']})"


@pytest.mark.parametrize("case", CASES["conversions"], ids=_label)
def test_to_si(case: dict) -> None:
    got = to_si(case["value"], case["unit"], case["kind"])
    assert math.isclose(got, case["si"], rel_tol=TOLERANCE, abs_tol=0.0)


@pytest.mark.parametrize("case", CASES["conversions"], ids=_label)
def test_from_si(case: dict) -> None:
    got = from_si(case["si"], case["unit"], case["kind"])
    assert math.isclose(got, case["value"], rel_tol=TOLERANCE, abs_tol=0.0)


@pytest.mark.parametrize("case", CASES["errors"], ids=lambda c: c["reason"])
def test_refuses_unknown(case: dict) -> None:
    with pytest.raises(UnitError):
        to_si(1.0, case["unit"], case["kind"])


def test_table_has_m0_kinds() -> None:
    kinds = default_table().kinds
    assert {k: kinds[k].si for k in ("length", "force", "pressure")} == {
        "length": "m",
        "force": "N",
        "pressure": "Pa",
    }


def test_rejects_si_unit_with_factor(tmp_path: Path) -> None:
    bad = {
        "version": 1,
        "kinds": {"length": {"si": "m", "units": {"m": {"factor": 2, "definition": "wrong"}}}},
    }
    path = tmp_path / "units.json"
    path.write_text(json.dumps(bad), encoding="utf-8")
    with pytest.raises(UnitError, match="factor 1"):
        load_table(path)
