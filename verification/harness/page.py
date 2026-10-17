# SPDX-License-Identifier: AGPL-3.0-or-later
"""Writes the published verification results page, docs/VERIFICATION_RESULTS.md (M9.7).

    cd verification && uv run --project ../worker --locked python -m harness.page [--check]
    ... python -m harness.page --from-log LOG --to results/suite.md

The page is made from result tables the harness printed (`results.md` of `make verify`, or the
same table in a phase-end run's log), kept in verification/results/ and named with their run in
verification/results/sources.json. `--check` exits 1 when the committed page is not what the
committed tables give, so `make test` catches a hand edit or a forgotten regeneration.
`--from-log` cuts the table out of a downloaded GitHub Actions log, dropping the timestamps.
"""

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "verification" / "results"
PAGE = ROOT / "docs" / "VERIFICATION_RESULTS.md"
FOLDERS = [ROOT / "verification" / "cases", ROOT / "verification" / "acceptance"]
#: The write-up beside each case that says where its reference values come from.
WRITE_UPS = ["reference.md", "hand_checks.md", "model.md"]
COLUMNS = ["Case", "Check", "Reference", "ClearFEA", "Error", "Tolerance", "Result"]
_STAMP = re.compile(r"^\d{4}-\d\d-\d\dT[\d:.]+Z ")


class PageError(ValueError):
    pass


@dataclass
class Row:
    check: str
    reference: str
    computed: str
    error: str
    tolerance: str
    within: bool


@dataclass
class CaseResult:
    id: str
    rows: list[Row] = field(default_factory=list)
    title: str = ""
    mesh: str = ""
    seconds: str = ""
    software: str = ""


@dataclass
class Table:
    tier: str
    cases: list[CaseResult]


def from_log(log: str) -> str:
    """The result table of a phase-end run's log: from its "Tier:" line to its count line."""
    lines = [_STAMP.sub("", line) for line in log.splitlines()]
    starts = [i for i, line in enumerate(lines) if line.startswith("Tier: ")]
    if not starts:
        raise PageError("The log has no result table (no 'Tier:' line).")
    start = starts[-1]
    for end in range(start, len(lines)):
        if re.match(r"\d+ of \d+ checks passed", lines[end]):
            return "\n".join(lines[start : end + 1]) + "\n"
    raise PageError("The log's result table has no closing count line.")


def parse(text: str) -> Table:
    """Reads a result table as `harness.__main__.table` writes it."""
    lines = text.splitlines()
    if not lines or not lines[0].startswith("Tier: "):
        raise PageError("A result table starts with its 'Tier:' line.")
    tier = lines[0].removeprefix("Tier: ").strip()
    cases: dict[str, CaseResult] = {}
    for line in lines[1:]:
        if line.startswith("| "):
            cells = [c.strip() for c in line.strip().strip("|").split(" | ")]
            if len(cells) != len(COLUMNS):
                raise PageError(f"A table row has {len(cells)} cells, not 7: {line}")
            if cells == COLUMNS or set(cells[0]) == {"-"}:
                continue
            case_id, check, reference, computed, error, tolerance, result = cells
            if result not in ("pass", "FAILED"):
                raise PageError(f"Unknown result {result!r} in: {line}")
            case = cases.setdefault(case_id, CaseResult(case_id))
            case.rows.append(Row(check, reference, computed, error, tolerance, result == "pass"))
        elif line.startswith("- "):
            head, sep, rest = line[2:].partition(": mesh ")
            case_id, _, title = head.partition(" ")
            if not sep or case_id not in cases:
                raise PageError(f"A case line that names no case of the table: {line}")
            parts = rest.split("; ")
            case = cases[case_id]
            case.title, case.mesh, case.seconds = title, parts[0], parts[1]
            case.software = parts[-1] if parts[-1].startswith("clearfea ") else ""
    return Table(tier, list(cases.values()))


def write_up(case_id: str) -> str | None:
    """The case's write-up, relative to docs/, or None for a row group such as the ledger."""
    for folder in FOLDERS:
        for path in sorted(folder.glob(f"{case_id}-*")):
            for name in WRITE_UPS:
                if (path / name).exists():
                    return f"../{(path / name).relative_to(ROOT).as_posix()}"
    return None


def _cell(text: str) -> str:
    return text.replace("|", "\\|") or " "


def _case_table(case: CaseResult) -> list[str]:
    lines = [
        "| Check | Reference | ClearFEA | Error | Tolerance | Within tolerance |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for r in case.rows:
        cells = [r.check, r.reference, r.computed, r.error, r.tolerance]
        cells.append("yes" if r.within else "**no**")
        lines.append("| " + " | ".join(_cell(c) for c in cells) + " |")
    return lines


def _anchor(case: CaseResult) -> str:
    text = f"{case.id} {case.title}".lower()
    return re.sub(r"[^\w\- ]", "", text).replace(" ", "-")


def _versions(table: Table) -> set[str]:
    return {c.software for c in table.cases if c.software}


def render(sources: list[dict[str, str]], tables: list[Table]) -> str:
    out = [
        "<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->",
        "<!-- Written by `python -m harness.page` from verification/results/; do not edit. -->",
        "",
        "# Verification results",
        "",
        "These are the numbers ClearFEA computed for its verification cases: simple models with "
        "an analytical or published answer, run through the whole platform (upload, setup, "
        "meshing, CalculiX, result reading). For each check the table gives the reference value, "
        "the value ClearFEA computed, the difference and the tolerance the case allows. The cases "
        "show how closely the software reproduces known answers. They do not show how closely a "
        "particular model represents its part, and nothing here compares a result with a design "
        "code, standard or acceptance criterion.",
        "",
        "How each case is built and where its reference values come from: "
        "[VERIFICATION.md](VERIFICATION.md) and the write-up linked under each case.",
        "",
        "## Where these numbers come from",
        "",
    ]
    for source, table in zip(sources, tables, strict=True):
        rows = [r for c in table.cases for r in c.rows]
        within = sum(r.within for r in rows)
        cases = sum(1 for c in table.cases if write_up(c.id) is not None)
        versions = _versions(table)
        software = f" Software: {next(iter(versions))}." if len(versions) == 1 else ""
        out.append(
            f"- **{source['title']}**: {source['description']} {table.tier.capitalize()} tier; "
            f"{cases} cases, {within} of {len(rows)} checks within tolerance.{software}"
        )
    out += [
        "",
        "To produce the same tables: `VERIFY_TIER=full make verify` for the verification cases "
        'and `VERIFY_TIER=full CASES="A B" make verify` for the acceptance cases '
        "(verification/README.md).",
        "",
    ]

    for source, table in zip(sources, tables, strict=True):
        out += [f"## {source['title']}", ""]
        if source.get("note"):
            out += [source["note"], ""]
        out += ["| Case | Mesh | Checks within tolerance |", "| --- | --- | --- |"]
        for case in table.cases:
            if write_up(case.id) is None:
                continue
            within = sum(r.within for r in case.rows)
            out.append(
                f"| [{case.id} {case.title}](#{_anchor(case)}) | {_cell(case.mesh)} "
                f"| {within} of {len(case.rows)} |"
            )
        out.append("")
        for case in table.cases:
            link = write_up(case.id)
            if link is None:
                continue
            out += [f"### {case.id} {case.title}", ""]
            detail = f"Mesh {case.mesh}; {case.seconds} from upload to result."
            if len(_versions(table)) != 1 and case.software:
                detail += f" Software: {case.software}."
            out += [f"{detail} Reference values: [{Path(link).name}]({link}).", ""]
            out += _case_table(case) + [""]
        for case in table.cases:
            if write_up(case.id) is None:
                out += [
                    f"### {case.id}",
                    "",
                    "The wallet ledger over the whole run: every charge the cases made, against "
                    "the costs their runs recorded (DECISIONS.md ADR-090).",
                    "",
                ]
                out += _case_table(case) + [""]
    return "\n".join(out).rstrip() + "\n"


def build() -> str:
    sources = json.loads((RESULTS / "sources.json").read_text())
    tables = [parse((RESULTS / s["file"]).read_text()) for s in sources]
    return render(sources, tables)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="fail if the page is out of date")
    parser.add_argument("--from-log", type=Path, help="a GitHub Actions log of `make verify`")
    parser.add_argument("--to", type=Path, help="where --from-log writes the table")
    args = parser.parse_args()
    if args.from_log:
        if not args.to:
            parser.error("--from-log needs --to")
        args.to.write_text(from_log(args.from_log.read_text()))
        return 0
    page = build()
    if args.check:
        if not PAGE.exists() or PAGE.read_text() != page:
            print(
                f"{PAGE.relative_to(ROOT)} is not what verification/results/ gives. Run "
                "`cd verification && uv run --project ../worker --locked python -m harness.page`.",
                file=sys.stderr,
            )
            return 1
        return 0
    PAGE.write_text(page)
    print(f"Wrote {PAGE.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
