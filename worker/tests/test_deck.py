# SPDX-License-Identifier: AGPL-3.0-or-later
"""The deck generator: element mapping, deck snapshots and refusals (no solver runs).

Snapshots live in tests/snapshots/deck/. A missing snapshot is written when the test runs
with CLEARFEA_WRITE_SNAPSHOTS=1; an existing one is never overwritten. To change one, delete
it and explain in the pull request why the new deck is correct (docs/VERIFICATION.md).
"""

import copy
import json
import os
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
from clearfea_worker.meshing.volume import NODES_PER_ELEMENT, TET_FACES, VolumeMesh
from clearfea_worker.spec.simulation_schema import SimulationSpec

from .deck_meshes import GMSH_EDGES, two_tets

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
    ],
)
def test_refuses_a_spec_it_cannot_translate(change, message: str) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(DeckError, match=None) as error:
        deck(broken(change), two_tets(order=2))
    assert message in str(error.value)


def test_refuses_a_mesh_with_nodes_outside_every_element() -> None:
    mesh = two_tets(order=1)
    extra = VolumeMesh(1, [*mesh.positions, 1.0, 1.0, 1.0], mesh.elements, mesh.bodies, mesh.faces)
    with pytest.raises(DeckError, match="1 nodes that belong to no element"):
        deck(fixture_spec(), extra)


def test_nodes_per_element_matches_element_types() -> None:
    assert set(NODES_PER_ELEMENT) == set(CCX_NODE_ORDER)
