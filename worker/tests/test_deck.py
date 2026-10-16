# SPDX-License-Identifier: AGPL-3.0-or-later
"""The deck generator: element mapping, deck snapshots and refusals (no solver runs).

Snapshots live in tests/snapshots/deck/. A missing snapshot is written when the test runs
with CLEARFEA_WRITE_SNAPSHOTS=1; an existing one is never overwritten. To change one, delete
it and explain in the pull request why the new deck is correct (docs/VERIFICATION.md).
"""

import copy
import json
import math
import os
import re
from pathlib import Path

import pytest

from clearfea_worker.deck import DeckError, generate_deck
from clearfea_worker.deck.elements import (
    CCX_EDGES,
    CCX_FACE_NUMBER,
    CCX_FACES,
    CCX_NODE_ORDER,
    FACE_NODES,
)
from clearfea_worker.deck.generator import FIELD_WIDTH
from clearfea_worker.deck.loads import fixed_support_nodes
from clearfea_worker.meshing.volume import NODES_PER_ELEMENT, TET_FACES, VolumeMesh
from clearfea_worker.spec.simulation_schema import SimulationSpec

from .deck_meshes import GMSH_EDGES, bonded_tets, two_tets
from .test_ties import bonded_spec

FIXTURE = Path(__file__).resolve().parents[2] / "packages" / "spec" / "fixtures"
SNAPSHOTS = Path(__file__).resolve().parent / "snapshots" / "deck"


def fixture_spec() -> dict:
    return json.loads((FIXTURE / "simulation-v1.json").read_text())


def two_body_spec() -> dict:
    """Two bodies of different materials in US units, two supports, overlapping pressures."""
    return {
        "version": 1,
        "analysis": "linear_static",
        "geometryId": "00000000-0000-4000-8000-000000000002",
        "bodies": [{"tag": 2, "material": "alu"}, {"tag": 1, "material": "steel"}],
        "materials": [
            {
                "id": "unused",
                "name": "Not assigned",
                "model": "isotropic_elastic",
                "youngsModulus": None,
                "poissonsRatio": None,
            },
            {
                "id": "steel",
                "name": "Steel\n(US units)",
                "model": "isotropic_elastic",
                "youngsModulus": {"value": 29000, "unit": "ksi"},
                "poissonsRatio": 0.29,
            },
            {
                "id": "alu",
                "name": "Aluminium",
                "model": "isotropic_elastic",
                "youngsModulus": {"value": 69, "unit": "GPa"},
                "poissonsRatio": 0.33,
            },
        ],
        "supports": [
            {"id": "fixed-1", "type": "fixed", "name": "Base", "faces": [1]},
            {"id": "fixed-2", "type": "fixed", "name": "Side", "faces": [4]},
        ],
        "loads": [
            {
                "id": "pressure-1",
                "type": "pressure",
                "name": "Inside",
                "faces": [2, 3],
                "magnitude": {"value": 150, "unit": "psi"},
            },
            {
                "id": "pressure-2",
                "type": "pressure",
                "name": "Suction",
                "faces": [3],
                "magnitude": {"value": -0.5, "unit": "MPa"},
            },
        ],
        "mesh": {"size": {"value": 0.25, "unit": "in"}},
    }


def supports_spec() -> dict:
    """The new supports of M2.2: two symmetry planes, a prescribed displacement in mixed
    units on a face that meets both, and a pressure."""
    spec = fixture_spec()
    spec["supports"] = [
        {"id": "sym", "type": "frictionless", "name": "Symmetry", "faces": [1, 2]},
        {
            "id": "move",
            "type": "displacement",
            "name": "Moved side",
            "faces": [4],
            "x": "free",
            "y": {"value": 0.1, "unit": "mm"},
            "z": "free",
        },
    ]
    spec["loads"] = [spec["loads"][0] | {"faces": [3]}]
    return spec


def loads_spec() -> dict:
    """The loads of M2.3 beside a pressure: a force on two faces in kN, gravity in g and a
    centrifugal load in rpm about a tilted axis, on a material with a density in lb/in³."""
    spec = fixture_spec()
    spec["materials"][0]["density"] = {"value": 0.284, "unit": "lb/in³"}
    spec["loads"] += [
        {
            "id": "force-1",
            "type": "force",
            "name": "Bolt load",
            "faces": [3, 4],
            "x": {"value": 1.5, "unit": "kN"},
            "y": {"value": 0, "unit": "kN"},
            "z": {"value": -250, "unit": "lbf"},
        },
        {
            "id": "gravity-1",
            "type": "gravity",
            "name": "Weight",
            "x": {"value": 0, "unit": "g"},
            "y": {"value": -1, "unit": "g"},
            "z": {"value": 0, "unit": "g"},
        },
        {
            "id": "gravity-2",
            "type": "gravity",
            "name": "Sideways",
            "x": {"value": 2, "unit": "m/s²"},
            "y": {"value": 0, "unit": "m/s²"},
            "z": {"value": 0, "unit": "m/s²"},
        },
        {
            "id": "spin-1",
            "type": "centrifugal",
            "name": "Spin",
            "angularVelocity": {"value": 3000, "unit": "rpm"},
            "axisPoint": {
                "x": {"value": 5, "unit": "mm"},
                "y": {"value": 0, "unit": "mm"},
                "z": {"value": 0, "unit": "mm"},
            },
            "axisDirection": {"x": 0, "y": 3, "z": 4},
        },
    ]
    return spec


def remote_spec() -> dict:
    """A remote force and moment on two faces (M2.4) beside the fixture's pressure: the point
    in inches off the faces, the force in kN and lbf, the moment in N·m, lbf·in and kN·m."""
    spec = fixture_spec()
    spec["loads"].append(
        {
            "id": "remote-1",
            "type": "remote",
            "name": "Pipe load",
            "faces": [3, 4],
            "point": {
                "x": {"value": 1, "unit": "in"},
                "y": {"value": 0.5, "unit": "in"},
                "z": {"value": -2, "unit": "in"},
            },
            "force": {
                "x": {"value": 2, "unit": "kN"},
                "y": {"value": -150, "unit": "lbf"},
                "z": {"value": 0, "unit": "kN"},
            },
            "moment": {
                "x": {"value": 15, "unit": "N·m"},
                "y": {"value": -80, "unit": "lbf·in"},
                "z": {"value": 0.02, "unit": "kN·m"},
            },
        }
    )
    return spec


def hydrostatic_spec() -> dict:
    """A hydrostatic pressure (M2.5) on two faces beside the fixture's pressure: water in
    g/cm³ under gravity along -y in ft/s², its free surface at y = 6 mm (given in cm and in),
    so it crosses the faces."""
    spec = fixture_spec()
    spec["loads"].append(
        {
            "id": "hydrostatic-1",
            "type": "hydrostatic",
            "name": "Water",
            "faces": [2, 3],
            "fluidDensity": {"value": 1, "unit": "g/cm³"},
            "gravity": {
                "x": {"value": 0, "unit": "g"},
                "y": {"value": -32.17404855643045, "unit": "ft/s²"},
                "z": {"value": 0, "unit": "m/s²"},
            },
            "freeSurface": {
                "x": {"value": 3, "unit": "in"},
                "y": {"value": 0.6, "unit": "cm"},
                "z": {"value": 0, "unit": "mm"},
            },
        }
    )
    return spec


def elastic_spec() -> dict:
    """An elastic support (M2.6) on face 4, two element faces that meet at an angle, in
    lbf/in³, beside the fixture's fixed face 1 and pressure on faces 2 and 3."""
    spec = fixture_spec()
    spec["supports"].append(
        {
            "id": "elastic-1",
            "type": "elastic",
            "name": "Foundation",
            "faces": [4],
            "stiffness": {"value": 500, "unit": "lbf/in³"},
        }
    )
    return spec


def elastic_sym_spec() -> dict:
    """Elastic supports on faces 2 (z = 0) and 3 with a symmetry plane on face 1 (x = 0) and
    no fixed face, so the deck holds nodes through groups and the springs alone stop the
    part sliding along y and z; a force on face 4 in N."""
    spec = fixture_spec()
    spec["supports"] = [
        {"id": "sym", "type": "frictionless", "name": "Symmetry", "faces": [1]},
        {
            "id": "base",
            "type": "elastic",
            "name": "Base",
            "faces": [2],
            "stiffness": {"value": 2000, "unit": "MN/m³"},
        },
        {
            "id": "slope",
            "type": "elastic",
            "name": "Slope",
            "faces": [3],
            "stiffness": {"value": 200000, "unit": "lbf/in³"},
        },
    ]
    spec["loads"] = [
        {
            "id": "force-1",
            "type": "force",
            "name": "Push",
            "faces": [4],
            "x": {"value": 10, "unit": "N"},
            "y": {"value": 100, "unit": "N"},
            "z": {"value": -50, "unit": "N"},
        }
    ]
    return spec


def thermal_spec() -> dict:
    """A temperature change of M2.7 in °F on two bodies whose materials expand differently,
    one coefficient per °F and one per °C, beside the two-body spec's pressures."""
    spec = two_body_spec()
    spec["materials"][0]["thermalExpansion"] = None  # not assigned, so not needed
    spec["materials"][1]["thermalExpansion"] = {"value": 6.5e-6, "unit": "1/°F"}
    spec["materials"][2]["thermalExpansion"] = {"value": 23e-6, "unit": "1/°C"}
    spec["loads"].append(
        {
            "id": "temperature-1",
            "type": "temperature",
            "name": "Cool down",
            "change": {"value": -90, "unit": "°F"},
        }
    )
    return spec


def heat_spec() -> dict:
    """A steady-state thermal analysis of M5.1 on the one-body mesh: face 1 held at 100 °C and
    face 3 at 212 °F, conductivity in US units, an unassigned material without one."""
    return {
        "version": 1,
        "analysis": "steady_thermal",
        "geometryId": "00000000-0000-4000-8000-000000000005",
        "bodies": [{"tag": 1, "material": "steel"}],
        "materials": [
            {
                "id": "unused",
                "name": "Not assigned",
                "model": "isotropic_elastic",
                "youngsModulus": None,
                "poissonsRatio": None,
            },
            {
                "id": "steel",
                "name": "Steel\n(US units)",
                "model": "isotropic_elastic",
                "youngsModulus": None,
                "poissonsRatio": None,
                "thermalConductivity": {"value": 26, "unit": "BTU/(h·ft·°F)"},
            },
        ],
        "supports": [],
        "loads": [
            {
                "id": "hot-1",
                "type": "fixed_temperature",
                "name": "Hot side",
                "faces": [1],
                "temperature": {"value": 100, "unit": "°C"},
            },
            {
                "id": "cold-1",
                "type": "fixed_temperature",
                "name": "Cold side",
                "faces": [3],
                "temperature": {"value": 373.15, "unit": "K"},
            },
        ],
        "mesh": {"size": {"value": 5, "unit": "mm"}},
    }


def heat_loads_spec() -> dict:
    """heat_spec with every load of M5.2 (ADR-065), each in a unit other than SI: face 1 held at
    100 °C, 2 W/cm² (as 20 kW/m²) and 0.5 W/cm² into face 2 (they add up), convection from
    face 3 at 5 BTU/(h·ft²·°F) to 68 °F, radiation from face 4 with emissivity 0.8 to 300 K,
    and 1 W/cm³ (as 1000 kW/m³) generated in body 1."""
    spec = heat_spec()
    spec["loads"] = [
        spec["loads"][0],
        {
            "id": "q-1",
            "type": "heat_flux",
            "name": "Heater",
            "faces": [2],
            "flux": {"value": 20, "unit": "kW/m²"},
        },
        {
            "id": "q-2",
            "type": "heat_flux",
            "name": "Second heater",
            "faces": [2],
            "flux": {"value": 0.005, "unit": "W/mm²"},
        },
        {
            "id": "h-1",
            "type": "convection",
            "name": "Air",
            "faces": [3],
            "coefficient": {"value": 5, "unit": "BTU/(h·ft²·°F)"},
            "ambientTemperature": {"value": 68, "unit": "°F"},
        },
        {
            "id": "r-1",
            "type": "radiation",
            "name": "Sky",
            "faces": [4],
            "emissivity": 0.8,
            "ambientTemperature": {"value": 300, "unit": "K"},
        },
        {
            "id": "g-1",
            "type": "heat_generation",
            "name": "Coil",
            "bodies": [1],
            "power": {"value": 1000, "unit": "kW/m³"},
        },
    ]
    return spec


def heat_two_bodies_spec() -> dict:
    """heat_spec on the bonded mesh with its bond removed, a material per body (the second in
    W/(mm·K)), and each body's own fixed temperature: 100 °C under body 1 and 68 °F on top of
    body 2 (bodies share no nodes, so the two may differ)."""
    spec = heat_spec()
    spec["bodies"] = [{"tag": 1, "material": "steel"}, {"tag": 2, "material": "copper"}]
    spec["bonds"] = [{"faces": [1, 3], "status": "removed"}]
    spec["loads"][0]["faces"] = [2]
    spec["loads"][1] |= {"faces": [6], "temperature": {"value": 68, "unit": "°F"}}
    spec["materials"].append(
        {
            "id": "copper",
            "name": "Copper",
            "model": "isotropic_elastic",
            "youngsModulus": {"value": 117, "unit": "GPa"},
            "poissonsRatio": 0.34,
            "thermalConductivity": {"value": 0.39, "unit": "W/(mm·K)"},
        }
    )
    return spec


def two_body_loads_spec() -> dict:
    return loads_spec() | {
        "bodies": [{"tag": 1, "material": "steel"}, {"tag": 2, "material": "steel"}]
    }


def turned(mesh: VolumeMesh, degrees: float = 30.0) -> VolumeMesh:
    """``mesh`` turned about the z axis, so faces 1 (x = 0) and 4 lean."""
    c, s = math.cos(math.radians(degrees)), math.sin(math.radians(degrees))
    p = list(mesh.positions)
    for n in range(len(p) // 3):
        x, y = p[3 * n], p[3 * n + 1]
        p[3 * n], p[3 * n + 1] = c * x - s * y, s * x + c * y
    return VolumeMesh(mesh.order, p, mesh.elements, mesh.bodies, mesh.faces)


def bonded_slide_spec() -> dict:
    """bonded_tets with a frictionless support on a sloping face through the bond (M4.3)."""
    spec = bonded_spec().model_dump(by_alias=True)
    spec["supports"].append({"id": "slide-1", "type": "frictionless", "name": "Side", "faces": [4]})
    return spec


def deck(spec: dict, mesh: VolumeMesh) -> str:
    return generate_deck(SimulationSpec.model_validate(spec), mesh)


# --- Element mapping, checked geometrically against the CalculiX manual's numbering ---


def test_calculix_node_order_swaps_gmsh_last_two_mid_edge_nodes() -> None:
    assert CCX_NODE_ORDER[1] == (0, 1, 2, 3)
    assert CCX_NODE_ORDER[2] == (0, 1, 2, 3, 4, 5, 6, 7, 9, 8)


def test_each_calculix_mid_edge_node_lies_on_its_calculix_edge() -> None:
    mesh = two_tets(order=2)
    for e in range(mesh.element_count):
        gmsh = mesh.elements[e * 10 : (e + 1) * 10]
        ccx = [gmsh[k] for k in CCX_NODE_ORDER[2]]
        for k, (a, b) in enumerate(CCX_EDGES):
            mid = [
                (mesh.positions[3 * ccx[a] + i] + mesh.positions[3 * ccx[b] + i]) / 2
                for i in range(3)
            ]
            assert mesh.positions[3 * ccx[4 + k] : 3 * ccx[4 + k] + 3] == pytest.approx(mid)


def test_gmsh_local_faces_map_to_calculix_faces_with_the_same_corners() -> None:
    assert CCX_FACE_NUMBER == (1, 2, 4, 3)
    for local, corners in enumerate(TET_FACES):
        assert set(CCX_FACES[CCX_FACE_NUMBER[local] - 1]) == set(corners)


def test_face_nodes_are_the_corners_and_the_mid_edge_nodes_between_them() -> None:
    assert FACE_NODES[1] == TET_FACES
    for corners, nodes in zip(TET_FACES, FACE_NODES[2], strict=True):
        assert nodes[:3] == corners
        assert {frozenset(GMSH_EDGES[n - 4]) for n in nodes[3:]} == {
            frozenset(e)
            for e in ((corners[0], corners[1]), (corners[1], corners[2]), (corners[0], corners[2]))
        }


# --- Snapshots ---


SNAPSHOT_CASES = {
    "fixture-c3d10": (fixture_spec, lambda: two_tets(order=2)),
    "fixture-c3d4": (fixture_spec, lambda: two_tets(order=1)),
    "two-bodies-c3d10": (two_body_spec, lambda: two_tets(order=2, bodies=2)),
    "supports-c3d10": (supports_spec, lambda: two_tets(order=2)),
    "supports-turned-c3d4": (supports_spec, lambda: turned(two_tets(order=1))),
    "loads-c3d10": (loads_spec, lambda: two_tets(order=2)),
    "loads-two-bodies-c3d4": (two_body_loads_spec, lambda: two_tets(order=1, bodies=2)),
    "remote-c3d10": (remote_spec, lambda: two_tets(order=2)),
    "hydrostatic-c3d10": (hydrostatic_spec, lambda: two_tets(order=2)),
    "elastic-c3d10": (elastic_spec, lambda: two_tets(order=2)),
    "elastic-sym-c3d10": (elastic_sym_spec, lambda: two_tets(order=2)),
    "elastic-sym-c3d4": (elastic_sym_spec, lambda: two_tets(order=1)),
    "thermal-two-bodies-c3d10": (thermal_spec, lambda: two_tets(order=2, bodies=2)),
    "bonded-c3d10": (lambda: bonded_spec().model_dump(by_alias=True), lambda: bonded_tets(2)),
    "bonded-slide-c3d4": (bonded_slide_spec, lambda: bonded_tets(1)),
    "heat-c3d10": (heat_spec, lambda: two_tets(order=2)),
    "heat-two-bodies-c3d4": (heat_two_bodies_spec, lambda: bonded_tets(1)),
    "heat-loads-c3d10": (heat_loads_spec, lambda: two_tets(order=2)),
}


@pytest.mark.parametrize("name", sorted(SNAPSHOT_CASES))
def test_deck_matches_snapshot(name: str) -> None:
    make_spec, make_mesh = SNAPSHOT_CASES[name]
    text = deck(make_spec(), make_mesh())
    path = SNAPSHOTS / f"{name}.inp"
    if not path.exists():
        if os.environ.get("CLEARFEA_WRITE_SNAPSHOTS") == "1":
            path.write_text(text)
        pytest.fail(f"No snapshot {path.name}. Review the deck, then commit it as the snapshot.")
    assert text == path.read_text()


def test_deck_converts_entered_values_to_si() -> None:
    text = deck(two_body_spec(), two_tets(order=2, bodies=2))
    # 29000 ksi and 69 GPa, in pascals.
    assert "199947961501.88248, 0.29" in text
    assert "69000000000.0, 0.33" in text
    # Face 2 carries 150 psi; face 3 carries 150 psi and -0.5 MPa added together.
    assert ", P1, 1034213.5939752542\n" in text
    assert f", P{CCX_FACE_NUMBER[1]}, {1034213.5939752542 - 500000.0!r}\n" in text


@pytest.mark.parametrize(
    "value",
    [-1.2587888216013468e-16, 1.234567890123456e-16, 1.2345678901234567e-06, -0.012345678901234567],
)
def test_long_numbers_are_shortened_to_what_calculix_reads(value: float) -> None:
    # CalculiX reads 20 characters of a number and drops the rest without a word, so
    # 1.234567890123456e-16 would become 0.1234... (V-01 hit this on a node at x = 1e-16).
    mesh = two_tets(order=2)
    mesh.positions[0] = value
    text = deck(fixture_spec(), mesh)
    first = next(line for line in text.splitlines() if line.startswith("1, "))
    written = first.split(", ")[1]
    assert len(written) <= FIELD_WIDTH
    assert abs(float(written) - value) <= 1e-12 * abs(value)


def test_every_number_in_a_deck_fits_calculix_fields() -> None:
    text = deck(two_body_spec(), two_tets(order=2, bodies=2))
    for line in text.splitlines():
        if line.startswith("*") or not line[:1].isdigit():
            continue
        for field in line.split(","):
            assert len(field.strip()) <= FIELD_WIDTH, line


def test_deck_is_the_same_every_time() -> None:
    mesh = two_tets(order=2)
    assert deck(fixture_spec(), mesh) == deck(fixture_spec(), mesh)


def test_support_set_holds_corner_and_mid_edge_nodes_of_its_faces() -> None:
    mesh = two_tets(order=2)
    text = deck(fixture_spec(), mesh)
    nset = text.split("*NSET, NSET=S1\n")[1].split("\n")[0]
    element, local = mesh.faces[1][0]
    expected = sorted(mesh.elements[element * 10 + k] + 1 for k in FACE_NODES[2][local])
    assert [int(n) for n in nset.split(", ")] == expected


# --- Refusals ---


def broken(change) -> dict:  # type: ignore[no-untyped-def]
    spec = copy.deepcopy(fixture_spec())
    change(spec)
    return spec


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda s: s.update(supports=[]), "no supports"),
        (lambda s: s["supports"][0].update(faces=[]), "has no faces"),
        (lambda s: s["loads"][0].update(faces=[2, 2]), "more than once"),
        (lambda s: s["loads"][0].update(faces=[2, 9]), "faces [9], which the mesh"),
        (lambda s: s["loads"][0].update(magnitude=None), "magnitude has no value"),
        (lambda s: s["loads"][0].update(magnitude={"value": 1, "unit": "mm"}), "not a pressure"),
        (lambda s: s["materials"][0].update(youngsModulus=None), "Young's modulus has no value"),
        (lambda s: s["materials"][0].update(youngsModulus={"value": 0, "unit": "GPa"}), "greater"),
        (lambda s: s["materials"][0].update(poissonsRatio=None), "Poisson's ratio has no value"),
        (lambda s: s["bodies"][0].update(material=None), "Body 1 has no material"),
        (lambda s: s["bodies"][0].update(material="brass"), "'brass', which is not"),
        (lambda s: s["bodies"].append({"tag": 7, "material": "steel"}), "bodies [7]"),
        (lambda s: s.update(bodies=[]), "Body 1 has no material"),
        (
            lambda s: s["supports"].append(
                {
                    "id": "d",
                    "type": "displacement",
                    "name": "D",
                    "faces": [2],
                    "x": "free",
                    "y": "free",
                    "z": "free",
                }
            ),
            "leaves every component free",
        ),
        (
            lambda s: s["supports"].append(
                {
                    "id": "d",
                    "type": "displacement",
                    "name": "D",
                    "faces": [2],
                    "x": None,
                    "y": "free",
                    "z": "free",
                }
            ),
            "the x component has no value",
        ),
        (
            lambda s: s["supports"].append(
                {
                    "id": "d",
                    "type": "displacement",
                    "name": "D",
                    "faces": [2],
                    "x": {"value": 1, "unit": "MPa"},
                    "y": "free",
                    "z": "free",
                }
            ),
            "not a length",
        ),
        (
            lambda s: s["supports"].append(
                {"id": "f", "type": "frictionless", "name": "F", "faces": [3]}
            ),
            "face 3 is not flat",
        ),
        (
            lambda s: s.update(
                supports=[{"id": "f", "type": "frictionless", "name": "F", "faces": [1]}]
            ),
            "slide along y, slide along z and turn about the x axis",
        ),
        (
            lambda s: s["supports"].append(
                {
                    "id": "d",
                    "type": "displacement",
                    "name": "D",
                    "faces": [2],
                    "x": "free",
                    "y": "free",
                    "z": {"value": 1, "unit": "mm"},
                }
            ),
            'The fixed support "Fixed support 1" and the prescribed displacement "D" meet',
        ),
    ],
)
def test_refuses_a_spec_it_cannot_translate(change, message: str) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(DeckError, match=None) as error:
        deck(broken(change), two_tets(order=2))
    assert message in str(error.value)


def body_load_spec(change) -> dict:  # type: ignore[no-untyped-def]
    spec = loads_spec()
    change(spec)
    return spec


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda s: s["materials"][0].pop("density"), 'Material "Structural steel" has no density'),
        (
            lambda s: s["materials"][0].update(density={"value": 0, "unit": "kg/m³"}),
            "density must be greater than zero",
        ),
        (lambda s: s["materials"][0].update(density={"value": 1, "unit": "g"}), "not a density"),
        (lambda s: s["loads"].append(s["loads"][4] | {"id": "spin-2"}), "is a second one"),
        (
            lambda s: s["loads"][4].update(axisDirection={"x": 0, "y": 0, "z": 0}),
            "the axis direction is zero",
        ),
        (
            lambda s: s["loads"][4].update(axisDirection={"x": 0, "y": None, "z": 1}),
            "the y component of the axis direction has no value",
        ),
        (lambda s: s["loads"][4].update(angularVelocity=None), "angular velocity has no value"),
        (
            lambda s: s["loads"][4]["axisPoint"].update(z={"value": 1, "unit": "rpm"}),
            "not a length",
        ),
        (lambda s: s["loads"][2].update(z=None), 'Gravity "Weight": z component has no value'),
        (
            lambda s: s["loads"][2].update(z={"value": 1, "unit": "N"}),
            "not an acceleration unit",
        ),
        (lambda s: s["loads"][1].update(faces=[]), "Bolt load has no faces"),
        (lambda s: s["loads"][1].update(x=None), 'Force "Bolt load": x component has no value'),
        (lambda s: s["loads"][1].update(y={"value": 1, "unit": "MPa"}), "not a force"),
    ],
)
def test_refuses_body_loads_and_forces_it_cannot_translate(change, message: str) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(DeckError) as error:
        deck(body_load_spec(change), two_tets(order=2))
    assert message in str(error.value)


def test_gravity_loads_add_up_into_one_line_per_body() -> None:
    text = deck(two_body_loads_spec(), two_tets(order=1, bodies=2))
    grav = [line for line in text.splitlines() if ", GRAV, " in line]
    assert [line.split(",")[0] for line in grav] == ["B1", "B2"]
    size, *direction = (float(v) for v in grav[0].split(", ")[2:])
    g = (2.0, -9.80665, 0.0)
    assert size == pytest.approx(math.hypot(*g), rel=1e-15)
    assert direction == pytest.approx([c / math.hypot(*g) for c in g], rel=1e-15)
    (spin,) = [line for line in text.splitlines() if line.startswith("B1, CENTRIF")]
    omega = 3000 * 2 * math.pi / 60
    values = [float(v) for v in spin.split(", ")[2:]]
    assert values == pytest.approx([omega**2, 0.005, 0, 0, 0, 0.6, 0.8], rel=1e-15)


def test_force_cloads_add_up_to_the_entered_force() -> None:
    text = deck(loads_spec(), two_tets(order=2))
    lines = text.split("*CLOAD\n")[1].split("*")[0].strip().splitlines()
    total = [0.0, 0.0, 0.0]
    for line in lines:
        _, dof, value = line.split(", ")
        total[int(dof) - 1] += float(value)
    assert total == pytest.approx([1500.0, 0.0, -250 * 4.4482216152605], rel=1e-12)


def remote_load_spec(change) -> dict:  # type: ignore[no-untyped-def]
    spec = remote_spec()
    change(spec["loads"][1])
    return spec


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda r: r.update(faces=[]), "Pipe load has no faces"),
        (lambda r: r.update(faces=[3, 9]), "uses faces [9], which the mesh does not have"),
        (
            lambda r: r["point"].update(y=None),
            'Remote load "Pipe load": y component of its reference point has no value',
        ),
        (
            lambda r: r["force"].update(z=None),
            'Remote load "Pipe load": z component of its force has no value',
        ),
        (
            lambda r: r["moment"].update(x=None),
            'Remote load "Pipe load": x component of its moment has no value',
        ),
        (lambda r: r["moment"].update(x={"value": 1, "unit": "N"}), "not a moment"),
        (lambda r: r["force"].update(x={"value": 1, "unit": "N·m"}), "not a force"),
        (lambda r: r["point"].update(x={"value": 1, "unit": "N"}), "not a length"),
    ],
)
def test_refuses_remote_loads_it_cannot_translate(change, message: str) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(DeckError) as error:
        deck(remote_load_spec(change), two_tets(order=2))
    assert message in str(error.value)


def test_remote_cloads_add_up_to_the_force_with_the_moment_about_the_point() -> None:
    mesh = two_tets(order=2)
    text = deck(remote_spec(), mesh)
    lines = text.split("*CLOAD\n")[1].split("*")[0].strip().splitlines()
    forces: dict[int, list[float]] = {}
    for line in lines:
        node, dof, value = line.split(", ")
        forces.setdefault(int(node) - 1, [0.0, 0.0, 0.0])[int(dof) - 1] += float(value)
    lbf, inch = 4.4482216152605, 0.0254
    f = [2000.0, -150 * lbf, 0.0]
    m = [15.0, -80 * lbf * inch, 20.0]
    point = [inch, 0.5 * inch, -2 * inch]
    total = [sum(v[i] for v in forces.values()) for i in range(3)]
    assert total == pytest.approx(f, rel=1e-12)
    moment = [0.0, 0.0, 0.0]
    p = mesh.positions
    for node, v in forces.items():
        r = [p[3 * node + i] - point[i] for i in range(3)]
        moment[0] += r[1] * v[2] - r[2] * v[1]
        moment[1] += r[2] * v[0] - r[0] * v[2]
        moment[2] += r[0] * v[1] - r[1] * v[0]
    assert moment == pytest.approx(m, rel=1e-12)


def hydrostatic_load_spec(change) -> dict:  # type: ignore[no-untyped-def]
    spec = hydrostatic_spec()
    change(spec["loads"][1])
    return spec


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda h: h.update(faces=[]), "Water has no faces"),
        (lambda h: h.update(faces=[3, 9]), "uses faces [9], which the mesh does not have"),
        (
            lambda h: h.update(fluidDensity=None),
            'Hydrostatic pressure "Water": fluid density has no value',
        ),
        (
            lambda h: h.update(fluidDensity={"value": 0, "unit": "kg/m³"}),
            "the fluid density must be greater than zero",
        ),
        (lambda h: h.update(fluidDensity={"value": 1, "unit": "Pa"}), "not a density"),
        (
            lambda h: h["gravity"].update(y=None),
            'Hydrostatic pressure "Water": y component of its gravity has no value',
        ),
        (lambda h: h["gravity"].update(x={"value": 1, "unit": "m"}), "not an acceleration"),
        (
            lambda h: h["gravity"].update(y={"value": 0, "unit": "g"}),
            "gravity is zero, so the fluid has no depth",
        ),
        (
            lambda h: h["freeSurface"].update(z=None),
            'Hydrostatic pressure "Water": z component of its free-surface point has no value',
        ),
        (
            lambda h: h["freeSurface"].update(y={"value": -1, "unit": "mm"}),
            "its faces are all above the free surface",
        ),
        (
            lambda h: (
                h["gravity"].update(y={"value": 1, "unit": "g"}),
                h["freeSurface"].update(y={"value": 2, "unit": "cm"}),
            ),
            "its faces are all above the free surface",
        ),
    ],
)
def test_refuses_hydrostatic_loads_it_cannot_translate(change, message: str) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(DeckError) as error:
        deck(hydrostatic_load_spec(change), two_tets(order=2))
    assert message in str(error.value)


def test_refuses_a_mesh_with_nodes_outside_every_element() -> None:
    mesh = two_tets(order=1)
    extra = VolumeMesh(1, [*mesh.positions, 1.0, 1.0, 1.0], mesh.elements, mesh.bodies, mesh.faces)
    with pytest.raises(DeckError, match="1 nodes that belong to no element"):
        deck(fixture_spec(), extra)


def test_nodes_per_element_matches_element_types() -> None:
    assert set(NODES_PER_ELEMENT) == set(CCX_NODE_ORDER)


# --- Prescribed displacement and frictionless support (M2.2, ADR-039) ---


def test_fixed_only_setups_keep_the_m1_holds_and_print_reactions_per_node() -> None:
    text = deck(fixture_spec(), two_tets(order=2))
    assert "*BOUNDARY\nS1, 1, 3\n" in text
    assert "*TRANSFORM," not in text and "TOTALS=ONLY" not in text
    # Per node, for reaction moments and nodes shared between supports (M3.2).
    assert "*NODE PRINT, NSET=RALL, GLOBAL=YES\nRF\n" in text


def test_axis_aligned_planes_and_components_need_no_transform() -> None:
    text = deck(supports_spec(), two_tets(order=2))
    assert "*TRANSFORM," not in text
    assert "*NODE PRINT, NSET=RALL, GLOBAL=YES\nRF\n" in text
    assert "TOTALS=ONLY" not in text
    # 0.1 mm along y, in metres, on the moved face's nodes.
    assert ", 2, 2, 0.0001\n" in text


def test_inclined_plane_gets_its_own_axes() -> None:
    text = deck(supports_spec(), turned(two_tets(order=1)))
    assert "*TRANSFORM, NSET=C" in text
    # Face 1's outward normal, -x turned by 30 degrees about z.
    assert "1: (-0.8660254037844387, -0.5, 0.0)" in text


def test_every_held_node_is_in_the_reaction_set_and_in_one_group() -> None:
    text = deck(supports_spec(), turned(two_tets(order=2)))
    sets: dict[str, list[int]] = {}
    name = None
    for line in text.splitlines():
        if line.startswith("*NSET, NSET="):
            name = line.split("=")[1]
            sets[name] = []
        elif line.startswith("*"):
            name = None
        elif name is not None:
            sets[name].extend(int(n) for n in line.split(", "))
    groups = [nodes for name, nodes in sets.items() if name.startswith("C")]
    grouped = [n for nodes in groups for n in nodes]
    assert len(grouped) == len(set(grouped))
    assert sorted(grouped) == sets["RALL"]
    assert set(sets["RALL"]) == set(sets["S1"]) | set(sets["S2"])


# --- Elastic support (M2.6, ADR-043) ---


def test_elastic_springs_lie_along_the_normal_and_add_up_to_stiffness_times_area() -> None:
    from clearfea_worker.deck.loads import elastic_springs
    from clearfea_worker.spec.simulation_schema import ElasticSupport

    for order in (1, 2):
        mesh = two_tets(order=order)
        support = ElasticSupport.model_validate(elastic_sym_spec()["supports"][1])
        springs = elastic_springs(mesh, support)
        # Face 2 is the triangle A B C at z = 0, area 50 mm², at 2000 MN/m³.
        assert sum(s.stiffness for s in springs) == pytest.approx(2e9 * 5e-5, rel=1e-12)
        assert {s.direction for s in springs} == {(0.0, 0.0, -1.0)}
        # A flat six-node triangle's corners have no share of the area, so no spring.
        assert len(springs) == 3


def test_a_node_on_two_faces_of_an_elastic_support_gets_a_spring_for_each() -> None:
    from clearfea_worker.deck.loads import elastic_springs
    from clearfea_worker.spec.simulation_schema import ElasticSupport

    support = ElasticSupport.model_validate(elastic_sym_spec()["supports"][1] | {"faces": [2, 1]})
    springs = elastic_springs(two_tets(order=1), support)
    # A and C are on both faces; B is only on face 2 and D only on face 1.
    at = {}
    for s in springs:
        at.setdefault(s.node, []).append(s.direction)
    assert at[0] == [(0.0, 0.0, -1.0), (-1.0, 0.0, 0.0)]
    assert at[1] == [(0.0, 0.0, -1.0)]
    assert at[3] == [(-1.0, 0.0, 0.0)]


def test_elastic_springs_are_spring1_elements_along_the_normals() -> None:
    text = deck(elastic_sym_spec(), two_tets(order=2))
    # 2000 MN/m³ = 2e9 N/m³; a third of face 2's 50 mm² on each mid-edge node, along z.
    assert "foundation stiffness 2000.0 MN/m³ = 2000000000.0 N/m^3" in text
    assert "*SPRING, ELSET=K1\n3\n33333.33333333" in text
    # Face 3 leans, so its springs act along local direction 1 of an orientation.
    assert "*ORIENTATION, NAME=O1, SYSTEM=RECTANGULAR\n0.5773502691896" in text
    assert ", ORIENTATION=O1\n1\n" in text
    assert "*NODE PRINT, NSET=S2, GLOBAL=YES\nU\n" in text
    # No extra nodes: the result file holds the mesh's nodes only.
    assert "*NODE FILE\nU\n*EL FILE\nS, E\n" in text
    assert text.count("*NODE,") == 1


def test_elastic_support_beside_a_fixed_one_prints_the_fixed_nodes_reactions() -> None:
    text = deck(elastic_spec(), two_tets(order=2))
    assert "*NODE PRINT, NSET=RALL, GLOBAL=YES\nRF\n" in text
    assert "*NODE PRINT, NSET=S2, GLOBAL=YES\nU\n" in text
    assert "TOTALS=ONLY" not in text


def elastic_support_spec(change) -> dict:  # type: ignore[no-untyped-def]
    spec = elastic_sym_spec()
    change(spec["supports"][1])
    return spec


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda s: s.update(faces=[]), "Base has no faces"),
        (
            lambda s: s.update(stiffness=None),
            'Elastic support "Base": foundation stiffness has no value',
        ),
        (
            lambda s: s.update(stiffness={"value": 0, "unit": "N/m³"}),
            "the foundation stiffness must be greater than zero",
        ),
        (
            lambda s: s.update(stiffness={"value": 1, "unit": "Pa"}),
            "'Pa' is not a foundation stiffness unit",
        ),
    ],
)
def test_refuses_elastic_supports_it_cannot_translate(change, message: str) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(DeckError) as error:
        deck(elastic_support_spec(change), two_tets(order=2))
    assert message in str(error.value)


def test_an_elastic_support_on_one_flat_face_leaves_the_part_free_to_slide() -> None:
    spec = elastic_sym_spec()
    spec["supports"] = [spec["supports"][1]]
    with pytest.raises(DeckError) as error:
        deck(spec, two_tets(order=2))
    assert "slide along x, slide along y and turn about the z axis" in str(error.value)


# --- Uniform temperature change (M2.7) ---


def test_temperature_change_starts_every_node_at_zero_and_ends_at_the_change() -> None:
    text = deck(thermal_spec(), two_tets(order=2, bodies=2))
    lines = text.splitlines()
    start = lines.index("*INITIAL CONDITIONS, TYPE=TEMPERATURE")
    assert lines[start + 1] == "NALL, 0.0"
    assert start < lines.index("*STEP")
    end = lines.index("*TEMPERATURE")
    assert lines.index("*STEP") < end < lines.index("*END STEP")
    # -90 °F is a change of -50 K.
    assert float(lines[end + 1].split(", ")[1]) == pytest.approx(-50.0, rel=1e-15)


def test_each_used_material_gets_its_expansion_in_per_kelvin() -> None:
    text = deck(thermal_spec(), two_tets(order=2, bodies=2))
    expansion = text.split("*EXPANSION\n")
    assert len(expansion) == 3  # steel and aluminium; the unassigned material has none
    values = [float(part.splitlines()[0]) for part in expansion[1:]]
    assert values == pytest.approx([6.5e-6 * 1.8, 23e-6], rel=1e-15)
    assert "*MATERIAL, NAME=M1" not in text


def test_expansion_is_left_out_without_a_temperature_change() -> None:
    spec = thermal_spec()
    spec["loads"].pop()
    text = deck(spec, two_tets(order=2, bodies=2))
    assert text == deck(two_body_spec(), two_tets(order=2, bodies=2))
    assert "EXPANSION" not in text and "TEMPERATURE" not in text


def thermal_load_spec(change) -> dict:  # type: ignore[no-untyped-def]
    spec = thermal_spec()
    change(spec)
    return spec


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (
            lambda s: s["loads"][2].update(change=None),
            "Cool down: temperature change has no value",
        ),
        (
            lambda s: s["loads"][2].update(change={"value": 1, "unit": "1/°C"}),
            "not a temperature difference unit",
        ),
        (
            lambda s: s["materials"][2].update(thermalExpansion=None),
            'Material "Aluminium" has no thermal expansion',
        ),
        (
            lambda s: s["materials"][1].pop("thermalExpansion"),
            'Material "Steel\n(US units)" has no thermal expansion',
        ),
        (
            lambda s: s["materials"][1].update(thermalExpansion={"value": 1, "unit": "°C"}),
            "not a thermal expansion unit",
        ),
        (
            lambda s: s["loads"].append(s["loads"][2] | {"id": "t2", "name": "Again"}),
            '"Again" is a second one',
        ),
    ],
)
def test_refuses_temperature_changes_it_cannot_translate(change, message: str) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(DeckError, match=re.escape(message)):
        deck(thermal_load_spec(change), two_tets(order=2, bodies=2))


# --- Equation solver name (M2.11, ADR-048; ADR-063) ---


def test_a_spec_without_a_solver_is_solved_with_pastix() -> None:
    """Specs saved before ADR-063 name no solver; the deck still names one."""
    lines = deck(fixture_spec(), two_tets(order=2)).splitlines()
    assert "*STATIC, SOLVER=PASTIX" in lines
    assert "*STATIC" not in lines


@pytest.mark.parametrize(
    ("solver", "name"),
    [
        ("pastix", "PASTIX"),
        ("spooles", "SPOOLES"),
        ("iterative_cholesky", "ITERATIVE CHOLESKY"),
        ("iterative_scaling", "ITERATIVE SCALING"),
    ],
)
def test_the_spec_solver_goes_on_the_static_line_and_nothing_else_changes(
    solver: str, name: str
) -> None:
    mesh = two_tets(order=2)
    chosen = generate_deck(
        SimulationSpec.model_validate({**fixture_spec(), "solver": solver}), mesh
    ).splitlines()
    default = generate_deck(SimulationSpec.model_validate(fixture_spec()), mesh).splitlines()
    static = default.index("*STATIC, SOLVER=PASTIX")
    assert [k for k, (a, b) in enumerate(zip(chosen, default, strict=True)) if a != b] == (
        [] if solver == "pastix" else [static]
    )
    assert chosen[static] == f"*STATIC, SOLVER={name}"


def test_the_benchmark_can_name_a_solver_over_the_spec() -> None:
    spec = SimulationSpec.model_validate({**fixture_spec(), "solver": "spooles"})
    lines = generate_deck(spec, two_tets(order=2), solver="ITERATIVE CHOLESKY").splitlines()
    assert "*STATIC, SOLVER=ITERATIVE CHOLESKY" in lines


def test_refuses_an_unknown_solver_name() -> None:
    with pytest.raises(DeckError, match="Unknown equation solver 'PARDISO'"):
        generate_deck(
            SimulationSpec.model_validate(fixture_spec()), two_tets(order=2), solver="PARDISO"
        )


# --- Steady-state thermal analysis (M5.1, ADR-064) ---


def test_heat_transfer_deck_holds_fixed_temperatures_in_kelvin() -> None:
    lines = deck(heat_spec(), two_tets(order=2)).splitlines()
    step = lines.index("*STEP")
    # The heat transfer step names the spec's solver like *STATIC does (ADR-063).
    assert lines[step + 1 : step + 4] == [
        "*HEAT TRANSFER, STEADY STATE, SOLVER=PASTIX",
        "1.0, 1.0",
        "*BOUNDARY",
    ]
    # 100 °C and 373.15 K are the same temperature, so the shared edge is held consistently.
    assert lines[step + 4 : step + 6] == ["T1, 11, 11, 373.15", "T2, 11, 11, 373.15"]
    # Temperatures and heat fluxes to the .frd file, and the nodal heat flows of the fixed
    # temperatures for their heat flow (M5.3); no convection or radiation, so no XALL.
    assert lines[step + 6 :] == [
        "*NODE FILE",
        "NT",
        "*EL FILE",
        "HFL",
        "*NODE PRINT, NSET=TALL",
        "RFL",
        "*END STEP",
    ]
    assert not any(x.startswith(("*STATIC", "*ELASTIC")) for x in lines)


def test_conductivity_is_written_in_watts_per_metre_kelvin() -> None:
    text = deck(heat_two_bodies_spec(), bonded_tets(1))
    values = [float(part.splitlines()[0]) for part in text.split("*CONDUCTIVITY\n")[1:]]
    # 26 BTU/(h·ft·°F) and 0.39 W/(mm·K); the unassigned material gets no *MATERIAL.
    assert values == pytest.approx([26 * 1.7307346663713912, 390.0], rel=1e-15)
    assert "*MATERIAL, NAME=M1" not in text
    assert "*SOLID SECTION, ELSET=B1, MATERIAL=M2" in text
    assert "*SOLID SECTION, ELSET=B2, MATERIAL=M3" in text


def test_a_fixed_temperature_holds_every_node_of_its_faces() -> None:
    mesh = two_tets(order=2)
    lines = deck(heat_spec(), mesh).splitlines()
    first = lines.index("*NSET, NSET=T1")
    nodes = [int(n) for n in lines[first + 1].split(", ")]
    assert nodes == [n + 1 for n in fixed_support_nodes(mesh, [1])]
    assert len(nodes) == 6  # three corners and three mid-edge nodes


def test_fahrenheit_temperatures_convert_with_their_offset() -> None:
    spec = heat_spec()
    spec["loads"][1]["temperature"] = {"value": 212, "unit": "°F"}
    spec["loads"][0]["temperature"] = {"value": 212, "unit": "°F"}
    lines = deck(spec, two_tets(order=1)).splitlines()
    held = [x for x in lines if x.startswith("T1, 11, 11, ")]
    assert float(held[0].split(", ")[3]) == pytest.approx(373.15, rel=1e-14)


def test_a_solver_name_goes_on_the_heat_transfer_line() -> None:
    spec, mesh = SimulationSpec.model_validate(heat_spec()), two_tets(order=2)
    lines = generate_deck(spec, mesh, solver="PASTIX").splitlines()
    assert "*HEAT TRANSFER, STEADY STATE, SOLVER=PASTIX" in lines


def heat_load_spec(change) -> dict:  # type: ignore[no-untyped-def]
    spec = heat_spec()
    change(spec)
    return spec


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (
            lambda s: s["supports"].append(
                {"id": "f", "type": "fixed", "name": "Base", "faces": [2]}
            ),
            '"Base" has no effect in a steady-state thermal analysis',
        ),
        (
            lambda s: s["loads"].append(
                {
                    "id": "p",
                    "type": "pressure",
                    "name": "Inside",
                    "faces": [2],
                    "magnitude": {"value": 1, "unit": "MPa"},
                }
            ),
            '"Inside" has no effect in a steady-state thermal analysis',
        ),
        (lambda s: s.update(loads=[]), "no fixed temperature"),
        (lambda s: s["loads"][0].update(faces=[]), "Hot side has no faces"),
        (lambda s: s["loads"][0].update(faces=[9]), "uses faces [9], which the mesh does not have"),
        (lambda s: s["loads"][0].update(temperature=None), '"Hot side" has no value'),
        (
            lambda s: s["loads"][0].update(temperature={"value": -273.15, "unit": "°C"}),
            "at or below absolute zero",
        ),
        (
            lambda s: s["loads"][0].update(temperature={"value": 1, "unit": "MPa"}),
            "not a temperature unit",
        ),
        (
            lambda s: s["loads"][0].update(temperature={"value": 50, "unit": "°C"}),
            '"Hot side" and "Cold side" hold the same nodes',
        ),
        (
            lambda s: s["materials"][1].update(thermalConductivity=None),
            '"Steel (US units)" has no thermal conductivity'.replace(" (", "\n("),
        ),
        (
            lambda s: s["materials"][1].update(thermalConductivity={"value": 0, "unit": "W/(m·K)"}),
            "thermal conductivity must be greater than zero",
        ),
        (
            lambda s: s["materials"][1].update(thermalConductivity={"value": 45, "unit": "1/K"}),
            "not a thermal conductivity unit",
        ),
    ],
)
def test_refuses_thermal_setups_it_cannot_translate(change, message: str) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(DeckError, match=re.escape(message)):
        deck(heat_load_spec(change), two_tets(order=2))


def test_refuses_bonded_bodies_in_a_thermal_analysis() -> None:
    spec = heat_spec()
    spec["bodies"] = [{"tag": 1, "material": "steel"}, {"tag": 2, "material": "steel"}]
    spec["bonds"] = [{"faces": [1, 3], "status": "accepted"}]
    with pytest.raises(DeckError, match="Bonds do not carry heat"):
        deck(spec, bonded_tets(2))


def test_refuses_a_body_without_a_fixed_temperature() -> None:
    spec = heat_spec()
    spec["bodies"] = [{"tag": 1, "material": "steel"}, {"tag": 2, "material": "steel"}]
    spec["bonds"] = [{"faces": [1, 3], "status": "removed"}]
    spec["loads"] = [spec["loads"][0] | {"faces": [2]}]
    with pytest.raises(DeckError, match="Body 2 has no fixed temperature"):
        deck(spec, bonded_tets(2))


def test_refuses_a_fixed_temperature_in_a_static_analysis() -> None:
    spec = fixture_spec()
    spec["loads"].append(heat_spec()["loads"][0])
    with pytest.raises(DeckError, match='"Hot side" has no effect in a linear static analysis'):
        deck(spec, two_tets(order=2))


# --- Heat flux, convection, radiation and heat generation (M5.2, ADR-065) ---


def test_thermal_loads_are_written_in_si_on_their_element_faces() -> None:
    lines = deck(heat_loads_spec(), two_tets(order=2)).splitlines()
    step = lines.index("*STEP")
    # Face 2 is element 1's Gmsh local face 0, CalculiX face 1; the two fluxes add up.
    assert lines[step + 5 : step + 8] == ["*DFLUX", "1, S1, 25000.0", "B1, BF, 1000000.0"]
    # Face 3 is element 2's local faces 1 and 2, CalculiX faces 2 and 4 (CCX_FACE_NUMBER).
    film = lines.index("*FILM")
    h = 5 * 5.678263341113488
    rows = [x.split(", ") for x in lines[film + 1 : film + 3]]
    assert [x[:2] for x in rows] == [["2", "F2"], ["2", "F4"]]
    # 68 °F is 293.15 K and the coefficient in W/(m²·K).
    assert [float(x[2]) for x in rows] == pytest.approx([293.15, 293.15], rel=1e-15)
    assert [float(x[3]) for x in rows] == pytest.approx([h, h], rel=1e-15)
    radiate = lines.index("*RADIATE")
    assert lines[radiate + 1 : radiate + 3] == ["1, R2, 300.0, 0.8", "2, R3, 300.0, 0.8"]
    assert lines[radiate + 3 :] == [
        "*NODE FILE",
        "NT",
        "*EL FILE",
        "HFL",
        "*NODE PRINT, NSET=TALL",
        "RFL",
        "*NODE PRINT, NSET=XALL",
        "NT",
        "*END STEP",
    ]


def test_heat_sets_hold_the_fixed_and_the_exchanging_nodes() -> None:
    # M5.3: TALL is every node a fixed temperature holds, XALL every node on a face with
    # convection or radiation (an edge they share puts a node in both).
    spec = SimulationSpec.model_validate(heat_loads_spec())
    mesh = two_tets(order=2)
    lines = generate_deck(spec, mesh).splitlines()

    def members(name: str) -> set[int]:
        start = lines.index(f"*NSET, NSET={name}") + 1
        end = next(k for k in range(start, len(lines)) if lines[k].startswith("*"))
        return {int(v) for line in lines[start:end] for v in line.split(", ")}

    fixed = {f for x in spec.loads if x.type == "fixed_temperature" for f in x.faces}
    exchanged = {f for x in spec.loads if x.type in ("convection", "radiation") for f in x.faces}
    assert members("TALL") == {n + 1 for n in fixed_support_nodes(mesh, sorted(fixed))}
    assert members("XALL") == {n + 1 for n in fixed_support_nodes(mesh, sorted(exchanged))}


def test_a_thermal_deck_without_exchange_or_fixed_temperature_prints_neither() -> None:
    # Flux in, radiation out: no fixed temperature, so no TALL and no RFL.
    spec = heat_loads_spec()
    spec["loads"] = [x for x in spec["loads"] if x["type"] in ("heat_flux", "radiation")]
    lines = deck(spec, two_tets(order=2)).splitlines()
    assert "*NSET, NSET=TALL" not in lines and "RFL" not in lines
    assert "*NODE PRINT, NSET=XALL" in lines


def test_radiation_sets_the_constants_and_starts_from_the_mean_known_temperature() -> None:
    lines = deck(heat_loads_spec(), two_tets(order=2)).splitlines()
    step = lines.index("*STEP")
    assert lines[step - 3] == (
        "*PHYSICAL CONSTANTS, ABSOLUTE ZERO=0.0, STEFAN BOLTZMANN=5.670374419e-08"
    )
    assert lines[step - 2] == "*INITIAL CONDITIONS, TYPE=TEMPERATURE"
    # The mean of 373.15 K (fixed), 293.15 K (convection) and 300 K (radiation).
    assert float(lines[step - 1].split(", ")[1]) == pytest.approx((373.15 + 293.15 + 300) / 3)


def test_a_deck_without_radiation_has_no_constants_or_initial_temperature() -> None:
    spec = heat_loads_spec()
    spec["loads"] = [x for x in spec["loads"] if x["type"] != "radiation"]
    text = deck(spec, two_tets(order=2))
    assert "*PHYSICAL CONSTANTS" not in text
    assert "*INITIAL CONDITIONS" not in text
    assert "*RADIATE" not in text


def test_convection_or_radiation_alone_sets_the_temperature() -> None:
    spec = heat_loads_spec()
    spec["loads"] = spec["loads"][1:]  # no fixed temperature
    lines = deck(spec, two_tets(order=2)).splitlines()
    assert not any(x.startswith("T1, 11") for x in lines)
    step = lines.index("*STEP")
    assert float(lines[step - 1].split(", ")[1]) == pytest.approx((293.15 + 300) / 2)


def test_heat_generation_sums_per_body_and_goes_on_each_body_set() -> None:
    spec = heat_loads_spec()
    spec["bodies"] = [{"tag": 1, "material": "steel"}, {"tag": 2, "material": "steel"}]
    spec["bonds"] = [{"faces": [1, 3], "status": "removed"}]
    spec["loads"] = [
        spec["loads"][0] | {"faces": [2]},
        spec["loads"][3] | {"faces": [6]},
        spec["loads"][5] | {"bodies": [1, 2]},
        spec["loads"][5] | {"id": "g-2", "bodies": [2], "power": {"value": -1, "unit": "W/m³"}},
    ]
    lines = deck(spec, bonded_tets(2)).splitlines()
    dflux = lines.index("*DFLUX")
    assert lines[dflux + 1 : dflux + 3] == ["B1, BF, 1000000.0", "B2, BF, 999999.0"]


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (
            lambda s: s.update(loads=s["loads"][1:2]),
            "no fixed temperature, convection or radiation",
        ),
        (lambda s: s["loads"][1].update(faces=[]), "Heater has no faces"),
        (lambda s: s["loads"][3].update(faces=[9]), "uses faces [9], which the mesh does not"),
        (lambda s: s["loads"][1].update(flux=None), 'Heat flux "Heater" has no value'),
        (
            lambda s: s["loads"][1].update(flux={"value": 1, "unit": "W/(m²·K)"}),
            "not a heat flux unit",
        ),
        (
            lambda s: s["loads"][1].update(faces=[1]),
            'Heat flux "Heater" acts on face 1, which fixed temperature "Hot side" holds',
        ),
        (
            lambda s: s["loads"][3].update(faces=[1]),
            'Convection "Air" acts on face 1, which fixed temperature "Hot side" holds',
        ),
        (
            lambda s: s["loads"].append(s["loads"][3] | {"id": "h-2", "name": "Wind"}),
            'Convection "Air" and "Wind" both act on face 3',
        ),
        (
            lambda s: s["loads"].append(s["loads"][4] | {"id": "r-2", "name": "Sun"}),
            'Radiation "Sky" and "Sun" both act on face 4',
        ),
        (lambda s: s["loads"][3].update(coefficient=None), '"Air": coefficient has no value'),
        (
            lambda s: s["loads"][3].update(coefficient={"value": 0, "unit": "W/(m²·K)"}),
            "the coefficient must be greater than zero",
        ),
        (
            lambda s: s["loads"][3].update(ambientTemperature=None),
            '"Air": ambient temperature has no value',
        ),
        (
            lambda s: s["loads"][4].update(ambientTemperature={"value": -500, "unit": "°F"}),
            'Radiation "Sky": the ambient temperature is at or below absolute zero',
        ),
        (lambda s: s["loads"][4].update(emissivity=None), 'Radiation "Sky" has no emissivity'),
        (lambda s: s["loads"][5].update(bodies=[]), '"Coil" has no bodies'),
        (lambda s: s["loads"][5].update(bodies=[7]), "uses bodies [7], which the mesh does not"),
        (lambda s: s["loads"][5].update(power=None), 'Heat generation "Coil" has no value'),
    ],
)
def test_refuses_thermal_loads_it_cannot_translate(change, message: str) -> None:  # type: ignore[no-untyped-def]
    spec = heat_loads_spec()
    change(spec)
    with pytest.raises(DeckError, match=re.escape(message)):
        deck(spec, two_tets(order=2))


def test_refuses_a_body_reached_only_by_a_heat_flux() -> None:
    spec = heat_spec()
    spec["bodies"] = [{"tag": 1, "material": "steel"}, {"tag": 2, "material": "steel"}]
    spec["bonds"] = [{"faces": [1, 3], "status": "removed"}]
    spec["loads"] = [
        spec["loads"][0] | {"faces": [2]},
        heat_loads_spec()["loads"][1] | {"faces": [6]},
    ]
    with pytest.raises(DeckError, match="Body 2 has no fixed temperature, convection or radiation"):
        deck(spec, bonded_tets(2))


def test_a_body_with_convection_needs_no_fixed_temperature() -> None:
    spec = heat_spec()
    spec["bodies"] = [{"tag": 1, "material": "steel"}, {"tag": 2, "material": "steel"}]
    spec["bonds"] = [{"faces": [1, 3], "status": "removed"}]
    spec["loads"] = [
        spec["loads"][0] | {"faces": [2]},
        heat_loads_spec()["loads"][3] | {"faces": [6]},
    ]
    assert "*FILM" in deck(spec, bonded_tets(2))


@pytest.mark.parametrize("load", [1, 3, 4, 5])
def test_refuses_thermal_loads_in_a_static_analysis(load: int) -> None:
    spec = fixture_spec()
    item = heat_loads_spec()["loads"][load]
    spec["loads"].append(item)
    with pytest.raises(DeckError, match=f'"{item["name"]}" has no effect in a linear static'):
        deck(spec, two_tets(order=2))
