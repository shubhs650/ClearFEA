# SPDX-License-Identifier: AGPL-3.0-or-later
"""M5.1 and M5.2 heat check: solve steady-state thermal decks with CalculiX through the deck
generator and the result reader, and compare every node with the closed-form one-dimensional
profile (ADR-064, ADR-065): fixed temperatures, a heat flux, convection, radiation and heat
generation.

Script only, not part of the worker package or its tests (the fast tier runs no solver). It
checks what the platform path cannot see exactly: the temperature degree of freedom, the
offsets of °C and °F, the conductivity's unit, and the sign, unit and keyword of every thermal
load through to the solver.

    cd worker && uv run python spikes/heat_check/check.py [--out DIR]

Needs Gmsh's system libraries and `ccx` on the PATH. Exit status is non-zero if a check fails.
"""

import argparse
import subprocess
import sys
import tempfile
from collections.abc import Callable
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


def spec(loads: list[dict]) -> SimulationSpec:
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
            "loads": loads,
            "mesh": {"size": {"value": 10, "unit": "mm"}},
        }
    )


def fixed(face: int, value: tuple[float, str]) -> dict:
    return {
        "id": f"t{face}",
        "type": "fixed_temperature",
        "name": f"Face {face}",
        "faces": [face],
        "temperature": {"value": value[0], "unit": value[1]},
    }


#: The conductivity in W/(m·K), and the bar's length in metres.
K = CONDUCTIVITY[0] * 1.7307346663713912
LM = L / 1000
#: Stefan-Boltzmann constant, W/(m²·K⁴).
SIGMA = 5.670374419e-8
#: M5.2 loads, each in a unit other than SI: 2 W/cm² is 20 kW/m² (as 0.02 W/mm²), a film
#: coefficient of 30 BTU/(h·ft²·°F), radiation with emissivity 0.8, 3 MW/m³ generated.
FLUX = 20000.0
FILM = 30 * 5.678263341113488
EMISSIVITY = 0.8
POWER = 3.0e6


def solve_radiating_end(q: float) -> float:
    """The temperature of the x = L end radiating to COLD_K while q (W/m²) arrives: q =
    εσ(T⁴ − T∞⁴)."""
    return (q / (EMISSIVITY * SIGMA) + COLD_K**4) ** 0.25


def scenarios(
    hot: int, cold: int
) -> list[tuple[str, list[dict], Callable[[float], float], float | tuple[float, float]]]:
    """(name, loads, exact temperature at x in metres, tolerance in K, or one for first- and
    one for second-order elements). Every one is one-dimensional along the bar: the side faces
    are insulated. The fluxes and the radiation's and convection's ambient are in units other
    than SI on purpose, and the radiation case has no fixed temperature."""
    film_end = (K / LM * HOT_K + FILM * COLD_K) / (K / LM + FILM)
    rad_end = solve_radiating_end(FLUX)
    return [
        (
            "fixed temperatures",
            [fixed(hot, HOT), fixed(cold, COLD)],
            lambda x: HOT_K + (COLD_K - HOT_K) * x / LM,
            0.01,
        ),
        (
            "heat flux into the far end",
            [
                fixed(hot, HOT),
                {
                    "id": "q",
                    "type": "heat_flux",
                    "name": "Flux",
                    "faces": [cold],
                    "flux": {"value": 0.02, "unit": "W/mm²"},
                },
            ],
            lambda x: HOT_K + FLUX * x / K,
            0.01,
        ),
        (
            "convection at the far end",
            [
                fixed(hot, HOT),
                {
                    "id": "h",
                    "type": "convection",
                    "name": "Film",
                    "faces": [cold],
                    "coefficient": {"value": 30, "unit": "BTU/(h·ft²·°F)"},
                    "ambientTemperature": {"value": COLD[0], "unit": COLD[1]},
                },
            ],
            lambda x: HOT_K + (film_end - HOT_K) * x / LM,
            0.01,
        ),
        (
            "flux in, radiation out, no fixed temperature",
            [
                {
                    "id": "q",
                    "type": "heat_flux",
                    "name": "Flux",
                    "faces": [hot],
                    "flux": {"value": 20, "unit": "kW/m²"},
                },
                {
                    "id": "r",
                    "type": "radiation",
                    "name": "Radiation",
                    "faces": [cold],
                    "emissivity": EMISSIVITY,
                    "ambientTemperature": {"value": COLD[0], "unit": COLD[1]},
                },
            ],
            lambda x: rad_end + FLUX * (LM - x) / K,
            0.01,
        ),
        (
            "heat generation between two fixed ends",
            [
                fixed(hot, HOT),
                fixed(cold, HOT),
                {
                    "id": "g",
                    "type": "heat_generation",
                    "name": "Generation",
                    "bodies": [1],
                    "power": {"value": 3000, "unit": "kW/m³"},
                },
            ],
            lambda x: HOT_K + POWER * x * (LM - x) / (2 * K),
            # The profile is quadratic: exact for ten-node tetrahedra; four-node ones are linear
            # across 20 elements along the bar, off by about 0.3 percent of the 333 K rise.
            (2.0, 0.01),
        ),
    ]


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

    failed = False
    print("| Element | Loads | Largest error at a node (K) | Allowed (K) | Result |")
    print("| --- | --- | --- | --- | --- |")
    for order in (1, 2):
        out = mesh_geometry(
            step, topology, root / f"mesh-p{order}", scaling=1.0, size=0.01, unit="mm", order=order
        )
        mesh = read_volume_mesh(out.mesh_path)
        label = f"C3D{4 if order == 1 else 10}"
        for k, (name, loads, exact, allowed) in enumerate(scenarios(hot, cold)):
            setup = spec(loads)
            work = root / f"solve-p{order}-{k}"
            work.mkdir(exist_ok=True)
            # SPOOLES: the host's ccx may be built without PaStiX, the platform's default
            # (ADR-063). The loads' translation, which this checks, is the same for both.
            (work / "job.inp").write_text(generate_deck(setup, mesh, solver="SPOOLES"))
            run = subprocess.run(["ccx", "-i", "job"], cwd=work, capture_output=True, text=True)
            if run.returncode != 0 or "*ERROR" in run.stdout:
                print(f"CalculiX failed on {name}:\n{run.stdout[-2000:]}")
                return 1
            fields, _ = read_results(setup, mesh, work / "job.frd", work / "job.dat", "check")
            p = mesh.positions
            worst = max(
                abs(fields.temperature[n] - exact(p[3 * n])) for n in range(mesh.node_count)
            )
            if isinstance(allowed, tuple):
                allowed = allowed[order - 1]
            ok = worst < allowed
            failed |= not ok
            print(f"| {label} | {name} | {worst:.3g} | {allowed} | {'ok' if ok else 'off'} |")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
