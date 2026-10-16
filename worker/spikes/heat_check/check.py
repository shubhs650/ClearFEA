# SPDX-License-Identifier: AGPL-3.0-or-later
"""M5.1 to M5.4 heat check: solve steady-state thermal decks with CalculiX through the deck
generator and the result reader, and compare every node with the closed-form one-dimensional
profile (ADR-064, ADR-065): fixed temperatures, a heat flux, convection, radiation and heat
generation. Since M5.3 also the heat flux at every node, each load's heat flow and the run's
heat balance, and a bar with every thermal load on it at once for the balance. Since M5.4 the
thermal stress decks of the linear profiles (ADR-067): the bar held on every side and at one
end, so its stresses and displacements have a closed form at every node. Since M5.5 a
conductivity that varies with temperature, given as a table (ADR-068), against the exact
profile of a linear k(T) at every node. Since M5.6 the bar cut into two bonded bodies of
different materials (bonded.py, ADR-069): heat across the bond at every node, as heat transfer
and as thermal stress, and the heat balance with a fixed temperature next to the bond.

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

from bonded import L1M, bonded_setup, bonded_spec, faces_at

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


#: M5.4: steel in mixed units, 29,000 ksi (199.9 GPa), ν = 0.3, 6.5 µin/(in·°F) (11.7e-6/K),
#: stress-free at 122 °F (50 °C), between the bar's end temperatures so it is in compression
#: at the hot end and in tension at the cold one.
E_KSI, NU, ALPHA_US = 29000.0, 0.3, 6.5
E = E_KSI * 6894757.293168361
ALPHA = ALPHA_US * 1e-6 * 1.8
REFERENCE, REFERENCE_K = (122.0, "°F"), 323.15


def stress_spec(loads: list[dict], sides: list[int]) -> SimulationSpec:
    """spec() as a thermal stress analysis: the x = 0 end and the four sides on frictionless
    supports (``sides``, x = 0 first), so the bar can only grow along x. Every point then has
    εyy = εzz = 0 and, with the far end free, σxx = 0: σyy = σzz = −E α (T − T₀)/(1 − ν) and
    εxx = α (T − T₀)(1 + ν)/(1 − ν), exact for any temperature that varies along x only."""
    setup = spec(loads).model_dump(by_alias=True)
    setup["analysis"] = "thermal_stress"
    setup["stressFreeTemperature"] = {"value": REFERENCE[0], "unit": REFERENCE[1]}
    setup["materials"][0] |= {
        "youngsModulus": {"value": E_KSI, "unit": "ksi"},
        "poissonsRatio": NU,
        "thermalExpansion": {"value": ALPHA_US, "unit": "µin/(in·°F)"},
    }
    setup["supports"] = [
        {"id": f"s{face}", "type": "frictionless", "name": f"Face {face}", "faces": [face]}
        for face in sides
    ]
    return SimulationSpec.model_validate(setup)


def stress_checks(
    case: Scenario, mesh, fields, result, order: int
) -> list[tuple[str, float, float, str]]:  # type: ignore[no-untyped-def]
    """The thermal stress checks of a linear profile at every node: temperature, σyy and σzz
    against the closed form and σxx, the shears and the sideways displacements against zero
    (as a fraction of the largest exact stress or displacement), the end's growth, and the
    balance of the supports' reactions (no load is applied).

    Ten-node tetrahedra represent the linear thermal strain exactly. Four-node ones have one
    strain each, so a thermal strain that changes along the bar leaves each element off by
    about half its change across the element (4 K of the bar's 80 K in 10 mm elements, against
    at most 50 K from the stress-free temperature), most where the nodal average is one-sided,
    at the ends."""
    p = mesh.positions
    xs = [p[3 * n] for n in range(mesh.node_count)]
    a, b = case.exact(0.0), (case.exact(LM) - case.exact(0.0)) / LM
    factor = E * ALPHA / (1 - NU)

    def sigma(x: float) -> float:
        return -factor * (case.exact(x) - REFERENCE_K)

    def ux(x: float) -> float:
        return ALPHA * (1 + NU) / (1 - NU) * ((a - REFERENCE_K) * x + b * x * x / 2)

    peak = max(abs(sigma(x)) for x in xs)
    grow = max(abs(ux(x)) for x in xs)
    s, u, t = fields.stress, fields.displacement, fields.thermal.temperature
    stress_off = max(
        max(abs(s[6 * n] - 0.0), abs(s[6 * n + 1] - sigma(x)), abs(s[6 * n + 2] - sigma(x)))
        for n, x in enumerate(xs)
    )
    shear_off = max(abs(s[6 * n + i]) for n in range(mesh.node_count) for i in (3, 4, 5))
    move_off = max(
        max(abs(u[3 * n] - ux(x)), abs(u[3 * n + 1]), abs(u[3 * n + 2])) for n, x in enumerate(xs)
    )
    return [
        ("temperature", max(abs(t[n] - case.exact(x)) for n, x in enumerate(xs)), 0.01, "K"),
        ("normal stresses", stress_off / peak, _pick((0.05, 1e-3), order), "of the largest"),
        ("shear stresses", shear_off / peak, _pick((0.02, 1e-3), order), "of the largest"),
        ("displacements", move_off / grow, _pick((0.005, 1e-3), order), "of the largest"),
        ("reaction balance", result.balance.force_ratio, 1e-6, ""),
    ]


def side_faces(topology: Topology) -> tuple[int, int]:
    """The tags of the bar's y = 0 and y = H faces."""
    sides = {}
    for face in topology.faces:
        for y in (0.0, H / 1000):
            if abs(face.centroid[1] - y) < 1e-9:
                sides[y] = face.tag
    return sides[0.0], sides[H / 1000]


def bottom_top_faces(topology: Topology) -> tuple[int, int]:
    """The tags of the bar's z = 0 and z = H faces."""
    faces = {}
    for face in topology.faces:
        for z in (0.0, H / 1000):
            if abs(face.centroid[2] - z) < 1e-9:
                faces[z] = face.tag
    return faces[0.0], faces[H / 1000]


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


#: M5.5: a conductivity table, 60 W/(m·K) at 250 K falling to 30 W/(m·K) at 400 K, linear
#: between; the bar's temperatures (293.15 to 373.15 K) lie inside it.
TABLE = [(250.0, 60.0), (400.0, 30.0)]


def k_of(t: float) -> float:
    (t0, k0), (t1, k1) = TABLE
    return k0 + (k1 - k0) * (t - t0) / (t1 - t0)


def k_integral(t: float) -> float:
    """∫ k dT from COLD_K to t (the Kirchhoff transform), exact for the linear k."""
    return (k_of(COLD_K) + k_of(t)) / 2 * (t - COLD_K)


def table_profile(x: float) -> float:
    """The exact temperature at x: the Kirchhoff transform falls linearly from the hot end to
    the cold one, k_integral(T(x)) = k_integral(HOT_K) (1 - x / L); solved by bisection."""
    target = k_integral(HOT_K) * (1 - x / LM)
    lo, hi = COLD_K, HOT_K
    for _ in range(100):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if k_integral(mid) < target else (lo, mid)
    return (lo + hi) / 2


def table_spec(hot: int, cold: int) -> SimulationSpec:
    """spec() between the two fixed temperatures, with the conductivity as TABLE."""
    setup = spec([fixed(hot, HOT), fixed(cold, COLD)]).model_dump(by_alias=True)
    setup["materials"][0] |= {
        "thermalConductivity": None,
        "thermalConductivityTable": {
            "temperatureUnit": "K",
            "unit": "W/(m·K)",
            "rows": [{"temperature": t, "value": k} for t, k in TABLE],
        },
    }
    return SimulationSpec.model_validate(setup)


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


#: The second body's material (M5.6): a third of the steel's conductivity and stiffness, the
#: same expansion and Poisson's ratio, conductivity in W/(m·K) to mix units with the first.
K2 = K / 3
E2_KSI = E_KSI / 3
FILM_BONDED = 200.0


def bonded_checks(root: Path, order: int) -> list[tuple[str, float, float, str]]:
    """The two-body bar's checks (bonded.py), each "loads | check" first."""
    topology, mesh, bonds = bonded_setup(root, L, H, order)
    hot = faces_at(topology, 0, 0.0)[0]
    cold = faces_at(topology, 0, LM)[0]
    second = {
        "id": "soft",
        "name": "Soft",
        "model": "isotropic_elastic",
        "youngsModulus": {"value": E2_KSI, "unit": "ksi"},
        "poissonsRatio": NU,
        "thermalExpansion": {"value": ALPHA_US, "unit": "µin/(in·°F)"},
        "thermalConductivity": {"value": K2, "unit": "W/(m·K)"},
    }
    l2 = LM - L1M
    p = mesh.positions
    xs = [p[3 * n] for n in range(mesh.node_count)]
    out: list[tuple[str, float, float, str]] = []

    def series(t_hot: float, t_far: float, extra: float) -> tuple[float, Callable[[float], float]]:
        """Flux and profile of the series wall from t_hot at x = 0 to t_far, with ``extra``
        (m²·K/W) of resistance beyond x = L."""
        q = (t_hot - t_far) / (L1M / K + l2 / K2 + extra)
        middle = t_hot - q * L1M / K

        def exact(x: float) -> float:
            return t_hot - q * x / K if x <= L1M else middle - q * (x - L1M) / K2

        return q, exact

    def heat_rows(name: str, fields, result, q: float, exact) -> None:  # type: ignore[no-untyped-def]
        t, f = fields.temperature, fields.heat_flux
        worst = max(abs(t[n] - exact(x)) for n, x in enumerate(xs))
        flux_off = max(
            max(abs(f[3 * n] - q), abs(f[3 * n + 1]), abs(f[3 * n + 2]))
            for n in range(mesh.node_count)
        )
        got = [x.heat for x in result.heat_flows or []]
        flows_off = max(abs(a - b) for a, b in zip(got, [q * AREA, -q * AREA], strict=True))
        out.extend(
            [
                (f"two bonded bodies, {name} | temperature", worst, 0.01, "K"),
                (f"two bonded bodies, {name} | heat flux", flux_off / q, 1e-3, "of the largest"),
                (
                    f"two bonded bodies, {name} | heat flow of each load",
                    flows_off / (q * AREA),
                    1e-3,
                    "of the largest",
                ),
                (
                    f"two bonded bodies, {name} | heat balance",
                    result.heat_balance.ratio,
                    BALANCE,
                    "",
                ),
            ]
        )

    base = spec([]).model_dump(by_alias=True)
    q, exact = series(HOT_K, COLD_K, 0.0)
    loads = [fixed(hot, HOT), fixed(cold, COLD)]
    setup = bonded_spec(base, bonds, second, loads)
    fields, result = solve(setup, mesh, root / f"bonded-p{order}-fixed")
    heat_rows("fixed temperatures", fields, result, q, exact)

    q, exact = series(HOT_K, COLD_K, 1 / FILM_BONDED)
    film = {
        "id": "film",
        "type": "convection",
        "name": "Cold end",
        "faces": [cold],
        "coefficient": {"value": FILM_BONDED, "unit": "W/(m²·K)"},
        "ambientTemperature": {"value": COLD[0], "unit": COLD[1]},
    }
    setup = bonded_spec(base, bonds, second, [fixed(hot, HOT), film])
    fields, result = solve(setup, mesh, root / f"bonded-p{order}-film")
    heat_rows("fixed temperature, convection", fields, result, q, exact)

    # Thermal stress of the series wall, held on the x = 0 end and the four sides of both bodies.
    q, exact = series(HOT_K, COLD_K, 0.0)
    sides = [
        hot,
        *faces_at(topology, 1, 0.0),
        *faces_at(topology, 1, H / 1000),
        *faces_at(topology, 2, 0.0),
        *faces_at(topology, 2, H / 1000),
    ]
    one = stress_spec([fixed(hot, HOT), fixed(cold, COLD)], sides).model_dump(by_alias=True)
    setup = bonded_spec(one, bonds, second, [fixed(hot, HOT), fixed(cold, COLD)])
    fields, result = solve(setup, mesh, root / f"bonded-p{order}-stress")
    second_body = [False] * mesh.node_count
    first, count = mesh.bodies[2]
    npe = 4 if order == 1 else 10
    for node in mesh.elements[first * npe : (first + count) * npe]:
        second_body[node] = True

    def sigma(n: int, x: float) -> float:
        modulus = E * (1 / 3 if second_body[n] else 1.0)
        return -modulus * ALPHA / (1 - NU) * (exact(x) - REFERENCE_K)

    middle = exact(L1M)

    def ux(x: float) -> float:
        # The integral of T − T₀ from 0 to x, linear in each body.
        if x <= L1M:
            area = ((HOT_K - REFERENCE_K) + (exact(x) - REFERENCE_K)) / 2 * x
        else:
            area = ((HOT_K - REFERENCE_K) + (middle - REFERENCE_K)) / 2 * L1M
            area += ((middle - REFERENCE_K) + (exact(x) - REFERENCE_K)) / 2 * (x - L1M)
        return ALPHA * (1 + NU) / (1 - NU) * area

    s, u, t = fields.stress, fields.displacement, fields.thermal.temperature
    peak = max(abs(sigma(n, x)) for n, x in enumerate(xs))
    grow = max(abs(ux(x)) for x in xs)
    stress_off = max(
        max(abs(s[6 * n]), abs(s[6 * n + 1] - sigma(n, x)), abs(s[6 * n + 2] - sigma(n, x)))
        for n, x in enumerate(xs)
    )
    move_off = max(
        max(abs(u[3 * n] - ux(x)), abs(u[3 * n + 1]), abs(u[3 * n + 2])) for n, x in enumerate(xs)
    )
    name = "two bonded bodies, thermal stress"
    out.extend(
        [
            (
                f"{name} | temperature",
                max(abs(t[n] - exact(x)) for n, x in enumerate(xs)),
                0.01,
                "K",
            ),
            (
                f"{name} | normal stresses",
                stress_off / peak,
                _pick((0.05, 1e-3), order),
                "of the largest",
            ),
            (
                f"{name} | displacements",
                move_off / grow,
                _pick((0.005, 1e-3), order),
                "of the largest",
            ),
            (f"{name} | heat balance", result.heat_balance.ratio, BALANCE, ""),
            (f"{name} | reaction balance", result.balance.force_ratio, 1e-6, ""),
        ]
    )

    # A fixed temperature on the first body's sides, which meet the bond's edges, and the cold
    # end: tied nodes follow nodes the fixed temperature holds.
    walls = [
        f
        for f in [*faces_at(topology, 1, 0.0), *faces_at(topology, 2, H / 1000)]
        if next(x for x in topology.faces if x.tag == f).centroid[0] < L1M
    ]
    setup = bonded_spec(
        base,
        bonds,
        second,
        [{**fixed(walls[0], HOT), "faces": walls}, fixed(cold, COLD)],
    )
    _, result = solve(setup, mesh, root / f"bonded-p{order}-walls")
    out.append(
        (
            "two bonded bodies, fixed temperature next to the bond | heat balance",
            result.heat_balance.ratio,
            BALANCE,
            "",
        )
    )
    return out


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
    bottom, top = bottom_top_faces(topology)

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
        # M5.4: thermal stress on each linear profile (the first four cases).
        for k, case in enumerate(scenarios(hot, cold)[:4]):
            setup = stress_spec(case.loads, [hot, low, high, bottom, top])
            fields, result = solve(setup, mesh, root / f"stress-p{order}-{k}")
            for what, value, allowed, unit in stress_checks(case, mesh, fields, result, order):
                ok = value <= allowed
                failed |= not ok
                rows.append(
                    f"| {label} | thermal stress, {case.name} | {what} | {value:.3g} {unit} | "
                    f"{allowed:g} | {'ok' if ok else 'off'} |"
                )
        # M5.5: the conductivity table. The flux is the same everywhere, k_integral(HOT_K) / L.
        fields, result = solve(table_spec(hot, cold), mesh, root / f"table-p{order}")
        flux = k_integral(HOT_K) / LM
        q = fields.heat_flux
        got = [f.heat for f in result.heat_flows or []]
        assert result.heat_balance is not None
        checks = [
            (
                "temperature",
                max(
                    abs(fields.temperature[n] - table_profile(p[3 * n]))
                    for n in range(mesh.node_count)
                ),
                # The profile is not polynomial; four-node elements are linear across 10 mm.
                _pick((0.05, 0.005), order),
                "K",
            ),
            (
                "heat flux",
                max(
                    max(abs(q[3 * n] - flux), abs(q[3 * n + 1]), abs(q[3 * n + 2]))
                    for n in range(mesh.node_count)
                )
                / flux,
                _pick((0.01, 1e-3), order),
                "of the largest",
            ),
            (
                "heat flow of each load",
                max(abs(a - b) for a, b in zip(got, [flux * AREA, -flux * AREA], strict=True))
                / (flux * AREA),
                1e-3,
                "of the largest",
            ),
            ("heat balance", result.heat_balance.ratio, BALANCE, ""),
        ]
        for what, value, allowed, unit in checks:
            ok = value <= allowed
            failed |= not ok
            rows.append(
                f"| {label} | conductivity table, fixed temperatures | {what} | {value:.3g} "
                f"{unit} | {allowed:g} | {'ok' if ok else 'off'} |"
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
        for what, value, allowed, unit in bonded_checks(root, order):
            ok = value <= allowed
            failed |= not ok
            rows.append(
                f"| {label} | {what} | {value:.3g} {unit} | {allowed:g} | {'ok' if ok else 'off'} |"
            )
    print("| Element | Loads | Check | Largest error | Allowed | Result |")
    print("| --- | --- | --- | --- | --- | --- |")
    print("\n".join(rows))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
