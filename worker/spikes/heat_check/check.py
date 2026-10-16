# SPDX-License-Identifier: AGPL-3.0-or-later
"""M5.1 to M5.3 heat check: solve steady-state thermal decks with CalculiX through the deck
generator and the result reader, and compare every node with the closed-form one-dimensional
profile (ADR-064, ADR-065): fixed temperatures, a heat flux, convection, radiation and heat
generation. Since M5.3 also the heat flux at every node, each load's heat flow and the run's
heat balance, and a bar with every thermal load on it at once for the balance.

Script only, not part of the worker package or its tests (the fast tier runs no solver). It
checks what the platform path cannot see exactly: the temperature degree of freedom, the
offsets of °C and °F, the conductivity's unit, and the sign, unit and keyword of every thermal
load through to the solver, and the heat flows the reader works out from the solver's output.

    cd worker && uv run python spikes/heat_check/check.py [--out DIR]

Needs Gmsh's system libraries and `ccx` on the PATH. Exit status is non-zero if a check fails.
"""

import argparse
import subprocess
import sys
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
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


#: The bar's cross-section, m².
AREA = (H / 1000) ** 2


@dataclass(frozen=True)
class Scenario:
    """Loads, the exact temperature (K) and heat flux along x (W/m²) at x in metres, the
    allowed temperature error in K and heat flux error as a fraction of the largest exact
    flux (each one value, or one for first- and one for second-order elements), and the exact
    heat flow of each load into the bar (W). Every one is one-dimensional along the bar: the
    side faces are insulated."""

    name: str
    loads: list[dict]
    exact: Callable[[float], float]
    allowed: float | tuple[float, float]
    flux: Callable[[float], float]
    flux_allowed: float | tuple[float, float]
    flows: list[float]


def scenarios(hot: int, cold: int) -> list[Scenario]:
    """The one-dimensional cases. The fluxes and the radiation's and convection's ambient are
    in units other than SI on purpose, and the radiation case has no fixed temperature."""
    film_end = (K / LM * HOT_K + FILM * COLD_K) / (K / LM + FILM)
    rad_end = solve_radiating_end(FLUX)
    conduction = K * (HOT_K - COLD_K) / LM * AREA
    film = K * (HOT_K - film_end) / LM * AREA
    generated = POWER * LM * AREA
    return [
        Scenario(
            "fixed temperatures",
            [fixed(hot, HOT), fixed(cold, COLD)],
            lambda x: HOT_K + (COLD_K - HOT_K) * x / LM,
            0.01,
            lambda x: K * (HOT_K - COLD_K) / LM,
            1e-3,
            [conduction, -conduction],
        ),
        Scenario(
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
            lambda x: -FLUX,
            1e-3,
            [-FLUX * AREA, FLUX * AREA],
        ),
        Scenario(
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
            lambda x: K * (HOT_K - film_end) / LM,
            1e-3,
            [film, -film],
        ),
        Scenario(
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
            lambda x: FLUX,
            1e-3,
            [FLUX * AREA, -FLUX * AREA],
        ),
        Scenario(
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
            lambda x: -POWER * (LM - 2 * x) / 2,
            # Four-node elements have one gradient each, so their nodal average lags a flux
            # that changes along the bar, most at the ends.
            (0.1, 1e-3),
            [-generated / 2, -generated / 2, generated],
        ),
    ]


def side_faces(topology: Topology) -> tuple[int, int]:
    """The tags of the bar's y = 0 and y = H faces."""
    sides = {}
    for face in topology.faces:
        for y in (0.0, H / 1000):
            if abs(face.centroid[1] - y) < 1e-9:
                sides[y] = face.tag
    return sides[0.0], sides[H / 1000]


def every_load(hot: int, cold: int, low: int, high: int) -> list[dict]:
    """Every thermal load on the bar at once, for the heat balance: not one-dimensional, so no
    closed form. Heat comes in through the y = 0 side and from inside, and leaves through the
    fixed end, the y = H side and the radiating far end."""
    return [
        fixed(hot, HOT),
        {
            "id": "q",
            "type": "heat_flux",
            "name": "Flux",
            "faces": [low],
            "flux": {"value": 20, "unit": "kW/m²"},
        },
        {
            "id": "h",
            "type": "convection",
            "name": "Film",
            "faces": [high],
            "coefficient": {"value": 50, "unit": "W/(m²·K)"},
            "ambientTemperature": {"value": 20, "unit": "°C"},
        },
        {
            "id": "r",
            "type": "radiation",
            "name": "Radiation",
            "faces": [cold],
            "emissivity": EMISSIVITY,
            "ambientTemperature": {"value": 20, "unit": "°C"},
        },
        {
            "id": "g",
            "type": "heat_generation",
            "name": "Generation",
            "bodies": [1],
            "power": {"value": 100, "unit": "kW/m³"},
        },
    ]


#: The largest heat balance ratio allowed: the solver's equations hold to its tolerance and
#: the printed digits.
BALANCE = 1e-5


def solve(setup: SimulationSpec, mesh, work: Path):  # type: ignore[no-untyped-def]
    work.mkdir(exist_ok=True)
    # SPOOLES: the host's ccx may be built without PaStiX, the platform's default (ADR-063).
    # The loads' translation, which this checks, is the same for both.
    (work / "job.inp").write_text(generate_deck(setup, mesh, solver="SPOOLES"))
    run = subprocess.run(["ccx", "-i", "job"], cwd=work, capture_output=True, text=True)
    if run.returncode != 0 or "*ERROR" in run.stdout:
        raise RuntimeError(f"CalculiX failed:\n{run.stdout[-2000:]}")
    return read_results(setup, mesh, work / "job.frd", work / "job.dat", "check")


def _pick(allowed: float | tuple[float, float], order: int) -> float:
    return allowed[order - 1] if isinstance(allowed, tuple) else allowed


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
    low, high = side_faces(topology)

    failed = False
    rows = []
    for order in (1, 2):
        out = mesh_geometry(
            step, topology, root / f"mesh-p{order}", scaling=1.0, size=0.01, unit="mm", order=order
        )
        mesh = read_volume_mesh(out.mesh_path)
        label = f"C3D{4 if order == 1 else 10}"
        p = mesh.positions
        for k, case in enumerate(scenarios(hot, cold)):
            fields, result = solve(spec(case.loads), mesh, root / f"solve-p{order}-{k}")
            worst = max(
                abs(fields.temperature[n] - case.exact(p[3 * n])) for n in range(mesh.node_count)
            )
            peak = max(abs(case.flux(p[3 * n])) for n in range(mesh.node_count))
            q = fields.heat_flux
            flux_off = (
                max(
                    max(
                        abs(q[3 * n] - case.flux(p[3 * n])),
                        abs(q[3 * n + 1]),
                        abs(q[3 * n + 2]),
                    )
                    for n in range(mesh.node_count)
                )
                / peak
            )
            got = [f.heat for f in result.heat_flows or []]
            biggest = max(abs(f) for f in case.flows)
            flows_off = max(abs(a - b) for a, b in zip(got, case.flows, strict=True)) / biggest
            assert result.heat_balance is not None
            ratio = result.heat_balance.ratio
            checks = [
                ("temperature", worst, _pick(case.allowed, order), "K"),
                ("heat flux", flux_off, _pick(case.flux_allowed, order), "of the largest"),
                ("heat flow of each load", flows_off, 1e-3, "of the largest"),
                ("heat balance", ratio, BALANCE, ""),
            ]
            for what, value, allowed, unit in checks:
                ok = value <= allowed
                failed |= not ok
                rows.append(
                    f"| {label} | {case.name} | {what} | {value:.3g} {unit} | {allowed:g} | "
                    f"{'ok' if ok else 'off'} |"
                )
        _, result = solve(
            spec(every_load(hot, cold, low, high)), mesh, root / f"solve-p{order}-all"
        )
        assert result.heat_balance is not None
        balance = result.heat_balance
        ok = balance.ratio <= BALANCE
        failed |= not ok
        flows = ", ".join(f"{f.heat:.4g}" for f in result.heat_flows or [])
        rows.append(
            f"| {label} | every load at once (W: {flows}) | heat balance, in {balance.heat_in:.5g} "
            f"W, out {balance.heat_out:.5g} W | {balance.ratio:.3g} | {BALANCE:g} | "
            f"{'ok' if ok else 'off'} |"
        )
    print("| Element | Loads | Check | Largest error | Allowed | Result |")
    print("| --- | --- | --- | --- | --- | --- |")
    print("\n".join(rows))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
