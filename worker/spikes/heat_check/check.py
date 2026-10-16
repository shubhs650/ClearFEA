# SPDX-License-Identifier: AGPL-3.0-or-later
"""M5.1 heat check: solve steady-state thermal decks with CalculiX through the deck generator
and the result reader, and compare with the closed-form conduction profile (ADR-064).

Script only, not part of the worker package or its tests (the fast tier runs no solver). It
checks what the platform path cannot see exactly: the temperature degree of freedom, the
offsets of °C and °F, and the conductivity's unit through to the solver.

    cd worker && uv run python spikes/heat_check/check.py [--out DIR]

Needs Gmsh's system libraries and `ccx` on the PATH. Exit status is non-zero if a check fails.
"""

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

from clearfea_worker.deck import generate_deck
from clearfea_worker.geometry.importer import import_geometry
from clearfea_worker.meshing.mesher import mesh_geometry
from clearfea_worker.meshing.volume import read_volume_mesh
from clearfea_worker.results import read_results
from clearfea_worker.spec.geometry_schema import Topology
from clearfea_worker.spec.simulation_schema import SimulationSpec

#: The bar, in millimetres as the STEP file declares it: x from 0 to L, square section.
L, H = 200.0, 20.0
#: Fixed temperatures in deliberately mixed units: 100 °C (373.15 K) at x = 0 and 68 °F
#: (293.15 K) at x = L. The conductivity does not change a conduction profile between two
#: fixed temperatures, but a wrong factor or sign would stop the solve.
HOT, COLD = (100.0, "°C"), (68.0, "°F")
HOT_K, COLD_K = 373.15, 293.15
CONDUCTIVITY = (26.0, "BTU/(h·ft·°F)")


def write_bar(path: Path) -> Path:
    import gmsh

    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        gmsh.model.occ.addBox(0, 0, 0, L, H, H)
        gmsh.model.occ.synchronize()
        gmsh.write(str(path))
    finally:
        gmsh.finalize()
    return path


def end_faces(topology: Topology) -> tuple[int, int]:
    """The tags of the bar's x = 0 and x = L faces."""
    ends = {}
    for face in topology.faces:
        for x in (0.0, L / 1000):
            if abs(face.centroid[0] - x) < 1e-9:
                ends[x] = face.tag
    return ends[0.0], ends[L / 1000]


def spec(hot: int, cold: int) -> SimulationSpec:
    return SimulationSpec.model_validate(
        {
            "version": 1,
            "analysis": "steady_thermal",
            "geometryId": "heat-check",
            "bodies": [{"tag": 1, "material": "steel"}],
            "materials": [
                {
                    "id": "steel",
                    "name": "Steel",
                    "model": "isotropic_elastic",
                    "youngsModulus": None,
                    "poissonsRatio": None,
                    "thermalConductivity": {"value": CONDUCTIVITY[0], "unit": CONDUCTIVITY[1]},
                }
            ],
            "supports": [],
            "loads": [
                {
                    "id": "hot",
                    "type": "fixed_temperature",
                    "name": "Hot end",
                    "faces": [hot],
                    "temperature": {"value": HOT[0], "unit": HOT[1]},
                },
                {
                    "id": "cold",
                    "type": "fixed_temperature",
                    "name": "Cold end",
                    "faces": [cold],
                    "temperature": {"value": COLD[0], "unit": COLD[1]},
                },
            ],
            "mesh": {"size": {"value": 10, "unit": "mm"}},
        }
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    root = args.out or Path(tempfile.mkdtemp(prefix="heat-check-"))
    root.mkdir(parents=True, exist_ok=True)

    step = write_bar(root / "bar.step")
    import_geometry(step, root / "import", None)
    topology = Topology.model_validate_json((root / "import" / "topology.json").read_bytes())
    hot, cold = end_faces(topology)
    setup = spec(hot, cold)

    failed = False
    print("| Element | Check | Expected | Got | Result |")
    print("| --- | --- | --- | --- | --- |")
    for order in (1, 2):
        out = mesh_geometry(
            step, topology, root / f"mesh-p{order}", scaling=1.0, size=0.01, unit="mm", order=order
        )
        mesh = read_volume_mesh(out.mesh_path)
        work = root / f"solve-p{order}"
        work.mkdir(exist_ok=True)
        (work / "job.inp").write_text(generate_deck(setup, mesh))
        run = subprocess.run(["ccx", "-i", "job"], cwd=work, capture_output=True, text=True)
        if run.returncode != 0 or "*ERROR" in run.stdout:
            print(f"CalculiX failed:\n{run.stdout[-2000:]}")
            return 1
        fields, result = read_results(setup, mesh, work / "job.frd", work / "job.dat", "check")
        label = f"C3D{4 if order == 1 else 10}"
        # Conduction between two fixed temperatures with every other face insulated is linear
        # in x, which both element orders represent exactly; the .frd file keeps five
        # significant digits (0.01 K at 300 K).
        worst = 0.0
        p = mesh.positions
        for n in range(mesh.node_count):
            exact = HOT_K + (COLD_K - HOT_K) * p[3 * n] / (L / 1000)
            worst = max(worst, abs(fields.temperature[n] - exact))
        rows = [
            ("largest error against the linear profile (K)", "< 0.01", worst, worst < 0.01),
            (
                "highest temperature (K)",
                f"{HOT_K}",
                result.temperature.max.value,
                abs(result.temperature.max.value - HOT_K) < 0.01,
            ),
            (
                "lowest temperature (K)",
                f"{COLD_K}",
                result.temperature.min.value,
                abs(result.temperature.min.value - COLD_K) < 0.01,
            ),
        ]
        for check, expected, got, ok in rows:
            failed |= not ok
            print(f"| {label} | {check} | {expected} | {got:.6g} | {'ok' if ok else 'off'} |")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
