# SPDX-License-Identifier: AGPL-3.0-or-later
import pytest

from clearfea_worker.geometry.step_units import (
    NO_UNIT_READING_FACTOR,
    StepFormatError,
    detect_length_unit,
)
from clearfea_worker.units import to_si

from .step_text import context, conversion, si_length, step


@pytest.mark.parametrize(("prefix", "symbol"), [("$", "m"), (".CENTI.", "cm"), (".MILLI.", "mm")])
def test_reads_si_length_units(prefix: str, symbol: str) -> None:
    detection = detect_length_unit(step(context("#11", "#12") + si_length(prefix)))
    assert detection.unit is not None
    assert detection.unit.symbol == symbol
    assert detection.problem is None
    assert detection.reading_factor == to_si(1.0, symbol, "length")
    assert detection.declared == f"SI_UNIT({prefix},.METRE.)"


@pytest.mark.parametrize(
    ("name", "factor", "symbol"),
    [("INCH", 25.4, "in"), ("inch", 25.4, "in"), ("FOOT", 304.8, "ft")],
)
def test_reads_conversion_based_units(name: str, factor: float, symbol: str) -> None:
    detection = detect_length_unit(step(context("#11", "#12") + conversion(name, factor)))
    assert detection.unit is not None
    assert detection.unit.symbol == symbol
    assert detection.reading_factor == pytest.approx(to_si(1.0, symbol, "length"), rel=1e-12)


def test_no_declared_unit_reads_coordinates_as_metres() -> None:
    detection = detect_length_unit(step(context("#12")))
    assert detection.unit is None
    assert detection.declared is None
    assert detection.problem == "The file does not declare a length unit."
    assert detection.reading_factor == NO_UNIT_READING_FACTOR == 1.0


def test_unsupported_si_prefix_has_no_reading_factor() -> None:
    detection = detect_length_unit(step(context("#11", "#12") + si_length(".MICRO.")))
    assert detection.unit is None
    assert detection.problem is not None and "MICRO" in detection.problem
    assert detection.reading_factor is None


def test_unknown_conversion_unit_keeps_the_files_factor() -> None:
    detection = detect_length_unit(step(context("#11", "#12") + conversion("THOU", 0.0254)))
    assert detection.unit is None
    assert detection.problem == "The file's length unit 'THOU' is not supported."
    assert detection.reading_factor == pytest.approx(2.54e-5, rel=1e-12)


def test_an_inch_that_disagrees_with_the_table_is_refused_but_readable() -> None:
    detection = detect_length_unit(step(context("#11", "#12") + conversion("INCH", 25.0)))
    assert detection.unit is None
    assert detection.problem is not None and "units table" in detection.problem
    assert detection.reading_factor == pytest.approx(0.025, rel=1e-12)


def test_several_different_units_give_no_unit() -> None:
    text = step(context("#11", "#12") + si_length(".MILLI.") + si_length("$", ref=14)).replace(
        "#10 =",
        "#15 = ( GEOMETRIC_REPRESENTATION_CONTEXT(3) "
        "GLOBAL_UNIT_ASSIGNED_CONTEXT((#14)) REPRESENTATION_CONTEXT('b','') );\n#10 =",
    )
    detection = detect_length_unit(text)
    assert detection.unit is None
    assert detection.problem is not None and "more than one" in detection.problem
    assert detection.reading_factor is None


def test_the_same_unit_in_two_contexts_is_one_unit() -> None:
    text = step(context("#11", "#12") + si_length(".MILLI.")).replace(
        "#10 =",
        "#15 = ( GEOMETRIC_REPRESENTATION_CONTEXT(3) "
        "GLOBAL_UNIT_ASSIGNED_CONTEXT((#11)) REPRESENTATION_CONTEXT('b','') );\n#10 =",
    )
    detection = detect_length_unit(text)
    assert detection.unit is not None and detection.unit.symbol == "mm"


def test_an_unrecognised_length_unit_is_not_mistaken_for_none() -> None:
    text = step(context("#11", "#12") + "#11 = ( LENGTH_UNIT() NAMED_UNIT(*) ODD_UNIT() );\n")
    detection = detect_length_unit(text)
    assert detection.unit is None
    assert detection.found
    assert detection.reading_factor is None


def test_semicolons_in_strings_and_comments_do_not_split_entities() -> None:
    data = (
        "/* a comment; with a semicolon */\n"
        "#1 = PRODUCT('part;1','it''s; here','',(#2));\n" + context("#11", "#12") + si_length()
    )
    detection = detect_length_unit(step(data))
    assert detection.unit is not None and detection.unit.symbol == "m"


@pytest.mark.parametrize("text", ["solid cube\nendsolid", "ISO-10303-21;\nHEADER;\nENDSEC;\n"])
def test_refuses_text_that_is_not_step(text: str) -> None:
    with pytest.raises(StepFormatError):
        detect_length_unit(text)
