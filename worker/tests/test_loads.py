# SPDX-License-Identifier: AGPL-3.0-or-later
"""Force on faces and body loads as nodal forces (M2.3, ADR-040); no solver runs.

worker/spikes/load_check solves with CalculiX and checks the same loads against closed-form
answers and equilibrium; these tests pin the arithmetic on the hand-made meshes.
"""

import math
from pathlib import Path

import pytest

from clearfea_worker.deck.applied import applied_nodal_loads, force_loads
from clearfea_worker.deck.elements import CCX_NODE_ORDER, FACE_NODES
from clearfea_worker.deck.loads import BodyLoad, body_nodal_forces, fixed_support_nodes
from clearfea_worker.deck.loads.body import RULES, shape
from clearfea_worker.deck.loads.force import face_node_weights
from clearfea_worker.deck.loads.remote import remote_nodal_loads
from clearfea_worker.meshing.volume import TET_FACES, VolumeMesh
from clearfea_worker.results.summary import read_reactions
from clearfea_worker.spec.simulation_schema import RemoteLoad, SimulationSpec

from .deck_meshes import two_tets
from .test_deck import fixture_spec

#: Edge of the cube two_tets is drawn in, in metres.
A = 0.01


def volume(mesh: VolumeMesh, element: int) -> float:
    npe = 10 if mesh.order == 2 else 4
    p = mesh.positions
    a, b, c, d = (mesh.elements[element * npe + k] for k in range(4))
    u = [p[3 * b + i] - p[3 * a + i] for i in range(3)]
    v = [p[3 * c + i] - p[3 * a + i] for i in range(3)]
    w = [p[3 * d + i] - p[3 * a + i] for i in range(3)]
    return (
        abs(
            u[0] * (v[1] * w[2] - v[2] * w[1])
            - u[1] * (v[0] * w[2] - v[2] * w[0])
            + u[2] * (v[0] * w[1] - v[1] * w[0])
        )
        / 6
    )


def loaded_spec(loads: list[dict]) -> SimulationSpec:
    spec = fixture_spec()
    spec["materials"][0]["density"] = {"value": 7.85, "unit": "g/cm³"}
    spec["loads"] = loads
    return SimulationSpec.model_validate(spec)


def force(faces: list[int], x: float, y: float, z: float, unit: str = "N") -> dict:
    return {
        "id": "f",
        "type": "force",
        "name": "F",
        "faces": faces,
        "x": {"value": x, "unit": unit},
        "y": {"value": y, "unit": unit},
        "z": {"value": z, "unit": unit},
    }


@pytest.mark.parametrize("order", [1, 2])
def test_shape_functions_add_up_to_one_and_their_derivatives_to_zero(order: int) -> None:
    for r, s, t, _ in RULES[2]:
        n, d = shape(order, r, s, t)
        assert sum(n) == pytest.approx(1.0, abs=1e-15)
        for c in range(3):
            assert sum(row[c] for row in d) == pytest.approx(0.0, abs=1e-14)


def test_quadratic_shape_function_is_one_at_its_own_node_only() -> None:
    nodes = [(0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1)]
    edges = ((0, 1), (1, 2), (2, 0), (0, 3), (1, 3), (2, 3))
    nodes += [tuple((nodes[a][i] + nodes[b][i]) / 2 for i in range(3)) for a, b in edges]
    for k, (r, s, t) in enumerate(nodes):
        n, _ = shape(2, r, s, t)
        assert n == pytest.approx([1.0 if j == k else 0.0 for j in range(10)], abs=1e-15)


def test_four_point_rule_integrates_a_quadratic_exactly() -> None:
    # The integral of r^2 over the unit tetrahedron is 1/60.
    assert sum(w * r * r for r, _, _, w in RULES[2]) == pytest.approx(1 / 60, rel=1e-14)


@pytest.mark.parametrize("order", [1, 2])
def test_force_on_a_flat_face_goes_to_corners_or_mid_edge_nodes_by_area(order: int) -> None:
    mesh = two_tets(order=order)
    weights = face_node_weights(mesh, [2])  # face A B C, z = 0: a triangle of area a²/2
    area = A * A / 2
    assert sum(weights.values()) == pytest.approx(area, rel=1e-14)
    element, local = mesh.faces[2][0]
    npe = 10 if order == 2 else 4
    corners = {mesh.elements[element * npe + k] for k in TET_FACES[local]}
    for node, w in weights.items():
        if order == 1:
            assert w == pytest.approx(area / 3, rel=1e-13)
        elif node in corners:
            assert w == pytest.approx(0.0, abs=1e-18)
        else:
            assert w == pytest.approx(area / 3, rel=1e-13)
    assert set(weights) == {mesh.elements[element * npe + k] for k in FACE_NODES[order][local]}


def test_force_is_spread_over_faces_by_area_and_adds_up_exactly() -> None:
    mesh = two_tets(order=2)
    spec = loaded_spec(loads=[force([2, 3], 3, -4, 12, "kN")])
    loads = force_loads(spec, mesh)
    total = [sum(f[i] for f in loads.values()) for i in range(3)]
    assert total == pytest.approx([3000.0, -4000.0, 12000.0], rel=1e-14)
    # Every node carries the same fraction of each component.
    for fx, fy, fz in loads.values():
        assert fy == pytest.approx(-4 / 3 * fx, rel=1e-12, abs=1e-12)
        assert fz == pytest.approx(4 * fx, rel=1e-12, abs=1e-12)


@pytest.mark.parametrize("order", [1, 2])
def test_gravity_on_a_straight_element_is_the_textbook_split(order: int) -> None:
    mesh = two_tets(order=order)
    g = (0.0, 0.0, -9.81)
    forces = body_nodal_forces(mesh, {1: 7850.0}, BodyLoad(g), None)
    weight = 7850.0 * 9.81 * (volume(mesh, 0) + volume(mesh, 1))
    assert sum(f[2] for f in forces.values()) == pytest.approx(-weight, rel=1e-13)
    assert all(f[0] == 0.0 and f[1] == 0.0 for f in forces.values())
    # One element alone: C3D4 corners get a quarter; C3D10 corners -1/20, mid-edge nodes 1/5.
    npe = 10 if order == 2 else 4
    one = VolumeMesh(order, mesh.positions, mesh.elements[:npe], {1: (0, 1)}, {})
    single = body_nodal_forces(one, {1: 7850.0}, BodyLoad(g), None)
    w0 = 7850.0 * 9.81 * volume(mesh, 0)
    order_ = CCX_NODE_ORDER[order]
    for k, local in enumerate(order_):
        node = one.elements[local]
        share = 0.25 if order == 1 else (-0.05 if k < 4 else 0.2)
        assert single[node][2] == pytest.approx(-share * w0, rel=1e-12)


def test_centrifugal_total_is_mass_times_omega_squared_times_centroid_distance() -> None:
    mesh = two_tets(order=2)
    omega2 = 100.0**2
    load = BodyLoad((0.0, 0.0, 0.0), omega2, (0.002, -0.001, 0.0), (0.0, 0.0, 1.0))
    forces = body_nodal_forces(mesh, {1: 1000.0}, load, None)
    total = [sum(f[i] for f in forces.values()) for i in range(3)]
    expected = [0.0, 0.0, 0.0]
    p = mesh.positions
    for e in range(2):
        corners = [mesh.elements[e * 10 + k] for k in range(4)]
        c = [sum(p[3 * n + i] for n in corners) / 4 for i in range(3)]
        m = 1000.0 * volume(mesh, e)
        expected[0] += m * omega2 * (c[0] - 0.002)
        expected[1] += m * omega2 * (c[1] + 0.001)
    assert total == pytest.approx(expected, rel=1e-12, abs=1e-12)


def test_body_forces_at_some_nodes_are_those_of_the_whole_mesh() -> None:
    mesh = two_tets(order=2)
    load = BodyLoad((1.0, -2.0, 3.0), 50.0, (0.0, 0.0, 0.0), (0.6, 0.0, 0.8))
    every = body_nodal_forces(mesh, {1: 2700.0}, load, None)
    some = body_nodal_forces(mesh, {1: 2700.0}, load, [0, 4, 7])
    assert some == {n: every[n] for n in (0, 4, 7)}


def test_applied_loads_add_force_and_body_loads_at_the_asked_nodes() -> None:
    mesh = two_tets(order=2)
    gravity = {
        "id": "g",
        "type": "gravity",
        "name": "G",
        "x": {"value": 0, "unit": "g"},
        "y": {"value": 0, "unit": "g"},
        "z": {"value": -1, "unit": "g"},
    }
    spec = loaded_spec(loads=[force([2], 0, 0, 10), gravity])
    nodes = list(range(mesh.node_count))
    applied = applied_nodal_loads(spec, mesh, nodes)
    weight = 7850.0 * 9.80665 * (volume(mesh, 0) + volume(mesh, 1))
    total = [sum(f[i] for f in applied.values()) for i in range(3)]
    assert total == pytest.approx([0.0, 0.0, 10.0 - weight], abs=1e-12)


def test_reactions_have_the_loads_on_held_nodes_taken_out(tmp_path: Path) -> None:
    # A .dat total of exactly what the held nodes carry means no reaction at all.
    mesh = two_tets(order=2)
    spec = loaded_spec(loads=[force([2], 1, 2, 3)])  # face 2 touches the fixed face 1
    held = fixed_support_nodes(mesh, [1])
    on_held = [sum(f[i] for f in applied_nodal_loads(spec, mesh, held).values()) for i in range(3)]
    assert math.dist(on_held, (0, 0, 0)) > 0.1
    dat = tmp_path / "job.dat"
    dat.write_text(
        " total force (fx,fy,fz) for set S1 and time  0.1000000E+01\n\n"
        + "  ".join(f"{v:.15E}" for v in on_held)
        + "\n"
    )
    (reaction,) = read_reactions(spec, mesh, dat)
    assert reaction == pytest.approx((0.0, 0.0, 0.0), abs=1e-12)


def remote(
    faces: list[int],
    point: tuple[float, float, float],
    f: tuple[float, float, float],
    m: tuple[float, float, float],
) -> dict:
    """A remote load in SI units (m, N, N·m)."""

    def xyz(v: tuple[float, float, float], unit: str) -> dict:
        return {a: {"value": c, "unit": unit} for a, c in zip("xyz", v, strict=True)}

    return {
        "id": "r",
        "type": "remote",
        "name": "R",
        "faces": faces,
        "point": xyz(point, "m"),
        "force": xyz(f, "N"),
        "moment": xyz(m, "N·m"),
    }


def bent(mesh: VolumeMesh) -> VolumeMesh:
    """``mesh`` with every mid-edge node pushed off its edge, so element faces are curved."""
    p = list(mesh.positions)
    for n in range(5, mesh.node_count):
        p[3 * n] += 0.0007 * (n % 3 - 1)
        p[3 * n + 1] += 0.0005 * (n % 2)
        p[3 * n + 2] -= 0.0004 * (n % 4 - 1.5)
    return VolumeMesh(mesh.order, p, mesh.elements, mesh.bodies, mesh.faces)


def resultant(
    mesh: VolumeMesh, loads: dict[int, tuple[float, float, float]], about: tuple[float, ...]
) -> tuple[list[float], list[float]]:
    """Total force and its moment about ``about`` of nodal loads."""
    p = mesh.positions
    force, moment = [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]
    for node, f in loads.items():
        r = [p[3 * node + i] - about[i] for i in range(3)]
        for i in range(3):
            force[i] += f[i]
        moment[0] += r[1] * f[2] - r[2] * f[1]
        moment[1] += r[2] * f[0] - r[0] * f[2]
        moment[2] += r[0] * f[1] - r[1] * f[0]
    return force, moment


@pytest.mark.parametrize("mesh", [two_tets(order=1), two_tets(order=2), bent(two_tets(order=2))])
@pytest.mark.parametrize("faces", [[2], [3], [1, 3, 4]])
def test_remote_load_has_its_force_and_moment_about_the_point(
    mesh: VolumeMesh, faces: list[int]
) -> None:
    point = (0.03, -0.02, 0.05)
    f, m = (120.0, -340.0, 75.0), (4.0, 2.5, -6.0)
    load = RemoteLoad.model_validate(remote(faces, point, f, m))
    force, moment = resultant(mesh, remote_nodal_loads(mesh, load), point)
    assert force == pytest.approx(f, rel=1e-12)
    assert moment == pytest.approx(m, rel=1e-12)


@pytest.mark.parametrize("order", [1, 2])
def test_remote_force_through_the_centroid_is_the_uniform_traction(order: int) -> None:
    # A force at the faces' centroid with no moment needs no linear part: the remote load is
    # then the same as a force on the faces (force.py).
    mesh = bent(two_tets(order=2)) if order == 2 else two_tets(order=1)
    weights = face_node_weights(mesh, [2, 3])
    area = sum(weights.values())
    p = mesh.positions
    c = [sum(w * p[3 * n + i] for n, w in weights.items()) / area for i in range(3)]
    f = (10.0, 20.0, -30.0)
    load = RemoteLoad.model_validate(remote([2, 3], (c[0], c[1], c[2]), f, (0.0, 0.0, 0.0)))
    loads = remote_nodal_loads(mesh, load)
    assert set(loads) == set(weights)
    for node, w in weights.items():
        assert loads[node] == pytest.approx([fi * w / area for fi in f], rel=1e-9, abs=1e-12)


def test_remote_moment_about_a_flat_faces_normal_shears_it_without_net_force() -> None:
    mesh = two_tets(order=2)
    load = RemoteLoad.model_validate(remote([2], (1.0, 2.0, 3.0), (0, 0, 0), (0, 0, 5.0)))
    loads = remote_nodal_loads(mesh, load)
    force, moment = resultant(mesh, loads, (0.0, 0.0, 0.0))
    assert force == pytest.approx([0, 0, 0], abs=1e-9)
    assert moment == pytest.approx([0, 0, 5.0], rel=1e-12, abs=1e-12)
    assert all(f[2] == 0.0 for f in loads.values())  # in the face's plane only


def test_applied_loads_include_remote_loads() -> None:
    mesh = two_tets(order=2)
    spec = loaded_spec(loads=[force([2], 0, 0, 10), remote([3], (0, 0, 0), (1, 2, 3), (0, 0, 0))])
    applied = applied_nodal_loads(spec, mesh, range(mesh.node_count))
    total = [sum(f[i] for f in applied.values()) for i in range(3)]
    assert total == pytest.approx([1.0, 2.0, 13.0], rel=1e-12)
