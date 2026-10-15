# SPDX-License-Identifier: AGPL-3.0-or-later
"""Fits the run estimator (M2.12, ADR-049) to the job-step benchmark and writes its coefficients
to packages/spec/estimator.json, the file the API estimates from.

    cd worker && uv run python benchmarks/solver/fit.py [--check]

Both fitted quantities take the form ``constant + coefficient * nodes ** exponent``: the peak
memory of the solver process and the wall time of the solve job's steps (``steps.py``), for
both element orders together (per node they cost about the same). The constant is chosen by a
fine search and the other two by least squares on the logarithms, so every measurement counts
by its relative error. The version in the file goes up by one whenever a coefficient changes.
With ``--check`` nothing is written; the script fails if the file is not what the data gives.
"""

import argparse
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
STEPS = HERE / "steps.json"
ESTIMATOR = HERE.parents[2] / "packages" / "spec" / "estimator.json"

#: Factor on the fitted peak memory a machine size must hold before it is recommended; covers
#: the scatter of the fit, meshes of other shapes and what the measurements did not see.
MEMORY_MARGIN = 1.25
#: Share of a machine size's memory the solver may use (the M2.11 benchmark stopped ccx at 85
#: percent of the machine's limit; the rest is the system's and the worker's).
USABLE_MEMORY_FRACTION = 0.85
#: Constants tried: this many steps between zero and the smallest measurement.
CONSTANT_STEPS = 400


def fit_power_law(points: list[tuple[int, float]]) -> dict[str, float]:
    """``constant + coefficient * n ** exponent`` through (n, value) points, least squares on
    the logarithms of the values."""
    smallest = min(value for _, value in points)
    best: tuple[float, dict[str, float]] | None = None
    for step in range(CONSTANT_STEPS):
        constant = smallest * step / CONSTANT_STEPS
        xs = [math.log(n) for n, _ in points]
        ys = [math.log(value - constant) for _, value in points]
        mean_x, mean_y = sum(xs) / len(xs), sum(ys) / len(ys)
        exponent = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys, strict=True)) / sum(
            (x - mean_x) ** 2 for x in xs
        )
        coefficient = math.exp(mean_y - exponent * mean_x)
        error = sum(
            (math.log(value) - math.log(constant + coefficient * n**exponent)) ** 2
            for n, value in points
        )
        if best is None or error < best[0]:
            best = (error, {"constant": constant, "coefficient": coefficient, "exponent": exponent})
    assert best is not None
    law = best[1]
    law["largestRatio"] = max(
        value / (law["constant"] + law["coefficient"] * n ** law["exponent"]) for n, value in points
    )
    return {key: float(f"{value:.6g}") for key, value in law.items()}


def fit(steps: dict) -> dict:
    """The estimator table's analyses and margins from the job-step rows."""
    rows = steps["runs"]
    if len(rows) < 3:
        raise SystemExit("steps.json needs at least three rows to fit three coefficients.")
    nodes = [row["nodes"] for row in rows]
    memory = [(row["nodes"], row["peakMemoryBytes"]) for row in rows]
    seconds = [(row["nodes"], row["jobSeconds"]) for row in rows]
    return {
        "analyses": {
            "linear_static": {
                "solver": "SPOOLES on one thread (ADR-048), CalculiX "
                + ", ".join(sorted({row["ccxVersion"] for row in rows})),
                "peakMemoryBytes": fit_power_law(memory),
                "jobSeconds": fit_power_law(seconds),
                "fittedNodes": [min(nodes), max(nodes)],
            }
        },
        "memoryMargin": MEMORY_MARGIN,
        "usableMemoryFraction": USABLE_MEMORY_FRACTION,
    }


def table(steps: dict, current: dict | None) -> dict:
    """The full estimator.json: the fit, with the version bumped when the fit changed."""
    fitted = fit(steps)
    version = 1
    if current is not None:
        same = all(current.get(key) == value for key, value in fitted.items())
        version = current["version"] if same else current["version"] + 1
    return {
        "version": version,
        "source": "worker/benchmarks/solver/steps.json, fitted by worker/benchmarks/solver/fit.py",
        **fitted,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    steps = json.loads(STEPS.read_text())
    current = json.loads(ESTIMATOR.read_text()) if ESTIMATOR.exists() else None
    new = table(steps, current)
    if args.check:
        if new != current:
            print(f"{ESTIMATOR} is not the fit of {STEPS}; run fit.py.", file=sys.stderr)
            return 1
        return 0
    ESTIMATOR.write_text(json.dumps(new, indent=2) + "\n")
    law = new["analyses"]["linear_static"]
    for name in ("peakMemoryBytes", "jobSeconds"):
        print(f"{name}: {law[name]}")
    print(f"wrote {ESTIMATOR} (version {new['version']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
