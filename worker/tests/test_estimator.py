# SPDX-License-Identifier: AGPL-3.0-or-later
"""The run estimator's coefficients (packages/spec/estimator.json, ADR-049) are the fit of the
job-step benchmark, and the fit itself recovers a law it is given."""

import importlib.util
import json
from pathlib import Path

import pytest

from clearfea_worker.spec.estimator_schema import EstimatorTable

BENCHMARKS = Path(__file__).resolve().parents[1] / "benchmarks" / "solver"
ESTIMATOR = Path(__file__).resolve().parents[2] / "packages" / "spec" / "estimator.json"


def load_fit():  # type: ignore[no-untyped-def]
    spec = importlib.util.spec_from_file_location("fit", BENCHMARKS / "fit.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_estimator_json_matches_its_schema() -> None:
    EstimatorTable.model_validate_json(ESTIMATOR.read_text())


def test_estimator_json_is_the_fit_of_the_benchmark() -> None:
    fit = load_fit()
    steps = json.loads((BENCHMARKS / "steps.json").read_text())
    current = json.loads(ESTIMATOR.read_text())
    assert fit.table(steps, current) == current, "run benchmarks/solver/fit.py"


def test_fit_recovers_a_power_law_with_a_constant() -> None:
    fit = load_fit()
    points = [(n, 2.0 + 3e-6 * n**1.5) for n in (1_000, 5_000, 20_000, 80_000, 300_000)]
    law = fit.fit_power_law(points)
    assert law["exponent"] == pytest.approx(1.5, rel=1e-3)
    # The constant is searched on a grid, so the other two land close to, not on, the law.
    assert law["coefficient"] == pytest.approx(3e-6, rel=2e-2)
    assert law["constant"] == pytest.approx(2.0, rel=1e-2)
    assert law["largestRatio"] == pytest.approx(1.0, abs=2e-3)


def test_the_fit_covers_what_the_m2_11_benchmark_measured() -> None:
    """The estimate's peak memory is within 5 percent of every single-threaded SPOOLES solve in
    results.json, which were measured separately (the solver alone, OMP_NUM_THREADS=1)."""
    table = EstimatorTable.model_validate_json(ESTIMATOR.read_text())
    memory = table.analyses.linear_static.peak_memory_bytes
    rows = json.loads((BENCHMARKS / "results.json").read_text())["runs"]
    solved = [r for r in rows if (r["solver"], r["threads"], r["status"]) == ("SPOOLES", 1, "ok")]
    assert solved
    for row in solved:
        fitted = memory.constant + memory.coefficient * row["nodes"] ** memory.exponent
        assert row["peakMemoryBytes"] / fitted == pytest.approx(1.0, abs=0.05), row["nodes"]
