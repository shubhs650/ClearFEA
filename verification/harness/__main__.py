# SPDX-License-Identifier: AGPL-3.0-or-later
"""Runs verification cases through the platform: upload, setup, mesh, solve, compare.

    cd verification && uv run --project ../worker --locked python -m harness \
        --api http://127.0.0.1:8788 [--tier coarse|full] [V-01 ...]

`make verify` starts a fresh API and worker and calls this (infra/verify.sh). The browser
is not involved. Prints the result table in Markdown and writes it, with the figures as
JSON, to --out. Exit status 1 if any check fails.
"""

import argparse
import json
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from clearfea_worker.units import from_si

from .binfiles import Surface, read_fields, read_mesh_positions, read_surface
from .cases import (
    BALANCE_TOLERANCE,
    QUANTITIES,
    TIERS,
    Case,
    CaseError,
    Check,
    applied_heat,
    applied_load,
    balance,
    build_spec,
    evaluate,
    evaluate_inside,
    frequency_error,
    heat_flow,
    load_case,
    name_faces,
    reaction,
    unexpected_warnings,
)
from .client import ApiError, Client
from .ledger import entries_for_run, reconcile

ROOT = Path(__file__).resolve().parents[2]
CASES = ROOT / "verification" / "cases"
#: The acceptance models (M9.4): run only when named, never as part of the default suite.
ACCEPTANCE = ROOT / "verification" / "acceptance"
LOGIN, PASSWORD = "alice", "alice-local"  # seeded local test user (ADR-022)
#: The row group of the ledger check over the whole run, shown in the table like a case.
LEDGER = Case("Ledger", "Wallet ledger over the suite", CASES, "m", {}, {}, [], [], {})


@dataclass
class Row:
    check: str
    reference: str
    computed: str
    error: str
    tolerance: str
    ok: bool


@dataclass
class Outcome:
    case: Case
    rows: list[Row] = field(default_factory=list)
    mesh: str = ""
    software: dict[str, Any] = field(default_factory=dict)
    seconds: float = 0.0
    problem: str | None = None
    #: The solve's estimated and billed seconds (M8.9). Shown, not checked: the estimator is
    #: fitted on the benchmark machine and checked there (benchmarks/solver/check.py).
    estimated_seconds: int | None = None
    billed_seconds: int | None = None
    #: The run the case made and the cost its record shows, for the ledger check (M8 exit).
    run_id: str | None = None
    cost: dict[str, Any] | None = None

    @property
    def ok(self) -> bool:
        return self.problem is None and all(row.ok for row in self.rows)


def _shown(value: float, check: Check) -> str:
    """A value in SI, written in the unit the check's reference was entered in."""
    return f"{from_si(value, check.unit, QUANTITIES[check.quantity]):.5g} {check.unit}"


def ledger_outcome(api: Client, outcomes: list[Outcome]) -> Outcome:
    """The M8 exit check over the whole suite (docs/PLAN.md): the harness user's ledger, the
    costs its runs recorded and its wallet agree to the micro-credit."""
    outcome = Outcome(LEDGER)
    runs = {o.run_id: o.cost for o in outcomes if o.run_id is not None and o.cost is not None}
    for r in reconcile(api.json("GET", "/api/wallet")["wallet"], runs):
        outcome.rows.append(Row(r.check, r.expected, r.found, "", "exact", r.ok))
    return outcome


def balance_rows(
    outcome: Outcome, spec: dict[str, Any], surface: Surface, run: dict[str, Any]
) -> None:
    """The force balance rows of a structural run: reactions against the applied load from
    the case's own integration, and the run's own balance check."""
    load, gross = applied_load(spec, surface)
    forces = [r["force"] for r in run["result"]["reactions"]]
    total = [sum(f[i] for f in forces) for i in range(3)]
    check = run["result"].get("balance")
    if check is None:
        raise CaseError("The run's result has no balance check.")
    miss, size = balance(load, gross, forces, check["forceScale"])
    imbalance = miss / size
    outcome.rows.append(
        Row(
            "Reactions balance the applied load",
            "applied " + ", ".join(f"{c:.5g}" for c in load) + " N",
            "reactions " + ", ".join(f"{c:.5g}" for c in total) + " N",
            f"{100 * imbalance:.4f} % of {size:.5g} N",
            f"{100 * BALANCE_TOLERANCE:g} %",
            imbalance <= BALANCE_TOLERANCE,
        )
    )
    # The run's own balance check (M3.2, ADR-051): its applied-load totals against its
    # reactions, forces and moments, both from the worker.
    worst = max(check["forceRatio"], check["momentRatio"])
    outcome.rows.append(
        Row(
            "The run's balance check closes",
            "force and moment",
            f"force {100 * check['forceRatio']:.2g} %, moment {100 * check['momentRatio']:.2g} %",
            f"{100 * worst:.4f} %",
            f"{100 * BALANCE_TOLERANCE:g} %",
            worst <= BALANCE_TOLERANCE,
        )
    )


def heat_balance_rows(
    outcome: Outcome, spec: dict[str, Any], surface: Surface, run: dict[str, Any]
) -> None:
    """The heat balance rows of a steady-state thermal run (M5.3): the heat its fluxes and
    generations bring in, from the case's own integration against the run's, and the run's own
    heat in against heat out."""
    flows = run["result"].get("heatFlows")
    check = run["result"].get("heatBalance")
    if flows is None or check is None:
        raise CaseError("The run's result has no heat flows or heat balance.")
    expected = applied_heat(spec, surface)
    if expected:
        got = {f["loadId"]: f["heat"] for f in flows}
        miss = sum(abs(got.get(k, 0.0) - v) for k, v in expected.items())
        size = sum(abs(v) for v in expected.values())
        off = miss / size
        outcome.rows.append(
            Row(
                "Heat flux and generation bring in what the setup gives",
                f"{sum(expected.values()):.5g} W",
                f"{sum(got.get(k, 0.0) for k in expected):.5g} W",
                f"{100 * off:.4f} % of {size:.5g} W",
                f"{100 * BALANCE_TOLERANCE:g} %",
                off <= BALANCE_TOLERANCE,
            )
        )
    outcome.rows.append(
        Row(
            "The run's heat balance closes",
            f"heat in {check['heatIn']:.5g} W",
            f"heat out {check['heatOut']:.5g} W",
            f"{100 * check['ratio']:.4f} % of {check['scale']:.5g} W",
            f"{100 * BALANCE_TOLERANCE:g} %",
            check["ratio"] <= BALANCE_TOLERANCE,
        )
    )


def run_case(api: Client, case: Case, tier: str, work: Path, timeout: float) -> Outcome:
    outcome = Outcome(case)
    started = time.monotonic()
    step = work / f"{case.id}.step"
    subprocess.run([sys.executable, str(case.folder / "geometry.py"), str(step)], check=True,
                   capture_output=True)  # fmt: skip

    geometry = api.upload(f"/api/geometries?name={step.name}", step.read_bytes())["geometry"]
    geometry = api.wait(f"/api/geometries/{geometry['id']}", "geometry", {"importing"}, timeout)
    if geometry["status"] == "failed":
        raise CaseError(f"The import failed: {geometry['problem']}")
    detected = geometry["detectedUnit"]
    outcome.rows.append(
        Row(
            "STEP length unit detected",
            case.unit,
            str(detected),
            "",
            "equal",
            detected == case.unit,
        )
    )
    if geometry["status"] != "ready":
        geometry = api.json("POST", f"/api/geometries/{geometry['id']}/unit", {"unit": case.unit})[
            "geometry"
        ]
        geometry = api.wait(f"/api/geometries/{geometry['id']}", "geometry", {"importing"}, timeout)
    if geometry["status"] != "ready":
        raise CaseError(f"The geometry is {geometry['status']} after confirming {case.unit}.")
    topology = api.json("GET", f"/api/geometries/{geometry['id']}/topology")
    tags = name_faces(case, topology)
    spec = build_spec(case, tags, geometry["id"], tier)

    simulation = api.json(
        "POST", "/api/simulations", {"geometryId": geometry["id"], "name": case.title, "spec": spec}
    )["simulation"]
    sid = simulation["id"]
    api.json("POST", f"/api/simulations/{sid}/mesh")
    mesh = api.wait(f"/api/simulations/{sid}/mesh", "mesh", {"meshing"}, timeout)
    if mesh["status"] != "ready":
        raise CaseError(f"Meshing failed: {mesh['problem']}")
    size = mesh["size"]
    counts = f"{mesh['elementCount']} elements, {mesh['nodeCount']} nodes"
    local = "".join(f", {q['size']['value']:g} {q['size']['unit']} local" for q in mesh["local"])
    order = "" if mesh["order"] == 2 else ", first order"
    outcome.mesh = f"{size['value']:g} {size['unit']}{local}{order}, {counts}"

    run = api.json("POST", f"/api/simulations/{sid}/runs")["run"]
    run = api.wait(f"/api/runs/{run['id']}", "run", {"solving"}, timeout)
    outcome.software = run["software"]
    if run["status"] != "succeeded":
        raise CaseError(f"The run failed: {run['problem']}")
    rid = run["id"]
    surface = read_surface(api.bytes(f"/api/runs/{rid}/surface"))
    fields = read_fields(api.bytes(f"/api/runs/{rid}/fields"), len(surface.positions))
    log = api.bytes(f"/api/runs/{rid}/files/solver.log").decode("utf-8", "replace")
    # Checks inside the body read the run's mesh and its values at every node (M3.4).
    nodes = None
    if any(check.inside for check in case.checks):
        positions = read_mesh_positions(api.bytes(f"/api/runs/{rid}/mesh"))
        whole = api.bytes(f"/api/runs/{rid}/nodes")
        nodes = read_fields(whole, len(positions), "nodes.bin", "mesh.bin")
        # The viewer fetches one field at a time; each must be the whole file's.
        served = [
            read_fields(api.bytes(f"/api/runs/{rid}/nodes?field={name}"), len(positions), name)
            for name in nodes
        ]
        same = all(one == {name: nodes[name]} for one, name in zip(served, nodes, strict=True))
        outcome.rows.append(
            Row(
                "Node values served per field match nodes.bin",
                f"{len(nodes)} fields",
                f"{len(positions)} nodes",
                "equal" if same else "differ",
                "equal",
                same,
            )
        )

    for check in case.checks:
        if check.quantity == "frequency":
            value, error = frequency_error(check, run["result"].get("frequencies", []))
            limit = check.tolerance[tier]
            against = "" if check.relative_to is None else f" of mode {check.relative_to}"
            outcome.rows.append(
                Row(
                    check.name,
                    _shown(check.reference, check),
                    f"{_shown(value, check)} (mode {check.mode})",
                    f"{100 * error:+.4f} %{against}",
                    f"{100 * limit:g} %{against}",
                    abs(error) <= limit,
                )
            )
            continue
        if check.load is not None:
            value = heat_flow(check, run["result"].get("heatFlows", []))
            where = f"load {check.load}"
        elif check.support is not None:
            value, where = reaction(check, run["result"]["reactions"]), f"support {check.support}"
        elif check.inside:
            assert nodes is not None
            value, count = evaluate_inside(check, positions, nodes)
            where = f"{count} nodes inside"
        else:
            value, count = evaluate(check, surface, fields, tags)
            where = f"{count} vertices"
        error = value / check.reference - 1
        limit = check.tolerance[tier]
        outcome.rows.append(
            Row(
                check.name,
                _shown(check.reference, check),
                f"{_shown(value, check)} ({where})",
                f"{100 * error:+.2f} %",
                f"{100 * limit:g} %",
                abs(error) <= limit,
            )
        )

    # Automatic checks on every case (docs/VERIFICATION.md): the force balance of a structural
    # run, the heat balance of a steady-state thermal one (M5.3), both for a thermal stress run
    # (M5.4), whose thermal loads apply no force.
    # A modal run (M6.1) has no loads to balance; it must find every mode it was asked for.
    if spec["analysis"] in ("steady_thermal", "thermal_stress"):
        heat_balance_rows(outcome, spec, surface, run)
    if spec["analysis"] in ("linear_static", "thermal_stress"):
        balance_rows(outcome, spec, surface, run)
    if spec["analysis"] == "modal":
        found = len(run["result"].get("frequencies", []))
        outcome.rows.append(
            Row("Modes found", str(spec["modes"]), str(found), "", "equal", found == spec["modes"])
        )
    warnings = unexpected_warnings(log, case.allowed_warnings)
    outcome.rows.append(
        Row(
            "Solver log has no unexpected warnings",
            "none",
            "none" if not warnings else "; ".join(warnings[:3]),
            "",
            "",
            not warnings,
        )
    )
    cost = run["cost"]
    outcome.estimated_seconds = run["estimate"] and run["estimate"]["seconds"]
    outcome.billed_seconds = cost and cost["billedSeconds"]
    outcome.run_id, outcome.cost = rid, cost
    ledger = len(entries_for_run(api.json("GET", "/api/wallet")["wallet"], rid))
    billed = cost is not None and cost["charged"] and cost["billedSeconds"] >= 1
    outcome.rows.append(
        Row(
            "Billable seconds recorded, one ledger entry",
            "at least 1 s charged, 1 entry",
            f"{cost and cost['billedSeconds']} s, charged {cost and cost['charged']}, "
            f"{ledger} {'entry' if ledger == 1 else 'entries'}",
            "",
            "",
            billed and ledger == 1,
        )
    )
    outcome.seconds = time.monotonic() - started
    return outcome


def table(outcomes: list[Outcome], tier: str) -> str:
    lines = [f"Tier: {tier}", ""]
    lines.append("| Case | Check | Reference | ClearFEA | Error | Tolerance | Result |")
    lines.append("| --- | --- | --- | --- | --- | --- | --- |")
    for o in outcomes:
        if o.problem is not None:
            lines.append(f"| {o.case.id} | {o.problem} | | | | | FAILED |")
        for r in o.rows:
            result = "pass" if r.ok else "FAILED"
            lines.append(
                f"| {o.case.id} | {r.check} | {r.reference} | {r.computed} | {r.error} "
                f"| {r.tolerance} | {result} |"
            )
    lines.append("")
    for o in outcomes:
        if o.case.id == "Ledger":
            continue
        versions = ", ".join(f"{k} {v}" for k, v in o.software.items() if v is not None)
        solve = ""
        if o.estimated_seconds is not None and o.billed_seconds is not None:
            solve = f"; solve estimated {o.estimated_seconds} s, billed {o.billed_seconds} s"
        lines.append(
            f"- {o.case.id} {o.case.title}: mesh {o.mesh or 'none'}; {o.seconds:.0f} s{solve}; "
            f"{versions}"
        )
    checks = [r.ok for o in outcomes for r in o.rows] + [False for o in outcomes if o.problem]
    lines.append("")
    cases = sum(1 for o in outcomes if o.case.id != "Ledger")
    lines.append(f"{sum(checks)} of {len(checks)} checks passed, {cases} cases.")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "cases", nargs="*", help="case ids, for example V-01 or A; default every V case"
    )
    parser.add_argument("--api", required=True, help="API base URL")
    parser.add_argument("--tier", choices=TIERS, default="coarse")
    parser.add_argument("--timeout", type=float, default=None, help="seconds per mesh or solve")
    parser.add_argument("--out", type=Path, default=None, help="folder for results.md and .json")
    args = parser.parse_args()
    timeout = args.timeout or (900.0 if args.tier == "coarse" else 7200.0)
    folders = sorted(p for p in CASES.iterdir() if (p / "case.yaml").exists())
    if args.cases:
        folders += sorted(p for p in ACCEPTANCE.iterdir() if (p / "case.yaml").exists())
        folders = [p for p in folders if p.name.startswith(tuple(f"{c}-" for c in args.cases))]
        if not folders:
            print(
                f"No case matches {args.cases}. Cases are in {CASES} and {ACCEPTANCE}.",
                file=sys.stderr,
            )
            return 2
    out = args.out or Path(tempfile.mkdtemp(prefix="verify-"))
    out.mkdir(parents=True, exist_ok=True)

    api = Client(args.api)
    api.sign_in(LOGIN, PASSWORD)
    outcomes = []
    for folder in folders:
        case = load_case(folder)
        print(f"[verify] {case.id} {case.title} ({args.tier})", flush=True)
        work = out / case.id
        work.mkdir(exist_ok=True)
        try:
            outcome = run_case(api, case, args.tier, work, timeout)
        except (ApiError, CaseError, subprocess.CalledProcessError) as error:
            outcome = Outcome(case, problem=str(error).replace("\n", " "))
        outcomes.append(outcome)
        print(f"[verify] {case.id}: {'pass' if outcome.ok else 'FAILED'}", flush=True)
    if outcomes:
        try:
            outcomes.append(ledger_outcome(api, outcomes))
        except ApiError as error:
            outcomes.append(Outcome(LEDGER, problem=str(error).replace("\n", " ")))

    text = table(outcomes, args.tier)
    print("\n" + text)
    (out / "results.md").write_text(text + "\n")
    (out / "results.json").write_text(
        json.dumps(
            [
                {
                    "case": o.case.id,
                    "tier": args.tier,
                    "ok": o.ok,
                    "problem": o.problem,
                    "mesh": o.mesh,
                    "software": o.software,
                    "estimatedSeconds": o.estimated_seconds,
                    "billedSeconds": o.billed_seconds,
                    "rows": [r.__dict__ for r in o.rows],
                }
                for o in outcomes
            ],
            indent=2,
        )
    )
    print(f"\nResults in {out}")
    return 0 if all(o.ok for o in outcomes) else 1


if __name__ == "__main__":
    sys.exit(main())
