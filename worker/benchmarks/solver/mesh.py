# SPDX-License-Identifier: AGPL-3.0-or-later
"""M12.6 light-lane benchmark: wall time and peak memory of the mesh job's mesher on the M2.11
block, at sizes up to the finest mesh ClearFEA makes, for both element orders (ADR-107: the light
lane runs import, mesh and report jobs on 1 vCPU with 4 GB).

Script only, not part of the worker package or its tests. Each case runs ``mesh_geometry``, the
function the worker's mesh job runs (``clearfea_worker.jobs.run_mesh``), in a fresh process, so
the peak memory of that process is the mesher's alone (Gmsh runs inside it).

    cd worker && uv run python benchmarks/solver/mesh.py --out DIR 500000:1 2000000:2 ...
        [--results benchmarks/solver/mesh.json]

Each argument is a target element count and an element order. The 2,000,000 target is the
finest mesh the mesher accepts on this block (as in ``bench.py``). Rows are added to the results
file, replacing a row with the same target and order. Run in a container (``infra/vps/
benchmark.sh`` runs one container per case), ``containerPeakMemoryBytes`` is the container's
peak, which is what its memory limit is held to.
"""

import argparse
import json
import math
import resource
import shutil
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import bench  # noqa: E402  (the M2.11 script beside this one: the block, the machine)


def mesh_one(root: Path, target: int, order: int) -> dict[str, object]:
    from clearfea_worker.geometry.importer import import_geometry
    from clearfea_worker.meshing.mesher import ELEMENTS_PER_SIZE_CUBED, MAX_ELEMENTS, mesh_geometry
    from clearfea_worker.spec.geometry_schema import Topology

    step = root / "block.step"
    if not step.exists():
        bench.write_block(step)
    if not (root / "import" / "topology.json").exists():
        import_geometry(step, root / "import", None)
    topology = Topology.model_validate_json((root / "import" / "topology.json").read_bytes())
    volume = math.prod(bench.BLOCK) * 1e-9
    size = (bench.FILL * ELEMENTS_PER_SIZE_CUBED * volume / target) ** (1 / 3)
    size = max(size, (ELEMENTS_PER_SIZE_CUBED * volume / MAX_ELEMENTS) ** (1 / 3) * 1.0001)
    out = root / f"light-{target}-o{order}"
    shutil.rmtree(out, ignore_errors=True)
    start = time.monotonic()
    output = mesh_geometry(step, topology, out, scaling=1.0, size=size, unit="mm", order=order)
    seconds = round(time.monotonic() - start, 2)
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
    row = {
        "targetElements": target,
        "order": order,
        "elements": output.result.elements,
        "nodes": output.result.nodes,
        "meshSizeMetres": size,
        "meshSeconds": seconds,
        "peakMemoryBytes": peak,
        "containerPeakMemoryBytes": bench.container_peak_memory(),
        "meshBinBytes": output.mesh_path.stat().st_size,
        "displayBinBytes": output.display_path.stat().st_size,
        "machine": bench.machine(),
        "date": datetime.now(UTC).strftime("%Y-%m-%d"),
    }
    shutil.rmtree(out, ignore_errors=True)
    return row


def save_row(path: Path, row: dict[str, object]) -> None:
    data = (
        json.loads(path.read_text())
        if path.exists()
        else {
            "description": "Light-lane mesh benchmark (M12.6). How it is measured: mesh.py.",
            "runs": [],
        }
    )
    data["runs"] = [
        r
        for r in data["runs"]
        if (r["targetElements"], r["order"]) != (row["targetElements"], row["order"])
    ]
    data["runs"].append(row)
    data["runs"].sort(key=lambda r: (r["order"], r["targetElements"]))
    path.write_text(json.dumps(data, indent=2) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--results", type=Path, default=HERE / "mesh.json")
    parser.add_argument("--one", help=argparse.SUPPRESS)
    parser.add_argument("cases", nargs="*", help="TARGET:ORDER, for example 500000:2")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    if args.one:
        target, order = (int(part) for part in args.one.split(":"))
        print(json.dumps(mesh_one(args.out, target, order)), flush=True)
        return 0
    for case in args.cases:
        # A fresh process per mesh, so its peak memory is this mesh's.
        found = subprocess.run(
            [sys.executable, __file__, "--out", str(args.out), "--one", case],
            check=True,
            capture_output=True,
            text=True,
        )
        row = json.loads(found.stdout.strip().splitlines()[-1])
        save_row(args.results, row)
        print(
            f"{case}: {row['elements']:,} elements in {row['meshSeconds']} s, "
            f"{int(row['peakMemoryBytes']) / 2**30:.2f} GiB",
            flush=True,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
