# SPDX-License-Identifier: AGPL-3.0-or-later
"""Values printed in the report's own unit system (PLAN M7.6)."""

import math

import pytest

from clearfea_worker.report import ReportUnits, format_number
from clearfea_worker.spec.simulation_schema import Quantity
from clearfea_worker.units import UnitError, default_table, to_si


@pytest.mark.parametrize(
    ("value", "text"),
    [
        (0.0, "0"),
        (-0.0, "0"),
        (1.0, "1"),
        (10.0, "10"),
        (1450.377, "1450"),
        (14503.77, "14500"),
        (100e6, "100000000"),
        (-0.1234567, "-0.1235"),
        (9.99996, "10"),
        (0.000123456, "0.0001235"),
        (1.5e-6, "0.0000015"),
        (1.23456e-7, "1.235e-07"),
        (6.02e23, "6.02e+23"),
    ],
)
def test_format_number(value: float, text: str) -> None:
    assert format_number(value) == text


def test_format_number_refuses_nan() -> None:
    with pytest.raises(ValueError):
        format_number(math.nan)


@pytest.mark.parametrize(
    ("system", "stress", "displacement", "temperature"),
    [
        ("metric-mm", "100 MPa", "0.25 mm", "26.85 °C"),
        ("si", "100000000 Pa", "0.00025 m", "300 K"),
        ("us-in", "14500 psi", "0.009843 in", "80.33 °F"),
    ],
)
def test_results_print_in_the_report_system(
    system: str, stress: str, displacement: str, temperature: str
) -> None:
    # Results are stored in SI (Pa, m, K) and print in the report's system, never another.
    units = ReportUnits.of(system)
    assert units.text(100e6, "pressure") == stress
    assert units.text(0.25e-3, "length") == displacement
    assert units.text(300.0, "temperature") == temperature


def test_setup_values_print_converted_and_as_entered() -> None:
    us = ReportUnits.of("us-in")
    assert us.quantity_text(Quantity(value=10, unit="MPa"), "pressure") == (
        "1450 psi (entered as 10 MPa)"
    )
    # Typed in the report's own unit: printed once, exactly as typed.
    assert us.quantity_text(Quantity(value=150, unit="psi"), "pressure") == "150 psi"
    metric = ReportUnits.of("metric-mm")
    # A temperature change converts without the offset; a temperature with it.
    assert metric.quantity_text(Quantity(value=90, unit="°F"), "temperatureDifference") == (
        "50 °C (entered as 90 °F)"
    )
    assert metric.quantity_text(Quantity(value=212, unit="°F"), "temperature") == (
        "100 °C (entered as 212 °F)"
    )


def test_quantity_value_round_trips_through_si() -> None:
    us = ReportUnits.of("us-in")
    value = us.quantity_value(Quantity(value=3, unit="kN"), "force")
    assert math.isclose(to_si(value, "lbf", "force"), 3000.0, rel_tol=1e-12)


def test_vectors_and_ratios() -> None:
    metric = ReportUnits.of("metric-mm")
    assert metric.vector_text([0.001, 0.0025, 0.0], "length") == "(1, 2.5, 0) mm"
    assert metric.text(1.83333, "ratio") == "1.833"


def test_names_its_system_and_units() -> None:
    us = ReportUnits.of("us-in")
    assert us.name == "US (in, lbf, psi)"
    assert us.units(["length", "force", "pressure"]) == [
        ("length", "in"),
        ("force", "lbf"),
        ("pressure", "psi"),
    ]


def test_every_system_prints_every_kind() -> None:
    table = default_table()
    for system in table.systems:
        units = ReportUnits.of(system)
        for kind in table.kinds:
            assert units.text(1.0, kind)


def test_refuses_unknown_system_and_kind() -> None:
    with pytest.raises(UnitError, match="not a unit system"):
        ReportUnits.of("imperial-ft")
    with pytest.raises(UnitError):
        ReportUnits.of("si").unit("luminosity")
    with pytest.raises(UnitError):
        ReportUnits.of("si").quantity_text(Quantity(value=1, unit="psi"), "length")
