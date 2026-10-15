# SPDX-License-Identifier: AGPL-3.0-or-later
"""Fast tests of the verification harness: its file readers, face naming, setup and checks.

No API, worker or solver: those run in `make verify`.
"""

import json
import math
import re
from pathlib import Path

import pytest

from harness.binfiles import read_fields, read_surface
from harness.cases import (
    Box,
    Case,
    CaseError,
    Check,
    applied_load,
    build_spec,
    evaluate,
    load_case,
    name_faces,
    unexpected_warnings,
)

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = ROOT / "packages" / "spec" / "fixtures"
CASES = ROOT / "verification" / "cases"


def surface():  # type: ignore[no-untyped-def]
    # Face 7: the 0.1 x 0.05 m rectangle at z = 0, facing +z; face 3: a triangle at z = 0.02.
    return read_surface((FIXTURES / "display-two-faces.bin").read_bytes())


# --- File readers, against the fixtures the worker's writers and the web readers share ---


def test_reads_the_shared_display_fixture() -> None:
    s = surface()
    assert [(p.tag, p.vertex_count, len(p.triangles)) for p in s.patches] == [(3, 3, 1), (7, 4, 2)]
    assert s.positions[5] == pytest.approx((0.1, 0.05, 0.0))
    assert s.patches[1].triangles == [(3, 4, 5), (3, 5, 6)]


def test_reads_the_shared_fields_fixture() -> None:
    fields = read_fields((FIXTURES / "result-fields-three-vertices.bin").read_bytes(), 3)
    assert fields["displacement"][1] == pytest.approx((1e-3, -2e-3, 0.5e-3))
    assert [v[0] for v in fields["vonMises"]] == pytest.approx([1.5e6, 2.5e8, 0.0])


def test_refuses_fields_for_another_surface() -> None:
    with pytest.raises(ValueError, match="3 vertices but surface.bin has 7"):
        read_fields((FIXTURES / "result-fields-three-vertices.bin").read_bytes(), 7)


# --- Cases ---


def small_case(**changes) -> Case:  # type: ignore[no-untyped-def]
    values = {
        "id": "V-00",
        "title": "Test",
        "folder": Path("."),
        "unit": "mm",
        "faces": {
            "plate": Box((0, 0, 0), (0.1, 0.05, 0)),
            "corner": Box((0, 0, 0.02), (0.1, 0.05, 0.02)),
        },
        "mesh": {"coarse": {"value": 5, "unit": "mm"}, "full": {"value": 2, "unit": "mm"}},
        "checks": [],
        "allowed_warnings": [],
        "spec": {
            "supports": [{"id": "fixed-1", "faces": ["plate"]}],
            "loads": [
                {"id": "pressure-1", "faces": ["corner"], "magnitude": {"value": 2, "unit": "bar"}}
            ],
            "mesh": {"size": {"value": 1, "unit": "mm"}},
        },
    }
    values.update(changes)
    return Case(**values)


TOPOLOGY = {
    "faces": [
        {"tag": 7, "bbox": [-1e-7, -1e-7, -1e-7, 0.1000001, 0.0500001, 1e-7]},
        {"tag": 3, "bbox": [-1e-7, -1e-7, 0.0199999, 0.1000001, 0.0500001, 0.0200001]},
    ]
}


def test_names_faces_by_their_bounding_box() -> None:
    assert name_faces(small_case(), TOPOLOGY) == {"plate": 7, "corner": 3}


def test_refuses_a_face_box_that_matches_no_face() -> None:
    case = small_case(faces={"plate": Box((0, 0, 0), (0.1, 0.06, 0))})
    with pytest.raises(CaseError, match="exactly one face"):
        name_faces(case, TOPOLOGY)


def test_builds_the_spec_with_tags_geometry_and_the_tier_mesh_size() -> None:
    case = small_case()
    spec = build_spec(case, {"plate": 7, "corner": 3}, "g-1", "full")
    assert spec["geometryId"] == "g-1"
    assert spec["supports"][0]["faces"] == [7]
    assert spec["loads"][0]["faces"] == [3]
    assert spec["mesh"] == {"size": {"value": 2, "unit": "mm"}}
    assert case.spec["supports"][0]["faces"] == ["plate"]  # the case itself is unchanged


def test_applied_load_pushes_against_the_outward_normal() -> None:
    spec = build_spec(small_case(), {"plate": 7, "corner": 3}, "g", "coarse")
    spec["loads"][0]["faces"] = [7]
    total, gross = applied_load(spec, surface())
    area = 0.1 * 0.05
    # float32 positions: 1e-7 relative.
    assert total == pytest.approx([0, 0, -2e5 * area], rel=1e-6, abs=1e-6)
    assert gross == pytest.approx(2e5 * area, rel=1e-6)


def test_evaluates_the_mean_over_a_face_inside_a_box() -> None:
    s = surface()
    n = len(s.positions)
    fields = {
        "displacement": [(0.001 * v, 0.0, 0.0) for v in range(n)],
        "vonMises": [(10.0 * v,) for v in range(n)],
    }
    check = Check("x", "vonMises", "plate", Box((0.05, 0, 0), (0.1, 0.05, 0)), 1.0, "Pa", {})
    # Face 7's vertices with x >= 0.05: vertices 4 and 5 of the file.
    assert evaluate(check, s, fields, {"plate": 7}) == (pytest.approx(45.0), 2)
    # Vertex 4 at (0.1, 0, 0) moves 0.004 m along x, which is radial there.
    radial = Check("r", "displacement.radial", "plate", Box((0.1, 0, 0), (0.1, 0, 0)), 1, "m", {})
    assert evaluate(radial, s, fields, {"plate": 7}) == (pytest.approx(0.004), 1)


def test_reports_warnings_the_case_does_not_expect() -> None:
    log = "ok\n *WARNING in e_c3d: nonpositive jacobian\n *warning: expected one\n"
    assert unexpected_warnings(log, [re.compile("expected one")]) == [
        "*WARNING in e_c3d: nonpositive jacobian"
    ]


# --- The committed cases load, and their reference values follow from their formulas ---


@pytest.mark.parametrize("folder", sorted(p for p in CASES.iterdir() if p.is_dir()))
def test_every_case_folder_is_complete(folder: Path) -> None:
    for name in ("case.yaml", "spec.json", "geometry.py", "reference.md"):
        assert (folder / name).is_file(), f"{folder.name} has no {name}"
    case = load_case(folder)
    assert folder.name.startswith(case.id + "-")
    faces = {f for item in case.spec["supports"] + case.spec["loads"] for f in item["faces"]}
    assert faces <= set(case.faces)


def by_name(case: Case) -> dict[str, Check]:
    return {c.name: c for c in case.checks}


def test_v01_references_are_lame_with_open_ends() -> None:
    case = load_case(CASES / "V-01-thick-cylinder")
    spec = case.spec
    assert spec["loads"][0]["magnitude"] == {"value": 100, "unit": "bar"}
    p, ri, ro, e, nu = 10e6, 0.04, 0.06, 200e9, spec["materials"][0]["poissonsRatio"]
    a = p * ri**2 / (ro**2 - ri**2)
    b = a * ro**2
    checks = by_name(case)
    for r, face in ((ri, "bore"), (ro, "outside")):
        sr, st = a - b / r**2, a + b / r**2  # sigma_z = 0 with an open end
        mises = math.sqrt(0.5 * ((sr - st) ** 2 + st**2 + sr**2))
        u = r * (st - nu * sr) / e
        [stress] = [c for c in checks.values() if c.face == face and c.quantity == "vonMises"]
        [radial] = [c for c in checks.values() if c.face == face and c.quantity != "vonMises"]
        assert stress.reference == pytest.approx(mises, rel=1e-5)
        assert radial.reference == pytest.approx(u, rel=1e-5)


def test_v02_references_are_timoshenko_beam_values() -> None:
    case = load_case(CASES / "V-02-cantilever")
    inch, psi = 0.0254, 6894.757293168362
    e, nu = 29000e3 * psi, case.spec["materials"][0]["poissonsRatio"]
    length, a, side = 10 * inch, 1 * inch, 1 * inch
    w = 500 * psi * side  # line load on the last inch
    load = w * a
    i = side**4 / 12
    b = length - a
    bending = w / (24 * e * i) * (3 * length**4 - 4 * b**3 * length + b**4)
    shear = load * (length - a / 2) / (5 / 6 * e / (2 * (1 + nu)) * side**2)
    stress = load * (length / 2 - a / 2) * (side / 2) / i
    checks = by_name(case)
    assert checks["Tip deflection (mean over the free end)"].reference == pytest.approx(
        -(bending + shear), rel=1e-5
    )
    for name in ("Bending stress on top at mid-length", "Bending stress underneath at mid-length"):
        assert checks[name].reference == pytest.approx(stress, rel=1e-6)


def test_spec_templates_use_mixed_units() -> None:
    units = set()
    for folder in CASES.iterdir():
        spec = json.loads((folder / "spec.json").read_text())
        units |= {
            spec["materials"][0]["youngsModulus"]["unit"],
            spec["loads"][0]["magnitude"]["unit"],
        }
        units.add(load_case(folder).unit)
    assert {"GPa", "bar", "mm", "ksi", "psi", "in"} <= units
