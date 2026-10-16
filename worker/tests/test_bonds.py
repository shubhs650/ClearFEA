# SPDX-License-Identifier: AGPL-3.0-or-later
"""Bond detection between touching bodies (M4.2, ADR-059)."""

import json
import math
from pathlib import Path

import pytest

from clearfea_worker.geometry.bonds import (
    BOND_TOLERANCE_FRACTION,
    boxes_meet,
    candidate_pairs,
    triangle_areas,
    triangle_centroids,
)
from clearfea_worker.geometry.display import FacePatch
from clearfea_worker.geometry.importer import import_geometry
from clearfea_worker.spec.geometry_schema import Topology, TopologyFace

from .step_models import block_with_hole, bond_model, two_blocks

MM = 1e-3


def detect(tmp_path: Path, step: Path) -> Topology:
    import_geometry(step, tmp_path / "out", None)
    return Topology.model_validate(json.loads((tmp_path / "out" / "topology.json").read_text()))


def face(topo: Topology, tag: int) -> TopologyFace:
    return next(f for f in topo.faces if f.tag == tag)


def test_two_blocks_touching_face_to_face_are_one_bond(tmp_path: Path) -> None:
    topo = detect(tmp_path, two_blocks(tmp_path / "pair.step"))
    assert topo.bond_tolerance == pytest.approx(topo.size * BOND_TOLERANCE_FRACTION)
    assert topo.bonds is not None and len(topo.bonds) == 1
    bond = topo.bonds[0]
    assert bond.bodies == [1, 2]
    a, b = (face(topo, t) for t in bond.faces)
    assert a.bodies == [1] and b.bodies == [2]
    # Both are the 20 x 20 mm faces at x = 50 mm.
    assert a.centroid[0] == pytest.approx(50 * MM) and b.centroid[0] == pytest.approx(50 * MM)
    assert bond.area == pytest.approx(400 * MM**2, rel=1e-6)
    assert bond.gap <= 1e-9


def test_a_block_overhanging_a_plate_bonds_over_the_overlap_only(tmp_path: Path) -> None:
    topo = detect(tmp_path, bond_model(tmp_path / "plate.step", "block_on_plate"))
    assert topo.bonds is not None
    # The overhanging block touches the plate's top over 40 x 40 mm; the third block, touching
    # the plate only along an edge, and the side faces the overhang passes are not bonds.
    assert len(topo.bonds) == 1
    bond = topo.bonds[0]
    assert bond.bodies == [1, 2]
    # Sampled on the tessellation: triangles crossing the overlap's edges are left out.
    assert 0.8 * 1600 * MM**2 <= bond.area <= 1.001 * 1600 * MM**2


def test_a_modelled_clearance_is_not_a_bond(tmp_path: Path) -> None:
    topo = detect(tmp_path, bond_model(tmp_path / "gap.step", "blocks_with_gap"))
    assert topo.bonds == []
    assert topo.bond_tolerance is not None and topo.bond_tolerance < 0.5 * MM


def test_a_line_contact_is_not_a_bond(tmp_path: Path) -> None:
    topo = detect(tmp_path, bond_model(tmp_path / "rod.step", "cylinder_on_plate"))
    assert topo.bonds == []


def test_a_pin_in_a_hole_bonds_over_the_hole(tmp_path: Path) -> None:
    topo = detect(tmp_path, bond_model(tmp_path / "pin.step", "pin_in_hole"))
    assert topo.bonds is not None and len(topo.bonds) == 1
    bond = topo.bonds[0]
    assert {face(topo, t).type for t in bond.faces} == {"cylinder"}
    # The hole's whole face: 2 pi r h with r = 10 mm, h = 20 mm.
    assert bond.area == pytest.approx(2 * math.pi * 10 * 20 * MM**2, rel=0.01)


def test_a_pad_on_a_curved_shell_bonds_on_both_sides_of_the_seam(tmp_path: Path) -> None:
    topo = detect(tmp_path, bond_model(tmp_path / "pad.step", "pad_on_shell"))
    assert topo.bonds is not None and len(topo.bonds) == 2
    # The pad's inner face, radius 200 mm, 100 mm tall, spanning 2 asin(60/200).
    whole = 200 * 2 * math.asin(60 / 200) * 100 * MM**2
    assert sum(b.area for b in topo.bonds) == pytest.approx(whole, rel=0.01)
    shell = {b.faces[0] for b in topo.bonds}
    assert len(shell) == 1 and face(topo, shell.pop()).type == "cylinder"


def test_a_single_body_has_no_bonds(tmp_path: Path) -> None:
    topo = detect(tmp_path, block_with_hole(tmp_path / "block.step"))
    assert topo.bonds == []


def test_boxes_meet_within_the_tolerance() -> None:
    a = [0, 0, 0, 1, 1, 1]
    assert boxes_meet(a, [1, 0, 0, 2, 1, 1], 0)
    assert not boxes_meet(a, [1.1, 0, 0, 2, 1, 1], 0.05)
    assert boxes_meet(a, [1.1, 0, 0, 2, 1, 1], 0.1)
    assert not boxes_meet(a, [0, 0, 1.5, 1, 1, 2], 0.1)


def _face(tag: int, bodies: list[int], bbox: list[float]) -> TopologyFace:
    return TopologyFace(
        tag=tag,
        type="plane",
        gmshType="Plane",
        area=1,
        centroid=[0, 0, 0],
        bbox=bbox,
        bodies=bodies,
    )


def test_candidate_pairs_join_faces_of_different_bodies_only() -> None:
    box = [0.0, 0, 0, 1, 1, 0]
    far = [5.0, 5, 5, 6, 6, 5]
    faces = [
        _face(3, [2], box),
        _face(1, [1], box),
        _face(2, [1], box),  # same body as face 1
        _face(4, [1, 2], box),  # shared by both bodies: already joined
        _face(5, [3], far),
    ]
    assert candidate_pairs(faces, 1e-6) == [(1, 3), (2, 3)]


def test_triangle_areas_and_centroids() -> None:
    patch = FacePatch(1, [0, 0, 0, 2, 0, 0, 0, 3, 0, 2, 3, 0], [0, 1, 2, 1, 3, 2])
    assert triangle_areas(patch) == pytest.approx([3, 3])
    assert triangle_centroids(patch) == pytest.approx([2 / 3, 1, 0, 4 / 3, 2, 0])
