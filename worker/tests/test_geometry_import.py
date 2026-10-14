# SPDX-License-Identifier: AGPL-3.0-or-later
"""The import job's geometry step on models written for these tests (needs Gmsh)."""

import json
import math
from pathlib import Path

import pytest

from clearfea_worker.geometry.display import FacePatch, read_display
from clearfea_worker.geometry.importer import ImportFailure, import_geometry
from clearfea_worker.spec.geometry_schema import Topology

from .step_models import block_with_hole, plate_surface, with_length_unit

#: Re-imports of the same file with the same versions agree exactly (ADR-023); allow rounding.
SAME = 1e-12


@pytest.fixture(scope="module")
def mm_step(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return block_with_hole(tmp_path_factory.mktemp("models") / "block.step")


def variant(mm_step: Path, tmp_path: Path, unit: str) -> Path:
    path = tmp_path / f"block_{unit}.step"
    path.write_text(with_length_unit(mm_step.read_text(), unit))
    return path


def load(out: Path) -> Topology:
    return Topology.model_validate(json.loads((out / "topology.json").read_text()))


def triangle_area(p: FacePatch, k: int) -> float:
    a, b, c = (
        p.positions[3 * p.triangles[3 * k + i] : 3 * p.triangles[3 * k + i] + 3] for i in range(3)
    )
    u = [b[i] - a[i] for i in range(3)]
    v = [c[i] - a[i] for i in range(3)]
    cross = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
    return 0.5 * math.hypot(*cross)


def assert_same_geometry(a: Topology, b: Topology) -> None:
    assert [f.tag for f in a.faces] == [f.tag for f in b.faces]
    for fa, fb in zip(a.faces, b.faces, strict=True):
        assert fa.gmsh_type == fb.gmsh_type
        assert fb.area == pytest.approx(fa.area, rel=SAME)
        for ca, cb in zip(fa.centroid, fb.centroid, strict=True):
            assert abs(ca - cb) <= SAME * a.size


def test_imports_a_millimetre_file_in_metres(mm_step: Path, tmp_path: Path) -> None:
    output = import_geometry(mm_step, tmp_path, None)
    result = output.result
    assert result.unit.detected_unit == "mm"
    assert result.unit.reading_factor == 0.001
    assert result.scaling == 1.0
    assert (result.bodies, result.faces) == (1, 7)
    topo = load(tmp_path)
    assert topo.software.gmsh == "4.15.2"
    assert topo.bodies[0].volume == pytest.approx((0.1 * 0.05 - math.pi * 0.01**2) * 0.02, rel=1e-9)
    assert sorted(f.type for f in topo.faces) == ["cylinder"] + ["plane"] * 6
    # OpenCASCADE pads bounding boxes by its tolerance, 1e-7 m here.
    assert topo.bbox == pytest.approx([0, 0, 0, 0.1, 0.05, 0.02], abs=2e-7)


def test_display_mesh_covers_every_face(mm_step: Path, tmp_path: Path) -> None:
    output = import_geometry(mm_step, tmp_path, None)
    topo = load(tmp_path)
    patches = {p.tag: p for p in read_display(output.display_path)}
    assert sorted(patches) == sorted(f.tag for f in topo.faces)
    assert sum(len(p.triangles) // 3 for p in patches.values()) == output.result.display_triangles
    for face in topo.faces:
        patch = patches[face.tag]
        area = sum(triangle_area(patch, k) for k in range(len(patch.triangles) // 3))
        # The four side faces have straight edges and are tessellated exactly (float32
        # positions); the hole's polygon cuts corners, so faces bounded by it differ a little.
        side = face.type == "plane" and face.bbox[5] - face.bbox[2] > 0.01
        if side:
            assert area == pytest.approx(face.area, rel=1e-5)
        assert area == pytest.approx(face.area, rel=0.01)


def test_reads_an_inch_file_as_inches(mm_step: Path, tmp_path: Path) -> None:
    import_geometry(mm_step, tmp_path / "mm", None)
    inch = import_geometry(variant(mm_step, tmp_path, "in"), tmp_path / "in", None).result
    assert inch.unit.detected_unit == "in"
    for a, b in zip(load(tmp_path / "mm").faces, load(tmp_path / "in").faces, strict=True):
        assert b.area == pytest.approx(a.area * 25.4**2, rel=SAME)


def test_a_corrected_unit_is_applied_by_reimporting(mm_step: Path, tmp_path: Path) -> None:
    import_geometry(mm_step, tmp_path / "mm", None)
    # The file says inches; the user says it is really millimetres.
    inch = variant(mm_step, tmp_path, "in")
    result = import_geometry(inch, tmp_path / "fixed", "mm").result
    assert result.scaling == pytest.approx(1 / 25.4, rel=SAME)
    assert_same_geometry(load(tmp_path / "mm"), load(tmp_path / "fixed"))


def test_a_file_without_a_unit_is_read_as_metres_until_the_user_chooses(
    mm_step: Path, tmp_path: Path
) -> None:
    """Pins the OpenCASCADE behaviour ADR-024 relies on: no declared unit reads as metres."""
    import_geometry(mm_step, tmp_path / "mm", None)
    bare = variant(mm_step, tmp_path, "none")
    first = import_geometry(bare, tmp_path / "bare", None).result
    assert first.unit.detected_unit is None
    assert first.unit.declared is None
    assert first.unit.reading_factor == 1.0
    assert load(tmp_path / "bare").bbox == pytest.approx([0, 0, 0, 100, 50, 20], abs=2e-7)
    chosen = import_geometry(bare, tmp_path / "chosen", "mm").result
    assert chosen.scaling == pytest.approx(0.001, rel=SAME)
    assert_same_geometry(load(tmp_path / "mm"), load(tmp_path / "chosen"))


def test_refuses_a_unit_it_cannot_scale(mm_step: Path, tmp_path: Path) -> None:
    with pytest.raises(ImportFailure) as failure:
        import_geometry(variant(mm_step, tmp_path, "um"), tmp_path / "out", None)
    assert failure.value.cause == "unit_unreadable"
    assert "Export the file again" in failure.value.message


def test_refuses_a_file_without_solids(tmp_path: Path) -> None:
    with pytest.raises(ImportFailure) as failure:
        import_geometry(plate_surface(tmp_path / "plate.step"), tmp_path / "out", None)
    assert failure.value.cause == "no_solids"


@pytest.mark.parametrize(
    ("content", "cause"),
    [
        ("solid cube\nendsolid cube\n", "not_step"),
        ("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1 = BROKEN(;\nENDSEC;\n", "step_unreadable"),
    ],
)
def test_refuses_files_that_are_not_usable_step(tmp_path: Path, content: str, cause: str) -> None:
    path = tmp_path / "bad.step"
    path.write_text(content)
    with pytest.raises(ImportFailure) as failure:
        import_geometry(path, tmp_path / "out", None)
    assert failure.value.cause == cause
