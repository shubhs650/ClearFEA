# SPDX-License-Identifier: AGPL-3.0-or-later
"""The published verification results page (M9.7): it reads what the harness writes, and the
committed page is what the committed result tables give."""

from pathlib import Path

import pytest

from harness.__main__ import LEDGER, Outcome, Row, table
from harness.cases import load_case
from harness.page import PAGE, PageError, build, from_log, parse, render

ROOT = Path(__file__).resolve().parents[3]
V01 = ROOT / "verification" / "cases" / "V-01-thick-cylinder"


def outcomes() -> list[Outcome]:
    case = Outcome(load_case(V01), mesh="5 mm, 10 elements, 30 nodes", seconds=41.2)
    case.software = {"clearfea": "0.0.0+abc", "calculix": "2.21", "occt": None}
    case.rows = [
        Row("Hoop stress", "32.187 MPa", "32.06 MPa (939 vertices)", "-0.39 %", "1 %", True),
        Row("Radial displacement", "0.0058 mm", "0.0059 mm (9 vertices)", "+1.7 %", "0.5 %", False),
    ]
    ledger = Outcome(LEDGER, rows=[Row("Balance", "1 credit", "1 credit", "", "exact", True)])
    return [case, ledger]


def test_reads_the_table_the_harness_writes() -> None:
    parsed = parse(table(outcomes(), "full"))
    assert parsed.tier == "full"
    v01, ledger = parsed.cases
    assert (v01.id, v01.title) == ("V-01", "Thick cylinder, internal pressure")
    assert v01.mesh == "5 mm, 10 elements, 30 nodes"
    assert v01.seconds == "41 s"
    assert v01.software == "clearfea 0.0.0+abc, calculix 2.21"
    assert [(r.check, r.error, r.within) for r in v01.rows] == [
        ("Hoop stress", "-0.39 %", True),
        ("Radial displacement", "+1.7 %", False),
    ]
    assert ledger.id == "Ledger" and ledger.rows[0].tolerance == "exact"


def test_page_states_numbers_and_marks_a_check_outside_its_tolerance() -> None:
    source = {"title": "Verification cases", "description": "a run."}
    page = render([source], [parse(table(outcomes(), "full"))])
    assert "1 cases, 2 of 3 checks within tolerance" in page
    assert (
        "| Radial displacement | 0.0058 mm | 0.0059 mm (9 vertices) | +1.7 % | 0.5 % | **no** |"
        in page
    )
    assert "[reference.md](../verification/cases/V-01-thick-cylinder/reference.md)" in page
    assert "(#v-01-thick-cylinder-internal-pressure)" in page
    # Numbers only: the page carries no verdict words (CLAUDE.md, ADR-073 item 7).
    for word in ("pass", "fail", "compliant", "compliance", "acceptable", "safe"):
        assert word not in page.lower()


def test_cuts_the_table_out_of_a_phase_end_log() -> None:
    text = table(outcomes(), "full")
    log = "\n".join(f"2026-10-17T10:20:49.4591071Z {line}" for line in text.splitlines())
    log = "2026-10-17T10:00:00.0Z [verify] V-01: pass\n" + log + "\n2026-10-17T10:21:00Z Done"
    assert from_log(log) == text + "\n"
    with pytest.raises(PageError):
        from_log("no table here")


def test_refuses_a_row_it_cannot_read() -> None:
    with pytest.raises(PageError):
        parse("Tier: full\n\n| V-01 | only | three |\n")


def test_committed_page_is_what_the_committed_results_give() -> None:
    # Regenerate: cd verification && uv run --project ../worker --locked python -m harness.page
    assert PAGE.read_text() == build()
