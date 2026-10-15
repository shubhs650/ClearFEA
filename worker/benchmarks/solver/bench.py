# SPDX-License-Identifier: AGPL-3.0-or-later
"""M2.11 solver benchmark: wall time and peak memory of CalculiX's equation solvers on one
part meshed from about 100,000 to 2 million second-order tetrahedra (ADR-048).

Script only, not part of the worker package or its tests. Each mesh is made by the worker's
own mesher and each deck by the deck generator, so the solver sees what a real run sends it;
only the ``*STATIC`` line's ``SOLVER=`` differs between solvers. Every solve is checked against
the SPOOLES answer on the same mesh (largest displacement), so a fast but unconverged solver
is not mistaken for a good one.

    cd worker && uv run python benchmarks/solver/bench.py --out DIR [--targets 100000 ...]
        [--solvers SPOOLES "ITERATIVE CHOLESKY" ...] [--ccx PATH --build NAME]
        [--results benchmarks/solver/results.json]

Rows are added to the results file (one per mesh, solver and build), replacing a row with the
same key. A solve that passes the memory limit or the time limit is stopped and recorded as
such, and that solver is not tried on larger meshes.
"""

import argparse
import json
import math
import os
import platform
import re
import signal
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

from clearfea_worker.deck import generate_deck
from clearfea_worker.geometry.importer import import_geometry
from clearfea_worker.meshing.mesher import ELEMENTS_PER_SIZE_CUBED, mesh_geometry
from clearfea_worker.meshing.volume import read_volume_mesh
from clearfea_worker.spec.geometry_schema import Topology
from clearfea_worker.spec.simulation_schema import SimulationSpec

#: The part, in millimetres: a stocky block, so the stiffness matrix fills in about as much as
#: it can for its size. A slender part of the same element count is easier for a direct solver.
BLOCK = (100.0, 100.0, 50.0)
DEFAULT_TARGETS = (100_000, 250_000, 500_000, 1_000_000, 2_000_000)
DEFAULT_SOLVERS = ("SPOOLES", "ITERATIVE CHOLESKY", "ITERATIVE SCALING")
HERE = Path(__file__).resolve().parent


def write_block(path: Path) -> Path:
    import gmsh

    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        gmsh.model.occ.addBox(0, 0, 0, *BLOCK)
        gmsh.model.occ.synchronize()
        gmsh.write(str(path))
    finally:
        gmsh.finalize()
    return path


def end_faces(topology: Topology) -> tuple[int, int]:
    """The x = 0 face (held) and the x = L face (pressed)."""
    fixed = next(f.tag for f in topology.faces if math.isclose(f.centroid[0], 0.0, abs_tol=1e-9))
    loaded = next(
        f.tag
        for f in topology.faces
        if math.isclose(f.centroid[0], BLOCK[0] / 1000, abs_tol=1e-9)
    )
    return fixed, loaded


def spec(fixed: int, loaded: int, size_mm: float) -> SimulationSpec:
    """Steel block held at one end and pressed on the other: one load case, so one
    factorisation and one solve, as in every Phase 0 run."""
    return SimulationSpec.model_validate(
        {
            "version": 1,
            "analysis": "linear_static",
            "geometryId": "solver-bench",
            "bodies": [{"tag": 1, "material": "steel"}],
            "materials": [
                {
                    "id": "steel",
                    "name": "Steel",
                    "model": "isotropic_elastic",
                    "youngsModulus": {"value": 200.0, "unit": "GPa"},
                    "poissonsRatio": 0.3,
                }
            ],
            "supports": [{"id": "fixed-1", "type": "fixed", "name": "Fixed", "faces": [fixed]}],
            "loads": [
                {
                    "id": "pressure-1",
                    "type": "pressure",
                    "name": "Pressure",
                    "faces": [loaded],
                    "magnitude": {"value": 10.0, "unit": "MPa"},
                }
            ],
            "mesh": {"size": {"value": size_mm, "unit": "mm"}, "order": 2},
        }
    )


def machine() -> dict[str, object]:
    meminfo = Path("/proc/meminfo").read_text()
    total_kb = int(re.search(r"MemTotal:\s+(\d+)", meminfo).group(1))  # type: ignore[union-attr]
    cpuinfo = Path("/proc/cpuinfo").read_text()
    model = re.search(r"model name\s*:\s*(.*)", cpuinfo)
    return {
        "cores": os.cpu_count(),
        "ramBytes": total_kb * 1024,
        "cpu": model.group(1).strip() if model else platform.processor(),
        "kernel": platform.release(),
    }


def ccx_version(ccx: str) -> str:
    run = subprocess.run([ccx, "-v"], capture_output=True, text=True)
    found = re.search(r"Version\s+(\S+)", run.stdout)
    return found.group(1) if found else "unknown"


def rss_bytes(pid: int) -> int:
    try:
        status = Path(f"/proc/{pid}/status").read_text()
    except OSError:
        return 0
    found = re.search(r"VmRSS:\s+(\d+)", status)
    return int(found.group(1)) * 1024 if found else 0


def run_ccx(
    ccx: str, work: Path, threads: int, memory_limit: int, time_limit: float
) -> dict[str, object]:
    """Runs ``ccx -i job`` in ``work``; wall time, peak resident memory and how it ended."""
    env = dict(os.environ)
    env.update(OMP_NUM_THREADS=str(threads), CCX_NPROC_EQUATION_SOLVER=str(threads))
    env.update(OPENBLAS_NUM_THREADS=str(threads))
    log = (work / "solver.log").open("w")
    start = time.monotonic()
    process = subprocess.Popen(
        [ccx, "-i", "job"], cwd=work, stdout=log, stderr=subprocess.STDOUT, env=env
    )
    status = "ok"
    while True:
        pid, wait_status, usage = os.wait4(process.pid, os.WNOHANG)
        if pid:
            break
        if rss_bytes(process.pid) > memory_limit:
            status = "memory_limit"
            process.send_signal(signal.SIGKILL)
        elif time.monotonic() - start > time_limit:
            status = "time_limit"
            process.send_signal(signal.SIGKILL)
        time.sleep(0.1)
    wall = time.monotonic() - start
    log.close()
    text = (work / "solver.log").read_text(errors="replace")
    code = os.waitstatus_to_exitcode(wait_status)
    if status == "ok" and (code != 0 or "*ERROR" in text):
        status = "failed"
    reported = re.search(r"Total CalculiX Time:\s*(\S+)", text)
    return {
        "status": status,
        "exitCode": code,
        "wallSeconds": round(wall, 2),
        "ccxReportedSeconds": float(reported.group(1)) if reported else None,
        "cpuSeconds": round(usage.ru_utime + usage.ru_stime, 2),
        "peakMemoryBytes": usage.ru_maxrss * 1024,
        "errors": [line.strip() for line in text.splitlines() if "*ERROR" in line][:5],
    }


def largest_displacement(frd: Path) -> float | None:
    """Largest displacement magnitude in the .frd file, in metres."""
    if not frd.exists():
        return None
    largest, inside = 0.0, False
    with frd.open() as f:
        for line in f:
            if line.startswith(" -4  DISP"):
                inside = True
            elif inside and line.startswith(" -3"):
                break
            elif inside and line.startswith(" -1"):
                u = [float(line[13 + 12 * k : 25 + 12 * k]) for k in range(3)]
                largest = max(largest, math.sqrt(u[0] ** 2 + u[1] ** 2 + u[2] ** 2))
    return largest if inside else None


def load_results(path: Path) -> dict[str, object]:
    if path.exists():
        return json.loads(path.read_text())
    return {"description": "M2.11 solver benchmark, see README.md beside this file", "runs": []}


def save_row(path: Path, row: dict[str, object]) -> None:
    data = load_results(path)
    key = (row["targetElements"], row["solver"], row["build"])
    runs = [
        r
        for r in data["runs"]  # type: ignore[union-attr]
        if (r["targetElements"], r["solver"], r["build"]) != key
    ]
    runs.append(row)
    runs.sort(key=lambda r: (r["build"], r["solver"], r["targetElements"]))
    data["runs"] = runs
    path.write_text(json.dumps(data, indent=2) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--targets", type=int, nargs="+", default=list(DEFAULT_TARGETS))
    parser.add_argument("--solvers", nargs="+", default=list(DEFAULT_SOLVERS))
    parser.add_argument("--ccx", default="ccx")
    parser.add_argument("--build", default="ubuntu-2.21-1")
    parser.add_argument("--threads", type=int, default=os.cpu_count() or 1)
    parser.add_argument("--memory-limit-gb", type=float, default=None)
    parser.add_argument("--time-limit-s", type=float, default=4 * 3600)
    parser.add_argument("--results", type=Path, default=HERE / "results.json")
    parser.add_argument("--keep", action="store_true", help="keep .frd/.dat files")
    args = parser.parse_args()
    host = machine()
    # Leave room for this script, the page cache and the system.
    limit = int(
        args.memory_limit_gb * 2**30 if args.memory_limit_gb else 0.85 * int(host["ramBytes"])
    )
    version = ccx_version(args.ccx)
    root = args.out
    root.mkdir(parents=True, exist_ok=True)
    step = root / "block.step"
    if not step.exists():
        write_block(step)
    if not (root / "import" / "topology.json").exists():
        import_geometry(step, root / "import", None)
    topology = Topology.model_validate_json((root / "import" / "topology.json").read_bytes())
    fixed, loaded = end_faces(topology)
    volume = math.prod(BLOCK) * 1e-9
    stopped: set[str] = set()
    for target in sorted(args.targets):
        size = (ELEMENTS_PER_SIZE_CUBED * volume / target) ** (1 / 3)
        mesh_dir = root / f"mesh-{target}"
        mesh_seconds = None
        if not (mesh_dir / "mesh.bin").exists():
            start = time.monotonic()
            mesh_geometry(step, topology, mesh_dir, scaling=1.0, size=size, unit="mm", order=2)
            mesh_seconds = round(time.monotonic() - start, 1)
        mesh = read_volume_mesh(mesh_dir / "mesh.bin")
        elements, nodes = mesh.element_count, mesh.node_count
        print(f"target {target:,}: {elements:,} elements, {nodes:,} nodes", flush=True)
        reference = None
        for solver in args.solvers:
            if solver in stopped:
                print(f"  {solver}: skipped (stopped on a smaller mesh)", flush=True)
                continue
            work = root / f"{target}-{args.build}-{solver.replace(' ', '_').lower()}"
            work.mkdir(exist_ok=True)
            s = spec(fixed, loaded, size * 1000)
            (work / "job.inp").write_text(generate_deck(s, mesh, solver=solver))
            del s
            result = run_ccx(args.ccx, work, args.threads, limit, args.time_limit_s)
            u = largest_displacement(work / "job.frd") if result["status"] == "ok" else None
            if solver == "SPOOLES" and u is not None:
                reference = u
            row = {
                "targetElements": target,
                "elements": elements,
                "nodes": nodes,
                "dof": 3 * nodes,
                "elementType": "C3D10",
                "meshSizeMetres": size,
                "meshSeconds": mesh_seconds,
                "solver": solver,
                "build": args.build,
                "ccxVersion": version,
                "threads": args.threads,
                "memoryLimitBytes": limit,
                **result,
                "largestDisplacementMetres": u,
                "relativeDifferenceToSpooles": (
                    abs(u - reference) / reference if u is not None and reference else None
                ),
                "machine": host,
                "date": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
            save_row(args.results, row)
            print(
                f"  {solver}: {result['status']}, {result['wallSeconds']} s, "
                f"{int(result['peakMemoryBytes']) / 2**30:.2f} GiB, u_max {u}",
                flush=True,
            )
            if result["status"] != "ok":
                stopped.add(solver)
            if not args.keep:
                for suffix in (".frd", ".dat", ".inp", ".12d", ".cvg", ".sta"):
                    (work / f"job{suffix}").unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
