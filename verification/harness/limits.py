# SPDX-License-Identifier: AGPL-3.0-or-later
"""Runs a model at each solver's element limit (ADR-063, ADR-072) through the platform (M9.1).

    cd verification && uv run --project ../worker --locked python -m harness.limits \
        --api http://127.0.0.1:8787 [--out DIR] [pastix-2 spooles-1 ...]

Point it at `make dev` (or any running API and worker). The model is the M2.11 benchmark block
(100 x 100 x 50 mm, held at x = 0, 10 MPa on x = 100 mm; modal runs held the same way with no
load and 100 modes), the hard case for a direct solver, meshed with a size that lands just
under the limit for the solver and element order. Each run goes the whole way a user's does:
upload, mesh, estimate, run on the recommended machine size, and every file the viewer fetches.
It prints a table of element counts, estimated and measured time, the solver's peak memory
(read from /proc on this host, so the API, worker and solver must run on it) and the host's
least available memory, and writes it with the figures as JSON to --out. Against an API on
another host, such as the live site (M10.9), the memory columns are left empty: the solver runs
on a machine this script cannot see. Exit status 1 if a
mesh misses its limit, a run does not succeed or a viewer file cannot be fetched.
"""

import argparse
import json
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .client import ApiError, Client

ROOT = Path(__file__).resolve().parents[2]
ESTIMATOR = ROOT / "packages" / "spec" / "estimator.json"
LOGIN, PASSWORD = "alice", "alice-local"  # seeded local test user (ADR-022)
BLOCK_MM = (100.0, 100.0, 50.0)
#: A mesh counts as at its limit when it has at least this share of the limit's elements.
#: Gmsh's element count jumps where an edge gains a segment, so not every count can be had.
NEAR = 0.95
MODES = 100  # the modal limits are for 100 modes (ADR-072 item 3)
GIB = 2**30


@dataclass(frozen=True)
class LimitCase:
    solver: str
    order: int
    analysis: str  # linear_static or modal
    size_mm: float  # global mesh size found to land just under the limit on the block

    @property
    def key(self) -> str:
        return f"{'modal-' if self.analysis == 'modal' else ''}{self.solver}-{self.order}"


# Quickest first, so a problem common to all shows up early.
LIMIT_CASES = (
    LimitCase("iterative_cholesky", 1, "linear_static", 1.724),
    LimitCase("iterative_scaling", 1, "linear_static", 1.724),
    LimitCase("spooles", 1, "linear_static", 1.724),
    LimitCase("pastix", 1, "linear_static", 1.2707),
    LimitCase("pastix", 2, "linear_static", 2.5635),
    LimitCase("iterative_cholesky", 2, "linear_static", 1.724),
    LimitCase("spooles", 2, "linear_static", 2.45),
    LimitCase("iterative_scaling", 2, "linear_static", 1.724),
    LimitCase("spooles", 1, "modal", 1.724),
    LimitCase("spooles", 2, "modal", 2.565),
)


def limit_of(estimator: dict[str, Any], case: LimitCase) -> int:
    table = estimator["analyses"][case.analysis][case.solver]
    return int(table["maxElements"][f"order{case.order}"])


def write_block(path: Path) -> None:
    import gmsh

    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        gmsh.model.occ.addBox(0, 0, 0, *BLOCK_MM)
        gmsh.model.occ.synchronize()
        gmsh.write(str(path))
    finally:
        gmsh.finalize()


def end_faces(topology: dict[str, Any]) -> tuple[int, int]:
    """The x = 0 face (held) and the x = 100 mm face (pressed); centroids are in metres."""
    faces = topology["faces"]
    fixed = next(f["tag"] for f in faces if abs(f["centroid"][0]) < 1e-9)
    loaded = next(f["tag"] for f in faces if abs(f["centroid"][0] - BLOCK_MM[0] / 1000) < 1e-9)
    return fixed, loaded


def spec_for(case: LimitCase, geometry_id: str, fixed: int, loaded: int) -> dict[str, Any]:
    material: dict[str, Any] = {
        "id": "steel",
        "name": "Steel",
        "model": "isotropic_elastic",
        "youngsModulus": {"value": 200.0, "unit": "GPa"},
        "poissonsRatio": 0.3,
    }
    spec: dict[str, Any] = {
        "version": 1,
        "analysis": case.analysis,
        "geometryId": geometry_id,
        "bodies": [{"tag": 1, "material": "steel"}],
        "materials": [material],
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
        "mesh": {"size": {"value": case.size_mm, "unit": "mm"}, "order": case.order},
        "solver": case.solver,
    }
    if case.analysis == "modal":
        spec["loads"] = []
        spec["modes"] = MODES
        material["density"] = {"value": 7850.0, "unit": "kg/m³"}
    return spec


class MemoryWatch:
    """Samples this host's available memory and the largest resident ccx process every 0.5 s;
    does nothing when not `enabled` (the solver runs on another host)."""

    def __init__(self, enabled: bool = True) -> None:
        self.enabled = enabled
        self.least_available = float("inf")
        self.ccx_peak = 0
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def __enter__(self) -> "MemoryWatch":
        if self.enabled:
            self._thread.start()
        return self

    def __exit__(self, *_: object) -> None:
        if self.enabled:
            self._stop.set()
            self._thread.join()

    def _run(self) -> None:
        while not self._stop.wait(0.5):
            for line in Path("/proc/meminfo").read_text().splitlines():
                if line.startswith("MemAvailable:"):
                    available = int(line.split()[1]) * 1024
                    self.least_available = min(self.least_available, available)
            for proc in Path("/proc").iterdir():
                if not proc.name.isdigit():
                    continue
                try:
                    if (proc / "comm").read_text().strip() != "ccx":
                        continue
                    for line in (proc / "status").read_text().splitlines():
                        if line.startswith("VmRSS:"):
                            self.ccx_peak = max(self.ccx_peak, int(line.split()[1]) * 1024)
                except OSError:
                    continue


def fetch_timed(api: Client, path: str) -> dict[str, Any]:
    started = time.monotonic()
    data = api.bytes(path)
    return {"path": path, "bytes": len(data), "seconds": round(time.monotonic() - started, 2)}


def run_limit(
    api: Client,
    case: LimitCase,
    limit: int,
    geometry: dict[str, Any],
    timeout: float,
    local: bool = True,
) -> dict[str, Any]:
    row: dict[str, Any] = {"case": case.key, "solver": case.solver, "order": case.order,
                           "analysis": case.analysis, "limit": limit, "ok": False}  # fmt: skip
    topology = api.json("GET", f"/api/geometries/{geometry['id']}/topology")
    fixed, loaded = end_faces(topology)
    spec = spec_for(case, geometry["id"], fixed, loaded)
    sid = api.json(
        "POST", "/api/simulations", {"geometryId": geometry["id"], "name": case.key, "spec": spec}
    )["simulation"]["id"]

    started = time.monotonic()
    with MemoryWatch(local) as watch:
        api.json("POST", f"/api/simulations/{sid}/mesh")
        mesh = api.wait(f"/api/simulations/{sid}/mesh", "mesh", {"meshing"}, timeout)
    row["meshSeconds"] = round(time.monotonic() - started, 1)
    if local:
        row["meshLeastAvailableGiB"] = round(watch.least_available / GIB, 2)
    if mesh["status"] != "ready":
        row["problem"] = f"Meshing failed: {mesh['problem']}"
        return row
    row["elements"], row["nodes"] = mesh["elementCount"], mesh["nodeCount"]
    if not NEAR * limit <= mesh["elementCount"] <= limit:
        row["problem"] = (
            f"The mesh has {mesh['elementCount']} elements, not within {NEAR:.0%} of the limit"
            f" of {limit}; pick another size for {case.key}."
        )
        return row

    estimate = api.json("GET", f"/api/simulations/{sid}/estimate")["estimate"]
    row["estimatedSeconds"] = estimate["seconds"]
    row["estimatedMemoryGiB"] = round(estimate["memoryBytes"] / GIB, 2)
    row["recommended"] = estimate.get("recommended")

    started = time.monotonic()
    with MemoryWatch(local) as watch:
        run = api.json("POST", f"/api/simulations/{sid}/runs")["run"]
        run = api.wait(f"/api/runs/{run['id']}", "run", {"solving"}, timeout)
    row["runSeconds"] = round(time.monotonic() - started, 1)
    if local:
        row["ccxPeakGiB"] = round(watch.ccx_peak / GIB, 2)
        row["leastAvailableGiB"] = round(watch.least_available / GIB, 2)
    row["machine"] = run["machine"]
    row["billedSeconds"] = (run.get("cost") or {}).get("billedSeconds")
    if run["status"] != "succeeded":
        row["problem"] = f"The run {run['status']}: {run['problem']}"
        return row

    rid = run["id"]
    # What the viewer fetches: the surface and its fields on opening the results, the volume
    # mesh and the values at every node for a cut plane (fetched here whole, not per field).
    fetches = [
        fetch_timed(api, f"/api/runs/{rid}/{file}")
        for file in ("surface", "fields", "mesh", "nodes")
    ]
    row["fetches"] = fetches
    row["fetchSeconds"] = round(sum(f["seconds"] for f in fetches), 1)
    row["fetchMiB"] = round(sum(f["bytes"] for f in fetches) / 2**20, 1)
    row["frequencies"] = len(run["result"].get("frequencies") or [])
    row["ok"] = True
    return row


def table(rows: list[dict[str, Any]]) -> str:
    head = (
        "| Case | Limit | Elements | Nodes | Mesh s | Estimate s | Run s | Billed s "
        "| Est. GiB | ccx peak GiB | Least free GiB | Viewer files | Result |\n"
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |"
    )
    lines = [head]
    for r in rows:
        files = f"{r['fetchMiB']} MiB in {r['fetchSeconds']} s" if "fetchMiB" in r else ""
        lines.append(
            f"| {r['case']} | {r['limit']:,} | {r.get('elements', 0):,} | {r.get('nodes', 0):,}"
            f" | {r.get('meshSeconds', '')} | {r.get('estimatedSeconds', '')}"
            f" | {r.get('runSeconds', '')} | {r.get('billedSeconds', '')}"
            f" | {r.get('estimatedMemoryGiB', '')} | {r.get('ccxPeakGiB', '')}"
            f" | {r.get('leastAvailableGiB', '')} | {files}"
            f" | {'ok' if r['ok'] else r.get('problem', 'failed')} |"
        )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("cases", nargs="*", help="case keys, for example pastix-2; default all")
    parser.add_argument("--api", default="http://127.0.0.1:8787", help="API base URL")
    parser.add_argument("--timeout", type=float, default=6 * 3600.0, help="seconds per step")
    parser.add_argument("--out", type=Path, default=None, help="folder for limits.md and .json")
    args = parser.parse_args()
    cases = [c for c in LIMIT_CASES if not args.cases or c.key in args.cases]
    if not cases:
        keys = ", ".join(c.key for c in LIMIT_CASES)
        print(f"No case matches {args.cases}. Cases: {keys}.", file=sys.stderr)
        return 2
    out = args.out or Path(tempfile.mkdtemp(prefix="limits-"))
    out.mkdir(parents=True, exist_ok=True)
    estimator = json.loads(ESTIMATOR.read_text())
    local = urlparse(args.api).hostname in {"127.0.0.1", "localhost"}

    api = Client(args.api)
    api.sign_in(LOGIN, PASSWORD)
    step = out / "block.step"
    write_block(step)
    geometry = api.upload(f"/api/geometries?name={step.name}", step.read_bytes())["geometry"]
    geometry = api.wait(f"/api/geometries/{geometry['id']}", "geometry", {"importing"}, 300)
    if geometry["status"] != "ready":
        geometry = api.json("POST", f"/api/geometries/{geometry['id']}/unit", {"unit": "mm"})[
            "geometry"
        ]
        geometry = api.wait(f"/api/geometries/{geometry['id']}", "geometry", {"importing"}, 300)

    rows = []
    for case in cases:
        print(f"[limits] {case.key} at {case.size_mm} mm", flush=True)
        try:
            row = run_limit(api, case, limit_of(estimator, case), geometry, args.timeout, local)
        except ApiError as error:
            row = {"case": case.key, "limit": limit_of(estimator, case), "ok": False,
                   "problem": str(error).replace("\n", " ")}  # fmt: skip
        rows.append(row)
        print(f"[limits] {case.key}: {json.dumps(row)}", flush=True)
        (out / "limits.json").write_text(json.dumps(rows, indent=2))

    text = table(rows)
    print("\n" + text)
    (out / "limits.md").write_text(text + "\n")
    print(f"\nResults in {out}")
    return 0 if all(r["ok"] for r in rows) else 1


if __name__ == "__main__":
    sys.exit(main())
