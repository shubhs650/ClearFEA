# SPDX-License-Identifier: AGPL-3.0-or-later
"""M2.12 job-step benchmark: wall time of each step of a solve job, and the solver's peak memory,
on the M2.11 block meshed at several sizes with both element orders (ADR-049).

Script only, not part of the worker package or its tests. It runs the steps the worker's solve
job runs (``clearfea_worker.jobs.run_solve``) in the same order and with the same functions,
including ``run_calculix`` with the worker's solver environment (SPOOLES on one thread), so the
times are what a run's billable phase spends apart from downloads and uploads. M2.12's estimator
is fitted from the rows (``fit.py``).

    cd worker && uv run python benchmarks/solver/steps.py --out DIR 3000:2 25000:1 ...
        [--results benchmarks/solver/steps.json]

Each argument is a target element count and an element order. One mesh is solved per process
call, so the peak memory of the solver is that solve's alone; rows are added to the results
file, replacing a row with the same target and order.
"""

import argparse
import json
import math
import resource
import subprocess
import sys
import threading
import time
from datetime import UTC, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import bench  # noqa: E402  (the M2.11 script beside this one: the block, its spec, the machine)


def solve_one(root: Path, target: int, order: int) -> dict[str, object]:
    from clearfea_worker.deck import generate_deck
    from clearfea_worker.geometry.importer import import_geometry
    from clearfea_worker.meshing.mesher import ELEMENTS_PER_SIZE_CUBED, mesh_geometry
    from clearfea_worker.meshing.volume import read_volume_mesh
    from clearfea_worker.results import read_results, write_viewer_files
    from clearfea_worker.solver import run_calculix
    from clearfea_worker.spec.geometry_schema import Topology
    from clearfea_worker.spec.simulation_schema import SimulationSpec
    from clearfea_worker.versions import calculix_version

    step = root / "block.step"
    if not step.exists():
        bench.write_block(step)
    if not (root / "import" / "topology.json").exists():
        import_geometry(step, root / "import", None)
    topology = Topology.model_validate_json((root / "import" / "topology.json").read_bytes())
    fixed, loaded = bench.end_faces(topology)
    volume = math.prod(bench.BLOCK) * 1e-9
    size = (bench.FILL * ELEMENTS_PER_SIZE_CUBED * volume / target) ** (1 / 3)
    mesh_dir = root / f"mesh-{target}-o{order}"
    if not (mesh_dir / "mesh.bin").exists():
        mesh_geometry(step, topology, mesh_dir, scaling=1.0, size=size, unit="mm", order=order)
    spec = bench.spec(fixed, loaded, size * 1000).model_dump(mode="json", by_alias=True)
    spec["mesh"] = {"size": {"value": size * 1000, "unit": "mm"}, "order": order}
    spec = SimulationSpec.model_validate(spec)

    seconds: dict[str, float] = {}

    def timed(name: str, step):  # type: ignore[no-untyped-def]
        start = time.monotonic()
        value = step()
        seconds[name] = round(time.monotonic() - start, 2)
        return value

    # The solve job's steps, in its order (clearfea_worker/jobs.py, run_solve).
    mesh = timed("readMesh", lambda: read_volume_mesh(mesh_dir / "mesh.bin"))
    deck_text = timed("deck", lambda: generate_deck(spec, mesh))
    work = mesh_dir / "solve"
    work.mkdir(exist_ok=True)
    deck = work / "job.inp"
    timed("writeDeck", lambda: deck.write_text(deck_text, encoding="utf-8"))
    run = timed("solver", lambda: run_calculix(deck, lambda _text: None, threading.Event()))
    peak = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss * 1024
    if run.returncode != 0 or run.errors():
        raise SystemExit(f"ccx failed on {target}:{order}: {run.errors() or run.returncode}")
    frd, dat = work / "job.frd", work / "job.dat"
    fields, _ = timed(
        "readResults", lambda: read_results(spec, mesh, frd, dat, calculix_version() or "")
    )
    timed("viewerFiles", lambda: write_viewer_files(mesh, fields, work))
    frd_bytes = frd.stat().st_size
    for path in (frd, dat):
        path.unlink()
    return {
        "targetElements": target,
        "order": order,
        "elements": mesh.element_count,
        "nodes": mesh.node_count,
        "stepSeconds": seconds,
        "jobSeconds": round(sum(seconds.values()), 2),
        "peakMemoryBytes": peak,
        "frdBytes": frd_bytes,
        "ccxVersion": calculix_version(),
        "machine": bench.machine(),
        "date": datetime.now(UTC).strftime("%Y-%m-%d"),
    }


def save_row(path: Path, row: dict[str, object]) -> None:
    data = (
        json.loads(path.read_text())
        if path.exists()
        else {
            "description": "M2.12 job-step benchmark (ADR-049). How it is measured: steps.py.",
            "runs": [],
        }
    )
    key = (row["targetElements"], row["order"])
    data["runs"] = [r for r in data["runs"] if (r["targetElements"], r["order"]) != key]
    data["runs"].append(row)
    data["runs"].sort(key=lambda r: (r["order"], r["nodes"]))
    path.write_text(json.dumps(data, indent=2) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--results", type=Path, default=HERE / "steps.json")
    parser.add_argument("--one", help=argparse.SUPPRESS)
    parser.add_argument("cases", nargs="*", help="TARGET:ORDER, for example 25000:2")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    if args.one:
        target, order = (int(part) for part in args.one.split(":"))
        print(json.dumps(solve_one(args.out, target, order)), flush=True)
        return 0
    for case in args.cases:
        # A fresh process per solve, so the peak memory of its children is this solve's.
        found = subprocess.run(
            [sys.executable, __file__, "--out", str(args.out), "--one", case],
            check=True,
            capture_output=True,
            text=True,
        )
        row = json.loads(found.stdout.strip().splitlines()[-1])
        save_row(args.results, row)
        print(
            f"{case}: {row['elements']:,} elements, {row['nodes']:,} nodes, "
            f"job {row['jobSeconds']} s, solver peak {row['peakMemoryBytes'] / 2**30:.2f} GiB",
            flush=True,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
