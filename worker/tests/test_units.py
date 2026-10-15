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


def test_temperature_and_difference_are_separate_kinds() -> None:
    # A 50 °C rise is 50 K; a temperature of 50 °C is 323.15 K (ARCHITECTURE.md section 5).
    assert to_si(50.0, "°C", "temperatureDifference") == 50.0
    assert math.isclose(to_si(50.0, "°C", "temperature"), 323.15, rel_tol=TOLERANCE)


def test_every_system_names_a_unit_for_every_kind() -> None:
    table = default_table()
    assert table.default_system in table.systems
    for system in table.systems.values():
        assert set(system.units) == set(table.kinds)
        for kind, unit in system.units.items():
            assert unit in table.kinds[kind].units


def _table(**changes: object) -> dict:
    table: dict = {
        "version": 2,
        "kinds": {"length": {"si": "m", "units": {"m": {"factor": 1, "definition": "SI"}}}},
        "systems": {"si": {"name": "SI", "units": {"length": "m"}}},
        "defaultSystem": "si",
    }
    table.update(changes)
    return table


def _load(tmp_path: Path, table: dict) -> None:
    path = tmp_path / "units.json"
    path.write_text(json.dumps(table), encoding="utf-8")
    load_table(path)


def test_accepts_a_minimal_table(tmp_path: Path) -> None:
    _load(tmp_path, _table())


def test_rejects_si_unit_with_factor(tmp_path: Path) -> None:
    kinds = {"length": {"si": "m", "units": {"m": {"factor": 2, "definition": "wrong"}}}}
    with pytest.raises(UnitError, match="factor 1"):
        _load(tmp_path, _table(kinds=kinds))


def test_rejects_system_without_a_kind(tmp_path: Path) -> None:
    with pytest.raises(UnitError, match="must name a length unit"):
        _load(tmp_path, _table(systems={"si": {"name": "SI", "units": {}}}))


def test_rejects_system_unit_of_another_kind(tmp_path: Path) -> None:
    with pytest.raises(UnitError, match="must name a length unit"):
        _load(tmp_path, _table(systems={"si": {"name": "SI", "units": {"length": "Pa"}}}))


def test_rejects_system_naming_an_unknown_kind(tmp_path: Path) -> None:
    systems = {"si": {"name": "SI", "units": {"length": "m", "stress": "Pa"}}}
    with pytest.raises(UnitError, match="not a quantity kind"):
        _load(tmp_path, _table(systems=systems))


def test_rejects_unknown_default_system(tmp_path: Path) -> None:
    with pytest.raises(UnitError, match="default unit system"):
        _load(tmp_path, _table(defaultSystem="us"))
