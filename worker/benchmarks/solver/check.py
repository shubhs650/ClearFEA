# SPDX-License-Identifier: AGPL-3.0-or-later
"""Estimator check (M8.9): the cost the estimate predicts before a run against the cost the
job-step benchmark measured, on every row of steps.json, against the margin in
docs/DECISIONS.md (cost estimates within 30 percent of measured cost; gate condition 3).

    cd worker && uv run python benchmarks/solver/check.py [--out FILE]

Each row is priced as the platform prices a run. The estimate is the estimator's fitted job
time (packages/spec/estimator.json) rounded up to whole seconds, as ``estimateMesh`` does in
packages/spec/src/estimator.ts; the measured cost is the row's job time rounded up to whole
seconds, as ``billedSeconds`` bills a job in apps/api/src/billing/cost.ts. Both are then the
same hourly rate times those seconds (``costOf``), and the solver runs on one thread on every
machine size (ADR-048), so the relative error of the cost is that of the billed seconds on every
size, to within one micro-credit. Prints a markdown table; exits 1 when a row is outside the
margin.
"""

import argparse
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
STEPS = HERE / "steps.json"
ESTIMATOR = HERE.parents[2] / "packages" / "spec" / "estimator.json"

#: Cost estimates within 30 percent of measured cost (docs/DECISIONS.md, working tolerances).
MARGIN = 0.30


@dataclass(frozen=True)
class Row:
    analysis: str
    solver: str
    order: int
    elements: int
    nodes: int
    modes: int | None
    measured_seconds: float
    estimated_seconds: float

    @property
    def billed(self) -> int:
        """What the job was billed for: its measured time rounded up to whole seconds."""
        return math.ceil(round(self.measured_seconds * 1000) / 1000)

    @property
    def estimated(self) -> int:
        """What the estimate prices: the fitted time rounded up to whole seconds."""
        return math.ceil(self.estimated_seconds)

    @property
    def error(self) -> float:
        """Estimated over measured cost, less one."""
        return self.estimated / self.billed - 1

    @property
    def within(self) -> bool:
        return abs(self.error) <= MARGIN


def law(term: dict[str, float], nodes: float) -> float:
    return term["constant"] + term["coefficient"] * nodes ** term["exponent"]


def rows(steps: dict, estimator: dict) -> list[Row]:
    """Every benchmark row with the estimate the platform would make for its mesh."""
    out = []
    for run in steps["runs"]:
        analysis = run.get("analysis", "linear_static")
        model = estimator["analyses"][analysis][run["solver"]]
        seconds = law(model["jobSeconds"], run["nodes"])
        if analysis == "modal":
            seconds += run["modes"] * law(model["jobSecondsPerMode"], run["nodes"])
        out.append(
            Row(
                analysis=analysis,
                solver=run["solver"],
                order=run["order"],
                elements=run["elements"],
                nodes=run["nodes"],
                modes=run.get("modes"),
                measured_seconds=run["jobSeconds"],
                estimated_seconds=seconds,
            )
        )
    return sorted(out, key=lambda r: (r.analysis, r.solver, r.order, r.nodes, r.modes or 0))


def report(checked: list[Row], version: int) -> str:
    lines = [
        f"Estimator version {version} against {len(checked)} benchmark rows; margin "
        f"{100 * MARGIN:g} percent of measured cost.",
        "",
        "| Analysis | Solver | Rows | Within margin | Lowest error | Highest error |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    groups: dict[tuple[str, str], list[Row]] = {}
    for row in checked:
        groups.setdefault((row.analysis, row.solver), []).append(row)
    for (analysis, solver), group in groups.items():
        errors = [row.error for row in group]
        lines.append(
            f"| {analysis} | {solver} | {len(group)} | {sum(r.within for r in group)} "
            f"| {100 * min(errors):+.0f} % | {100 * max(errors):+.0f} % |"
        )
    lines += [
        "",
        "| Analysis | Solver | Order | Elements | Nodes | Modes | Measured s | Billed s "
        "| Estimated s | Error | Within |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in checked:
        lines.append(
            f"| {row.analysis} | {row.solver} | {row.order} | {row.elements:,} | {row.nodes:,} "
            f"| {row.modes if row.modes is not None else ''} | {row.measured_seconds:g} "
            f"| {row.billed} | {row.estimated} | {100 * row.error:+.1f} % "
            f"| {'yes' if row.within else 'no'} |"
        )
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, help="also write the table to this file")
    args = parser.parse_args()
    estimator = json.loads(ESTIMATOR.read_text())
    checked = rows(json.loads(STEPS.read_text()), estimator)
    text = report(checked, estimator["version"])
    print(text, end="")
    if args.out is not None:
        args.out.write_text(text)
    outside = [row for row in checked if not row.within]
    if outside:
        print(f"{len(outside)} of {len(checked)} rows are outside the margin.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
