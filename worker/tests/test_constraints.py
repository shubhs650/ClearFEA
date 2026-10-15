# SPDX-License-Identifier: AGPL-3.0-or-later
"""Supports as node constraints (M2.2, ADR-039): holds, rigid-body motions, reaction sharing."""

import math

import pytest

from clearfea_worker.deck import DeckError
from clearfea_worker.deck.constraints import (
    AXES,
    Constraint,
    free_motions,
    hold,
    holds,
    share_reaction,
)
from clearfea_worker.deck.linalg import symmetric_eigen
from clearfea_worker.deck.loads import face_normal
from clearfea_worker.spec.simulation_schema import SimulationSpec

from .deck_meshes import two_tets
from .test_deck import fixture_spec, supports_spec, turned


def spec_with(supports: list[dict]) -> SimulationSpec:
    spec = fixture_spec()
    spec["supports"] = supports
    return SimulationSpec.model_validate(spec)


def frictionless(faces: list[int]) -> dict:
    return {"id": f"f{faces[0]}", "type": "frictionless", "name": f"Plane {faces}", "faces": faces}


def test_symmetric_eigen_finds_values_and_vectors() -> None:
    values, vectors = symmetric_eigen([[2.0, 1.0, 0.0], [1.0, 2.0, 0.0], [0.0, 0.0, 5.0]])
    assert values == pytest.approx([1.0, 3.0, 5.0])
    s = 1 / math.sqrt(2)
    assert [abs(x) for x in vectors[0]] == pytest.approx([s, s, 0.0])
    assert [abs(x) for x in vectors[2]] == pytest.approx([0.0, 0.0, 1.0])


def test_face_normals_point_out_of_the_body() -> None:
    mesh = two_tets(order=2)
    assert face_normal(mesh, 1, "x") == (-1.0, 0.0, 0.0)
    assert face_normal(mesh, 2, "x") == (0.0, 0.0, -1.0)
    leaning = face_normal(turned(mesh), 1, "x")
    assert leaning == pytest.approx((-math.cos(math.pi / 6), -0.5, 0.0))


def test_a_face_that_is_not_flat_is_refused() -> None:
    with pytest.raises(DeckError, match="face 4 is not flat"):
        face_normal(two_tets(order=1), 4, "Plane")


def test_constraints_along_different_directions_combine() -> None:
    spec = spec_with([frictionless([1])])
    h = hold(spec, two_tets(1), 0, [Constraint(0, AXES[0], 0.0), Constraint(0, AXES[1], 2e-3)])
    assert h.on_axes
    assert h.displacement() == pytest.approx((0.0, 2e-3, 0.0))


def test_three_inclined_constraints_fix_the_node_at_their_common_solution() -> None:
    spec = spec_with([frictionless([1])])
    c, s = math.cos(0.3), math.sin(0.3)
    cs = [
        Constraint(0, (c, s, 0.0), 0.0),
        Constraint(0, AXES[2], 0.0),
        Constraint(0, AXES[1], 1e-3),
    ]
    h = hold(spec, two_tets(1), 0, cs)
    assert not h.on_axes and len(h.basis) == 3
    assert h.displacement() == pytest.approx((-s / c * 1e-3, 1e-3, 0.0), abs=1e-15)


def test_repeated_directions_count_once() -> None:
    spec = spec_with([frictionless([1])])
    h = hold(spec, two_tets(1), 0, [Constraint(0, AXES[0], 0.0), Constraint(0, AXES[0], 0.0)])
    assert len(h.basis) == 1


def test_constraints_that_disagree_are_refused_with_both_supports_named() -> None:
    spec = spec_with([frictionless([1]), frictionless([2])])
    with pytest.raises(
        DeckError, match=r'"Plane \[1\]" and the frictionless support "Plane \[2\]"'
    ):
        hold(spec, two_tets(1), 0, [Constraint(0, AXES[0], 0.0), Constraint(1, AXES[0], 1e-3)])


def test_one_plane_leaves_three_motions_free() -> None:
    mesh = two_tets(order=2)
    spec = spec_with([frictionless([1])])
    assert free_motions(mesh, holds(spec, mesh)) == [
        "slide along y",
        "slide along z",
        "turn about the x axis",
    ]


def test_supports_that_hold_every_motion_leave_none_free() -> None:
    for mesh in (two_tets(order=2), turned(two_tets(order=2))):
        spec = SimulationSpec.model_validate(supports_spec())
        assert free_motions(mesh, holds(spec, mesh)) == []
    fixed = SimulationSpec.model_validate(fixture_spec())
    assert free_motions(two_tets(1), holds(fixed, two_tets(1))) == []


def test_an_inclined_free_motion_is_reported_as_another_way() -> None:
    mesh = turned(two_tets(order=1))
    spec = spec_with([frictionless([1, 2])])  # leaning x plane and z = 0: one slide is free
    motions = free_motions(mesh, holds(spec, mesh))
    assert motions == ["move in 1 other way"]


def test_a_node_held_by_one_support_keeps_only_the_force_along_what_it_holds() -> None:
    # Along the free directions CalculiX's nodal force is applied load, not reaction.
    shares = share_reaction(spec_with([]), [Constraint(0, AXES[2], 0.0)], (3.0, 4.0, 5.0))
    assert shares == {0: pytest.approx((0.0, 0.0, 5.0))}


def test_supports_holding_different_directions_take_their_own_components() -> None:
    c, s = math.cos(0.4), math.sin(0.4)
    n = (c, s, 0.0)
    force = (2.0 * c, 2.0 * s, -7.0)
    shares = share_reaction(
        spec_with([]), [Constraint(0, n, 0.0), Constraint(1, AXES[2], 0.0)], force
    )
    assert shares[0] == pytest.approx((2.0 * c, 2.0 * s, 0.0))
    assert shares[1] == pytest.approx((0.0, 0.0, -7.0))


def test_supports_holding_the_same_direction_share_it_equally() -> None:
    cs = [Constraint(0, axis, 0.0) for axis in AXES] + [Constraint(1, AXES[0], 0.0)]
    shares = share_reaction(spec_with([]), cs, (4.0, 1.0, 2.0))
    assert shares[0] == pytest.approx((2.0, 1.0, 2.0))
    assert shares[1] == pytest.approx((2.0, 0.0, 0.0))
