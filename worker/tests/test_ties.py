# SPDX-License-Identifier: AGPL-3.0-or-later
"""Bonds as ties (M4.3, ADR-060): which bonds are tied, the slave side, the equations and the
tie forces the result reader passes on to held nodes (no solver runs)."""

import math
import random

import pytest

from clearfea_worker.deck import DeckError, generate_deck
from clearfea_worker.deck.constraints import FREE, Frame, hold_frame, holds, node_frames
from clearfea_worker.deck.linalg import cross
from clearfea_worker.deck.loads.tie import (
    Tie,
    body_groups,
    closest_point,
    tie_forces,
    tied_bonds,
    ties,
)
from clearfea_worker.meshing.volume import VolumeMesh
from clearfea_worker.spec.simulation_schema import SimulationSpec

from .deck_meshes import bonded_tets, two_tets


def bonded_spec(status: str = "detected", **changes: object) -> SimulationSpec:
    spec = {
        "version": 1,
        "analysis": "linear_static",
        "geometryId": "00000000-0000-4000-8000-000000000003",
        "bodies": [{"tag": 1, "material": "steel"}, {"tag": 2, "material": "alu"}],
        "materials": [
            {
                "id": "steel",
                "name": "Steel",
                "model": "isotropic_elastic",
                "youngsModulus": {"value": 200, "unit": "GPa"},
                "poissonsRatio": 0.3,
            },
            {
                "id": "alu",
                "name": "Aluminium",
                "model": "isotropic_elastic",
                "youngsModulus": {"value": 70000, "unit": "MPa"},
                "poissonsRatio": 0.33,
            },
        ],
        "supports": [{"id": "fixed-1", "type": "fixed", "name": "Base", "faces": [2]}],
        "loads": [
            {
                "id": "pressure-1",
                "type": "pressure",
                "name": "Top",
                "faces": [4, 5, 6],
                "magnitude": {"value": 1, "unit": "MPa"},
            }
        ],
        "mesh": {"size": {"value": 5, "unit": "mm"}},
        "bonds": [{"faces": [1, 3], "status": status}],
    }
    spec.update(changes)
    return SimulationSpec.model_validate(spec)


def _linear_field(seed: int):  # type: ignore[no-untyped-def]
    """A displacement linear in position, u = a + B x, with made-up coefficients."""
    rng = random.Random(seed)
    a = [rng.uniform(-1, 1) for _ in range(3)]
    b = [[rng.uniform(-100, 100) for _ in range(3)] for _ in range(3)]
    return lambda x: [a[i] + sum(b[i][j] * x[j] for j in range(3)) for i in range(3)]


def _residuals(mesh: VolumeMesh, tie_list: list[Tie], frames: dict[int, Frame], seed: int) -> list:
    """Each equation's sum for a linear displacement field written in each node's directions."""
    u = _linear_field(seed)
    p = mesh.positions
    out = []
    for tie in tie_list:
        for equation in tie.equations:
            total = 0.0
            for term in equation:
                n = term.node
                axis = frames.get(n, FREE).axes[term.direction]
                displacement = u(p[3 * n : 3 * n + 3])
                total += term.coefficient * sum(axis[i] * displacement[i] for i in range(3))
            out.append(total)
    return out


def test_every_bond_but_the_removed_ones_is_tied() -> None:
    spec = bonded_spec()
    assert [b.faces for b in tied_bonds(spec)] == [[1, 3]]
    assert [b.faces for b in tied_bonds(bonded_spec("accepted"))] == [[1, 3]]
    assert tied_bonds(bonded_spec("removed")) == []
    assert tied_bonds(bonded_spec(bonds=None)) == []


@pytest.mark.parametrize("order", [1, 2])
def test_the_finer_face_follows_and_every_free_slave_node_is_tied(order: int) -> None:
    mesh = bonded_tets(order)
    (tie,) = ties(bonded_spec(), mesh, {})
    assert (tie.slave, tie.master, tie.slave_body, tie.master_body) == (3, 1, 2, 1)
    nodes = 3 if order == 1 else 6
    assert (tie.nodes, tie.tied, tie.held, tie.off, tie.shared) == (nodes, nodes, 0, 0, 0)
    assert len(tie.equations) == 3 * nodes
    for equation in tie.equations:
        assert equation[0].coefficient == 1.0
        # The master face's shape functions at the point add up to one.
        assert math.isclose(sum(t.coefficient for t in equation[1:]), -1.0, abs_tol=1e-12)


@pytest.mark.parametrize("order", [1, 2])
def test_tie_equations_hold_for_any_linear_displacement(order: int) -> None:
    mesh = bonded_tets(order)
    residuals = _residuals(mesh, ties(bonded_spec(), mesh, {}), {}, seed=order)
    assert residuals and max(abs(r) for r in residuals) < 1e-12


def test_a_slave_node_on_an_inclined_support_is_tied_in_its_free_directions_only() -> None:
    mesh = bonded_tets(2)
    # A frictionless support on body 2's sloping face E F H holds its nodes along its normal
    # through a *TRANSFORM; three nodes of the bond (E, F and the node between) lie on it.
    spec = bonded_spec(
        supports=[
            {"id": "fixed-1", "type": "fixed", "name": "Base", "faces": [2]},
            {"id": "slide-1", "type": "frictionless", "name": "Side", "faces": [4]},
        ]
    )
    frames = node_frames(holds(spec, mesh))
    (tie,) = ties(spec, mesh, frames)
    for equation in tie.equations:
        frame = frames.get(equation[0].node, FREE)
        assert equation[0].direction not in frame.held
    assert len(tie.equations) == 3 * 2 + 3 * 3
    assert (
        sum(frames[n].transformed for n in {e[0].node for e in tie.equations} if n in frames) == 3
    )
    assert tie.held + tie.tied == tie.nodes
    residuals = _residuals(mesh, [tie], frames, seed=3)
    assert max(abs(r) for r in residuals) < 1e-12


def test_a_slave_node_held_in_every_direction_is_not_tied() -> None:
    mesh = bonded_tets(2)
    spec = bonded_spec(
        supports=[
            {"id": "fixed-1", "type": "fixed", "name": "Base", "faces": [2]},
            {"id": "fixed-2", "type": "fixed", "name": "Top", "faces": [3]},
        ]
    )
    (tie,) = ties(spec, mesh, node_frames(holds(spec, mesh)))
    assert (tie.tied, tie.held, tie.equations) == (0, 6, ())


def test_a_slave_node_off_the_master_face_is_not_tied() -> None:
    mesh = bonded_tets(1)
    moved = list(mesh.positions)
    moved[3 * 5] = 0.02  # F beyond the master face's edge, 2.9 mm off it
    mesh = VolumeMesh(1, moved, mesh.elements, mesh.bodies, mesh.faces)
    (tie,) = ties(bonded_spec(), mesh, {})
    assert (tie.tied, tie.off) == (2, 1)


def test_closest_point_on_a_curved_face_is_on_its_shape() -> None:
    # A six-node face bulging up by 1 mm at its mid-edge nodes; a point straight above the
    # centroid comes down to the curved face, not to the corners' plane.
    mesh = bonded_tets(2)
    from clearfea_worker.deck.loads.tie import _patches

    (patch,) = _patches(mesh, 3)
    points = list(patch.points)
    for k in (3, 4, 5):
        points[k] = (points[k][0], points[k][1], 0.001)
    bent = type(patch)(patch.nodes, tuple(points))
    cx = sum(x[0] for x in points[:3]) / 3
    cy = sum(x[1] for x in points[:3]) / 3
    l1, l2, distance = closest_point(2, bent, (cx, cy, 0.005))
    # On the shape, z at the centroid is 4/3 mm (quadratic shape functions, all l = 1/3).
    assert math.isclose(l1, 1 / 3, abs_tol=1e-6) and math.isclose(l2, 1 / 3, abs_tol=1e-6)
    assert math.isclose(distance, 0.005 - 0.004 / 3, rel_tol=1e-9)


def test_tie_forces_pass_a_slave_nodes_force_to_its_master_nodes() -> None:
    mesh = bonded_tets(1)
    (tie,) = ties(bonded_spec(), mesh, {})
    slave = {n: (1.0, 2.0, -3.0) for n in (4, 5, 6)}
    forces = tie_forces([tie], {}, slave)
    assert set(forces) == {0, 1, 2}
    # The master nodes receive the whole force, shared by the shape functions.
    total = [sum(f[i] for f in forces.values()) for i in range(3)]
    assert total == pytest.approx([3.0, 6.0, -9.0], abs=1e-12)
    # E at (2, 1) mm lies at l = (0.7, 0.2, 0.1) of A, B, C on face A C B.
    one = tie_forces([tie], {}, {4: (1.0, 0.0, 0.0), 5: (0.0, 0.0, 0.0), 6: (0.0, 0.0, 0.0)})
    assert [one[n][0] for n in (0, 1, 2)] == pytest.approx([0.7, 0.2, 0.1], abs=1e-12)


def test_tie_forces_follow_a_master_nodes_own_directions() -> None:
    mesh = bonded_tets(1)
    a = (math.cos(0.3), math.sin(0.3), 0.0)
    b = (-math.sin(0.3), math.cos(0.3), 0.0)
    turned = Frame((a, b, cross(a, b)), frozenset({0}), True)
    frames = {0: turned, 1: turned, 2: turned}
    (tie,) = ties(bonded_spec(), mesh, frames)
    plain = tie_forces(
        [ties(bonded_spec(), mesh, {})[0]], {}, {n: (1.0, 2.0, 0.5) for n in (4, 5, 6)}
    )
    forces = tie_forces([tie], frames, {n: (1.0, 2.0, 0.5) for n in (4, 5, 6)})
    for n in (0, 1, 2):
        assert forces[n] == pytest.approx(plain[n], abs=1e-12)


def test_the_deck_writes_each_tie_as_equations_and_prints_the_slave_forces() -> None:
    text = generate_deck(bonded_spec(), bonded_tets(2))
    assert (
        "** Bond of faces 1 and 3: face 3 (body 2) follows face 1 (body 1); 6 of 6 nodes tied,"
        in text
    )
    assert text.splitlines().count("*EQUATION") == 1
    assert "*NSET, NSET=TIED" in text
    assert "*NODE PRINT, NSET=TIED, GLOBAL=YES\nRF\n*END STEP" in text
    # Removed bonds leave the deck as it was before M4.3 (body 2 then needs its own support,
    # M4.4).
    both = [{"id": "fixed-1", "type": "fixed", "name": "Base", "faces": [2, 4]}]
    removed = generate_deck(bonded_spec("removed", supports=both), bonded_tets(2))
    assert "*EQUATION" not in removed and "TIED" not in removed
    assert removed == generate_deck(bonded_spec(bonds=None, supports=both), bonded_tets(2))


def test_groups_bodies_by_their_ties_and_shared_nodes() -> None:
    mesh = bonded_tets(2)
    frames = node_frames(holds(bonded_spec(), mesh))
    assert body_groups(mesh, ties(bonded_spec(), mesh, frames)) == [[1, 2]]
    assert body_groups(mesh, ties(bonded_spec("removed"), mesh, frames)) == [[1], [2]]
    assert body_groups(mesh, []) == [[1], [2]]
    # The two-element test mesh's bodies share a face's nodes, so they are one piece.
    assert body_groups(two_tets(1, bodies=2), []) == [[1, 2]]


def test_refuses_a_body_no_bond_joins_to_a_held_body() -> None:
    mesh = bonded_tets(2)
    message = "No support holds body 2 and no bond joins it to a held body, so it is free to move."
    for spec in (bonded_spec("removed"), bonded_spec(bonds=None)):
        with pytest.raises(DeckError, match=message):
            generate_deck(spec, mesh)
    # A bond whose slave nodes are all held ties nothing, so it joins nothing: fixing the slave
    # face (face 3, body 2) leaves body 1 free.
    held_bond = [{"id": "fixed-1", "type": "fixed", "name": "Bond face", "faces": [3]}]
    with pytest.raises(DeckError, match=message.replace("body 2", "body 1")):
        generate_deck(bonded_spec(supports=held_bond), mesh)


def test_names_the_motions_a_separate_body_is_still_free_in() -> None:
    mesh = bonded_tets(2)
    supports = [
        {"id": "fixed-1", "type": "fixed", "name": "Base", "faces": [2]},
        {"id": "slide-1", "type": "frictionless", "name": "Slide", "faces": [4]},
    ]
    with pytest.raises(DeckError) as raised:
        generate_deck(bonded_spec("removed", supports=supports), mesh)
    text = str(raised.value)
    assert text.startswith("The supports do not hold body 2 in place: it can still ")
    assert "body 1" not in text


def test_refuses_bonds_that_do_not_fit_the_mesh() -> None:
    mesh = bonded_tets(2)
    with pytest.raises(DeckError, match="uses faces \\[9\\], which the mesh does not have"):
        generate_deck(bonded_spec(bonds=[{"faces": [1, 9], "status": "detected"}]), mesh)
    with pytest.raises(DeckError, match="joins body 1 to itself"):
        generate_deck(bonded_spec(bonds=[{"faces": [1, 2], "status": "accepted"}]), mesh)


def test_hold_frame_is_global_for_axis_holds_and_turned_otherwise() -> None:
    mesh = bonded_tets(2)
    spec = bonded_spec(
        supports=[
            {"id": "fixed-1", "type": "fixed", "name": "Base", "faces": [2]},
            {"id": "slide-1", "type": "frictionless", "name": "Side", "faces": [4]},
        ]
    )
    for h in holds(spec, mesh).values():
        frame = hold_frame(h)
        axes = frame.axes
        for i in range(3):
            for j in range(3):
                d = sum(axes[i][k] * axes[j][k] for k in range(3))
                assert math.isclose(d, 1.0 if i == j else 0.0, abs_tol=1e-12)
        assert frame.transformed == (not h.on_axes and len(h.basis) < 3)
        assert len(frame.held) == len(h.basis)
