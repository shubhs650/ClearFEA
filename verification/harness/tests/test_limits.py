# SPDX-License-Identifier: AGPL-3.0-or-later
"""Fast tests of the element-limit runs (M9.1): the cases cover every limit, and each setup is
one the platform accepts. No API, worker or solver: those run in `python -m harness.limits`."""

import json

from clearfea_worker.spec.simulation_schema import SimulationSpec

from harness.limits import ESTIMATOR, LIMIT_CASES, limit_of, spec_for


def test_there_is_one_case_for_every_solver_and_order_with_a_limit() -> None:
    estimator = json.loads(ESTIMATOR.read_text())
    limits = {
        (analysis, solver, int(order.removeprefix("order")))
        for analysis, tables in estimator["analyses"].items()
        for solver, table in tables.items()
        for order in table.get("maxElements", {})
    }
    cases = [(c.analysis, c.solver, c.order) for c in LIMIT_CASES]
    assert sorted(cases) == sorted(limits)
    assert len({c.key for c in LIMIT_CASES}) == len(LIMIT_CASES)
    assert all(limit_of(estimator, c) > 0 for c in LIMIT_CASES)


def test_every_case_builds_a_valid_spec() -> None:
    for case in LIMIT_CASES:
        spec = SimulationSpec.model_validate(spec_for(case, "g1", fixed=1, loaded=2))
        assert spec.model_dump(mode="json")["solver"] == case.solver
        assert spec.model_dump(mode="json")["analysis"] == case.analysis
        assert (spec.modes == 100) == (case.analysis == "modal")
