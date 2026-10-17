# SPDX-License-Identifier: AGPL-3.0-or-later
"""Fits the run estimator (M2.12, ADR-049) to the job-step benchmark, per equation solver, and
works out each solver's element limits on a 16 GiB machine (ADR-063), for linear static runs and
for modal runs (M6.3); writes them to packages/spec/estimator.json, the file the API estimates
from and the limits are read from.

    cd worker && uv run python benchmarks/solver/fit.py [--check]

Both fitted quantities take the form ``constant + coefficient * nodes ** exponent``: the peak
memory of the solver process and the wall time of the solve job's steps (``steps.py``), for
both element orders together (per node they cost about the same). The constant is chosen by a
fine search and the other two by least squares on the logarithms, so every measurement counts
by its relative error. The version in the file goes up by one whenever a coefficient changes.
With ``--check`` nothing is written; the script fails if the file is not what the data gives.

A modal run costs a part for the mesh and a part per mode: each mesh is measured with the fewest
and the most modes, the line through those two gives the mesh's two parts, and each part is
fitted as a power law over the meshes. Modal element limits are for the most modes a setup may
ask for, so they hold for every modal run.
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
#: Memory of the machine the element limits are for (ADR-063): 16 GiB, the laptop class and the
#: medium machine size. Larger machines get their own limits when they are benchmarked.
LIMIT_MEMORY_BYTES = 16 * 2**30
#: The most elements the mesher makes (ClearFEA's MAX_ELEMENTS, ADR-045 item 5); no limit is
#: larger.
MESHER_LIMIT = 2_000_000
#: The most modes a modal setup may ask for (simulation.schema.json, ``modes``); modal element
#: limits are worked out for this many.
MAX_MODES = 100
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


#: What each solver's rows were measured with, for people reading estimator.json.
SOLVER_LABELS = {
    "pastix": "PaStiX (mixed precision) on one thread",
    "spooles": "SPOOLES on one thread (ADR-048)",
    "iterative_cholesky": "iterative Cholesky (one thread)",
    "iterative_scaling": "iterative scaling (one thread)",
}


def law(term: dict[str, float], nodes: float) -> float:
    return term["constant"] + term["coefficient"] * nodes ** term["exponent"]


def room_bytes(ratio: float) -> float:
    """The fitted peak memory a run may have on a LIMIT_MEMORY_BYTES machine: the usable share,
    over the margin and over the fit's worst shortfall (largestRatio). The shortfall keeps
    every measured mesh under the limit within its own rule."""
    return LIMIT_MEMORY_BYTES * USABLE_MEMORY_FRACTION / MEMORY_MARGIN / ratio


def node_limit(memory: dict[str, float]) -> float:
    """The node count whose fitted peak memory, raised by the fit's worst shortfall
    (largestRatio) and times the margin, fills the usable share of a LIMIT_MEMORY_BYTES
    machine."""
    room = room_bytes(memory["largestRatio"]) - memory["constant"]
    return (room / memory["coefficient"]) ** (1 / memory["exponent"])


def modal_node_limit(memory: dict[str, float], per_mode: dict[str, float]) -> float:
    """As node_limit, for a modal run with MAX_MODES modes: memory + MAX_MODES × per_mode is
    increasing in the node count, so the limit is found by bisection."""
    room = room_bytes(memory["largestRatio"])
    low, high = 1.0, 1e9
    for _ in range(200):
        middle = (low + high) / 2
        if law(memory, middle) + MAX_MODES * law(per_mode, middle) <= room:
            low = middle
        else:
            high = middle
    return low


def element_limit(nodes: float, rows: list[dict]) -> int:
    """``nodes`` as an element count of one order: divided by the nodes per element of the
    measured mesh nearest that node count, rounded down to a thousand. Never more than the
    largest mesh measured (the maintainer had the benchmark stop at 500,000 elements, ADR-063),
    so a limit is never an extrapolation, nor more than the mesher makes."""
    nearest = min(rows, key=lambda row: abs(row["nodes"] - nodes))
    largest = max(row["elements"] for row in rows)
    elements = min(nodes * nearest["elements"] / nearest["nodes"], largest, MESHER_LIMIT)
    return int(elements // 1000 * 1000)


def static_rows(steps: dict) -> list[dict]:
    """The linear static rows; rows measured before M6.3 do not name their analysis."""
    return [row for row in steps["runs"] if row.get("analysis", "linear_static") == "linear_static"]


def fit_modal(steps: dict) -> dict:
    """The modal models, per solver measured: the part per mesh and the part per mode of the
    peak memory and the job time, each a power law in the node count, and the element limits
    for MAX_MODES modes."""
    models = {}
    modal = [row for row in steps["runs"] if row.get("analysis") == "modal"]
    for solver in sorted({row["solver"] for row in modal}):
        rows = [row for row in modal if row["solver"] == solver]
        meshes: dict[tuple[int, int], list[dict]] = {}
        for row in rows:
            meshes.setdefault((row["order"], row["targetElements"]), []).append(row)
        parts: dict[str, list[tuple[int, float]]] = {
            "memory": [],
            "memoryPerMode": [],
            "seconds": [],
            "secondsPerMode": [],
        }
        for measured in meshes.values():
            fewest = min(measured, key=lambda row: row["modes"])
            most = max(measured, key=lambda row: row["modes"])
            if fewest["modes"] == most["modes"]:
                continue
            span = most["modes"] - fewest["modes"]
            for name, key in (("memory", "peakMemoryBytes"), ("seconds", "jobSeconds")):
                # The line through the fewest and the most modes. Both quantities measured
                # bend upwards between them, so the line is above the measurements there.
                per_mode = (most[key] - fewest[key]) / span
                parts[name].append((fewest["nodes"], fewest[key] - fewest["modes"] * per_mode))
                parts[name + "PerMode"].append((fewest["nodes"], per_mode))
        if len(parts["memory"]) < 3:
            raise SystemExit(
                f"steps.json needs at least three {solver} modal meshes, each with two numbers "
                "of modes, to fit three coefficients."
            )
        laws = {name: fit_power_law(points) for name, points in parts.items()}
        for name, key in (("memory", "peakMemoryBytes"), ("seconds", "jobSeconds")):
            # How far the whole sum fell short at worst, over every modal row.
            ratio = max(
                row[key]
                / (
                    law(laws[name], row["nodes"])
                    + row["modes"] * law(laws[name + "PerMode"], row["nodes"])
                )
                for row in rows
            )
            laws[name]["largestRatio"] = float(f"{ratio:.6g}")
        limit = modal_node_limit(laws["memory"], laws["memoryPerMode"])
        orders = {}
        for order in (1, 2):
            measured = [row for row in rows if row["order"] == order]
            if not measured:
                raise SystemExit(f"steps.json has no {solver} modal rows of order {order}.")
            orders[f"order{order}"] = element_limit(limit, measured)
        nodes = [row["nodes"] for row in rows]
        modes = [row["modes"] for row in rows]
        models[solver] = {
            "solver": SOLVER_LABELS[solver]
            + ", CalculiX "
            + ", ".join(sorted({row["ccxVersion"] for row in rows})),
            "peakMemoryBytes": laws["memory"],
            "peakMemoryBytesPerMode": laws["memoryPerMode"],
            "jobSeconds": laws["seconds"],
            "jobSecondsPerMode": laws["secondsPerMode"],
            "fittedNodes": [min(nodes), max(nodes)],
            "fittedModes": [min(modes), max(modes)],
            "maxElements": orders,
        }
    return models


def fit(steps: dict) -> dict:
    """The estimator table's per-solver models, element limits and margins from the job-step
    rows. Both element orders are fitted together: per node they cost about the same."""
    models = {}
    for solver, label in SOLVER_LABELS.items():
        rows = [row for row in static_rows(steps) if row["solver"] == solver]
        if len(rows) < 3:
            raise SystemExit(
                f"steps.json needs at least three {solver} rows to fit three coefficients."
            )
        nodes = [row["nodes"] for row in rows]
        memory = fit_power_law([(row["nodes"], row["peakMemoryBytes"]) for row in rows])
        limit = node_limit(memory)
        orders = {}
        for order in (1, 2):
            measured = [row for row in rows if row["order"] == order]
            if not measured:
                raise SystemExit(f"steps.json has no {solver} rows of order {order}.")
            orders[f"order{order}"] = element_limit(limit, measured)
        models[solver] = {
            "solver": label
            + ", CalculiX "
            + ", ".join(sorted({row["ccxVersion"] for row in rows})),
            "peakMemoryBytes": memory,
            "jobSeconds": fit_power_law([(row["nodes"], row["jobSeconds"]) for row in rows]),
            "fittedNodes": [min(nodes), max(nodes)],
            "maxElements": orders,
        }
    return {
        "analyses": {"linear_static": models, "modal": fit_modal(steps)},
        "memoryMargin": MEMORY_MARGIN,
        "usableMemoryFraction": USABLE_MEMORY_FRACTION,
        "limitMemoryBytes": LIMIT_MEMORY_BYTES,
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
    for analysis, models in new["analyses"].items():
        for solver, model in models.items():
            memory, seconds = model["peakMemoryBytes"], model["jobSeconds"]
            print(f"{analysis} {solver}: memory {memory}, time {seconds}")
            if "peakMemoryBytesPerMode" in model:
                print(
                    f"  per mode: memory {model['peakMemoryBytesPerMode']}, "
                    f"time {model['jobSecondsPerMode']}"
                )
            print(f"  most elements on 16 GiB: {model['maxElements']}")
    print(f"wrote {ESTIMATOR} (version {new['version']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
