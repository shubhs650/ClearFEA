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


@pytest.mark.parametrize("solver", ["pastix", "spooles", "iterative_cholesky", "iterative_scaling"])
def test_every_measured_mesh_under_a_limit_fits_16_gib_with_the_margin(solver: str) -> None:
    """The element limits keep every benchmarked mesh within the rule they are made from: its
    measured peak memory, times the margin, fits in the usable share of 16 GiB (ADR-063). This
    replaces M2.11's cross-check against the packaged ccx, which no longer solves runs."""
    table = EstimatorTable.model_validate_json(ESTIMATOR.read_text())
    model = getattr(table.analyses.linear_static, solver)
    usable = table.limit_memory_bytes * table.usable_memory_fraction
    rows = json.loads((BENCHMARKS / "steps.json").read_text())["runs"]
    checked = 0
    for row in rows:
        # Modal rows have limits of their own (the next test).
        if row["solver"] != solver or row.get("analysis", "linear_static") != "linear_static":
            continue
        limit = model.max_elements.order1 if row["order"] == 1 else model.max_elements.order2
        if row["elements"] <= limit:
            assert row["peakMemoryBytes"] * table.memory_margin <= usable, row["elements"]
            checked += 1
    assert checked >= 5


def test_every_measured_modal_mesh_under_a_limit_fits_16_gib_with_the_margin() -> None:
    """The same rule for the modal limits (M6.3), which are for the most modes: every modal
    mesh measured under a limit, with any number of modes, fits."""
    table = EstimatorTable.model_validate_json(ESTIMATOR.read_text())
    usable = table.limit_memory_bytes * table.usable_memory_fraction
    rows = json.loads((BENCHMARKS / "steps.json").read_text())["runs"]
    checked = 0
    for solver in ("pastix", "spooles"):
        model = getattr(table.analyses.modal, solver)
        if model is None:
            continue
        for row in rows:
            if row.get("analysis") != "modal" or row["solver"] != solver:
                continue
            limit = model.max_elements.order1 if row["order"] == 1 else model.max_elements.order2
            if row["elements"] <= limit:
                assert row["peakMemoryBytes"] * table.memory_margin <= usable, row["elements"]
                checked += 1
    assert checked >= 5


def test_the_modal_fit_splits_a_part_per_mode() -> None:
    """Given rows that follow memory = 1e8 + 1e3 n and 1e2 n per mode, at 1 and 100 modes,
    the modal fit recovers both parts."""
    fit = load_fit()
    rows = []
    for order, target, nodes in (
        (2, 3000, 5_000),
        (2, 25000, 40_000),
        (1, 100000, 20_000),
        (1, 400000, 70_000),
    ):
        for modes in (1, 100):
            rows.append(
                {
                    "analysis": "modal",
                    "solver": "spooles",
                    "order": order,
                    "targetElements": target,
                    "elements": target,
                    "nodes": nodes,
                    "modes": modes,
                    "peakMemoryBytes": 1e8 + 1e3 * nodes + modes * 1e2 * nodes,
                    "jobSeconds": 1.0 + 1e-3 * nodes + modes * 1e-4 * nodes,
                    "ccxVersion": "2.21",
                }
            )
    model = fit.fit_modal({"runs": rows})["spooles"]
    for nodes in (5_000, 70_000):
        assert fit.law(model["peakMemoryBytesPerMode"], nodes) == pytest.approx(
            1e2 * nodes, rel=1e-2
        )
        assert fit.law(model["peakMemoryBytes"], nodes) == pytest.approx(
            1e8 + 1e3 * nodes, rel=1e-2
        )
        assert fit.law(model["jobSecondsPerMode"], nodes) == pytest.approx(1e-4 * nodes, rel=1e-2)
    assert model["fittedModes"] == [1, 100]


def test_the_mesher_limit_in_the_fit_is_the_mesher_s() -> None:
    from clearfea_worker.meshing.mesher import MAX_ELEMENTS

    assert load_fit().MESHER_LIMIT == MAX_ELEMENTS
