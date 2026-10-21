# SPDX-License-Identifier: AGPL-3.0-or-later
"""Fast tests of the verification harness: its file readers, face naming, setup and checks.

No API, worker or solver: those run in `make verify`.
"""

import copy
import json
import math
import re
import struct
from pathlib import Path

import pytest
from clearfea_worker.units import to_si

from harness.binfiles import Patch, Surface, read_fields, read_mesh_positions, read_surface
from harness.cases import (
    Box,
    Case,
    CaseError,
    Check,
    _value,
    applied_heat,
    applied_load,
    balance,
    build_spec,
    distance_integral,
    evaluate,
    evaluate_inside,
    frequency_error,
    heat_flow,
    load_case,
    name_edges,
    name_faces,
    reaction,
    unexpected_warnings,
    volume_and_moment,
)

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = ROOT / "packages" / "spec" / "fixtures"
CASES = ROOT / "verification" / "cases"
ACCEPTANCE = ROOT / "verification" / "acceptance"


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
                {
                    "id": "pressure-1",
                    "type": "pressure",
                    "faces": ["corner"],
                    "magnitude": {"value": 2, "unit": "bar"},
                }
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


def test_names_a_supports_edges_by_their_bounding_box() -> None:
    """Supports on edges (ADR-105): case.yaml names edges by box as it names faces."""
    topology = TOPOLOGY | {
        "edges": [
            {"tag": 4, "bbox": [-1e-7, -1e-7, -1e-7, 0.1000001, 1e-7, 1e-7]},
            {"tag": 5, "bbox": [-1e-7, -1e-7, -1e-7, 1e-7, 0.0500001, 1e-7]},
        ]
    }
    spec = copy.deepcopy(small_case().spec)
    spec["supports"][0] |= {"faces": [], "edges": ["front"]}
    case = small_case(spec=spec, edges={"front": Box((0, 0, 0), (0.1, 0, 0))})
    tags = name_edges(case, topology)
    assert tags == {"front": 4}
    built = build_spec(case, name_faces(case, topology), "g", "full", tags)
    assert (built["supports"][0]["faces"], built["supports"][0]["edges"]) == ([], [4])
    with pytest.raises(CaseError, match="unknown edges"):
        build_spec(case, name_faces(case, topology), "g", "full", {})
    with pytest.raises(CaseError, match="exactly one edge"):
        name_edges(case, TOPOLOGY)


def test_builds_the_spec_with_tags_geometry_and_the_tier_mesh_size() -> None:
    case = small_case()
    spec = build_spec(case, {"plate": 7, "corner": 3}, "g-1", "full")
    assert spec["geometryId"] == "g-1"
    assert spec["supports"][0]["faces"] == [7]
    assert spec["loads"][0]["faces"] == [3]
    assert spec["mesh"] == {"size": {"value": 2, "unit": "mm"}}
    assert case.spec["supports"][0]["faces"] == ["plate"]  # the case itself is unchanged


def test_builds_local_mesh_sizes_with_face_tags_and_tier_sizes() -> None:
    spec = small_case().spec | {
        "mesh": {
            "size": {"value": 1, "unit": "mm"},
            "order": 1,
            "local": [
                {"id": "fine", "name": "Fine", "scope": "faces", "tags": ["corner"], "size": None},
                {
                    "id": "body",
                    "name": "Body",
                    "scope": "bodies",
                    "tags": [1],
                    "size": {"value": 3, "unit": "mm"},
                },
            ],
        }
    }
    mesh = small_case().mesh | {
        "local": {
            "fine": {"coarse": {"value": 1, "unit": "mm"}, "full": {"value": 0.5, "unit": "mm"}}
        }
    }
    built = build_spec(small_case(spec=spec, mesh=mesh), {"plate": 7, "corner": 3}, "g", "full")
    assert built["mesh"] == {
        "size": {"value": 2, "unit": "mm"},
        "order": 1,
        "local": [
            {
                "id": "fine",
                "name": "Fine",
                "scope": "faces",
                "tags": [3],
                "size": {"value": 0.5, "unit": "mm"},
            },
            {
                "id": "body",
                "name": "Body",
                "scope": "bodies",
                "tags": [1],
                "size": {"value": 3, "unit": "mm"},
            },
        ],
    }


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


def test_evaluates_tensor_components_and_principal_stresses_by_name() -> None:
    s = surface()
    n = len(s.positions)
    fields = {
        "displacement": [(0.0, 0.0, 0.0)] * n,
        "vonMises": [(0.0,)] * n,
        "stress": [(1.0, 2.0, 3.0, 4.0, 5.0, 6.0 * v) for v in range(n)],
        "principalStress": [(30.0, 20.0, 10.0 * v) for v in range(n)],
        "strain": [(0.1, 0.2, 0.3, 0.4, 0.5, 0.6) for v in range(n)],
    }
    box = Box((0.05, 0, 0), (0.1, 0.05, 0))  # vertices 4 and 5 of face 7

    def mean(quantity: str) -> float:
        check = Check("c", quantity, "plate", box, 1.0, "Pa", {})
        return evaluate(check, s, fields, {"plate": 7})[0]

    assert mean("stress.xy") == pytest.approx(4.0)
    assert mean("stress.zx") == pytest.approx(27.0)
    assert mean("principal.1") == pytest.approx(30.0)
    assert mean("principal.3") == pytest.approx(45.0)
    assert mean("strain.yz") == pytest.approx(0.5)


def test_reads_a_reaction_component_of_the_named_support() -> None:
    check = Check("r", "reaction.y", None, None, 1.0, "N", {"coarse": 0.1, "full": 0.1}, "b")
    reactions = [{"supportId": "a", "force": [1, 2, 3]}, {"supportId": "b", "force": [4, 5, 6]}]
    assert reaction(check, reactions) == 5.0


def test_reads_a_reaction_moment_component_and_refuses_a_run_without_moments() -> None:
    check = Check("m", "moment.z", None, None, 1.0, "N·m", {"coarse": 0.1, "full": 0.1}, "b")
    reactions = [{"supportId": "b", "force": [4, 5, 6], "moment": [7, 8, 9], "point": [0, 0, 0]}]
    assert reaction(check, reactions) == 9.0
    with pytest.raises(CaseError, match="no reaction moment for support b"):
        reaction(check, [{"supportId": "b", "force": [4, 5, 6]}])


def test_balance_without_a_load_is_measured_against_the_reactions() -> None:
    assert balance([0.0, 0.0, -10.0], 10.0, [[0.0, 0.0, 9.0]]) == pytest.approx((1.0, 10.0))
    miss, size = balance(
        [0.0, 0.0, 0.0], 0.0, [[3.0, 0.0, 0.0], [-3.0, 0.0, 0.0], [0.0, 0.0, 1e-3]]
    )
    assert (miss, size) == pytest.approx((1e-3, 6.001))


def test_balance_without_a_load_on_free_supports_is_measured_against_their_nodal_forces() -> None:
    # A body heated on symmetry planes: each support's total is rounding, its nodes are not.
    reactions = [[1e-3, 0.0, 0.0], [0.0, -2e-3, 0.0]]
    assert balance([0.0, 0.0, 0.0], 0.0, reactions, 5e5) == pytest.approx(
        (math.hypot(1e-3, 2e-3), 5e5)
    )
    # With a load the run's nodal scale plays no part.
    assert balance([0.0, 0.0, -10.0], 10.0, [[0.0, 0.0, 9.0]], 5e5)[1] == 10.0


def test_a_reaction_check_must_name_a_support_of_the_spec(tmp_path: Path) -> None:
    folder = tmp_path / "V-99-x"
    folder.mkdir()
    (folder / "spec.json").write_text(json.dumps({"supports": [{"id": "end"}], "loads": []}))
    raw = (
        "id: V-99\ntitle: x\ngeometry: {unit: mm}\nfaces: {}\n"
        "mesh: {coarse: {value: 1, unit: mm}, full: {value: 1, unit: mm}}\n"
        "checks:\n  - {name: r, quantity: reaction.x, support: start,"
        " reference: {value: 1, unit: kN}, tolerance: {coarse: 0.1, full: 0.1}}\n"
    )
    (folder / "case.yaml").write_text(raw)
    with pytest.raises(CaseError, match="must name a support id"):
        load_case(folder)
    (folder / "case.yaml").write_text(raw.replace("support: start", "support: end"))
    assert load_case(folder).checks[0].reference == 1000.0


def test_a_check_inside_the_body_needs_a_box_and_no_face(tmp_path: Path) -> None:
    folder = tmp_path / "V-99-x"
    folder.mkdir()
    (folder / "spec.json").write_text(json.dumps({"supports": [], "loads": []}))
    raw = (
        "id: V-99\ntitle: x\ngeometry: {unit: mm}\nfaces: {}\n"
        "mesh: {coarse: {value: 1, unit: mm}, full: {value: 1, unit: mm}}\n"
        "checks:\n  - {name: s, quantity: stress.zz, inside: true,"
        " reference: {value: 1, unit: MPa}, tolerance: {coarse: 0.1, full: 0.1}}\n"
    )
    (folder / "case.yaml").write_text(raw)
    with pytest.raises(CaseError, match="needs a box and no face"):
        load_case(folder)
    (folder / "case.yaml").write_text(
        raw.replace("inside: true,", "inside: true, box: {min: [0, 0, 0], max: [1, 1, 1]},")
    )
    check = load_case(folder).checks[0]
    assert check.inside and check.face is None and check.box is not None


def _mesh_bin(positions: list[tuple[float, float, float]]) -> bytes:
    """A mesh.bin of first-order elements over the nodes (volume-mesh.md), one element."""
    header = struct.pack("<4sIIIIIII", b"CFVM", 1, 1, len(positions), 1, 0, 0, 0)
    flat = [x for p in positions for x in p]
    return header + struct.pack(f"<{len(flat)}d", *flat) + struct.pack("<4I", 0, 1, 2, 3)


def test_evaluates_the_mean_over_the_mesh_nodes_inside_a_box() -> None:
    positions = [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)]
    assert read_mesh_positions(_mesh_bin(positions)) == positions
    with pytest.raises(ValueError, match="length does not match"):
        read_mesh_positions(_mesh_bin(positions)[:-4])
    fields = {
        "displacement": [(0.0, 0.0, 0.0)] * 4,
        "stress": [(0, 0, 10.0 * n, 0, 0, 0) for n in range(4)],
    }
    check = Check("s", "stress.zz", None, Box((0, 0, 0), (1, 1, 0)), 1.0, "Pa", {}, inside=True)
    # Nodes 0, 1 and 2 lie in the box z = 0.
    assert evaluate_inside(check, positions, fields) == (pytest.approx(10.0), 3)
    far = Check("s", "stress.zz", None, Box((5, 5, 5), (6, 6, 6)), 1.0, "Pa", {}, inside=True)
    with pytest.raises(CaseError, match="No mesh node"):
        evaluate_inside(far, positions, fields)


def test_reports_warnings_the_case_does_not_expect() -> None:
    log = "ok\n *WARNING in e_c3d: nonpositive jacobian\n *warning: expected one\n"
    assert unexpected_warnings(log, [re.compile("expected one")]) == [
        "*WARNING in e_c3d: nonpositive jacobian"
    ]


def box_surface(lo: tuple[float, ...], hi: tuple[float, ...]) -> Surface:
    """A closed box as twelve outward-facing triangles, one patch per face (tags 1 to 6)."""
    corners = [(x, y, z) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
    # Corner k has x from bit 2, y from bit 1, z from bit 0; each face counter-clockwise from
    # outside.
    quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    patches = [Patch(k + 1, 0, 8, [(a, b, c), (a, c, d)]) for k, (a, b, c, d) in enumerate(quads)]
    return Surface(corners, patches)


def body_spec(loads: list[dict]) -> dict:
    return {
        "bodies": [{"tag": 1, "material": "m"}],
        "materials": [{"id": "m", "density": {"value": 2.7, "unit": "g/cm³"}}],
        "loads": loads,
    }


def test_volume_and_moment_of_a_box() -> None:
    volume, moment = volume_and_moment(box_surface((0.1, 0, 0), (0.3, 0.1, 0.05)))
    assert volume == pytest.approx(0.2 * 0.1 * 0.05, rel=1e-12)
    assert moment == pytest.approx([volume * 0.2, volume * 0.05, volume * 0.025], rel=1e-12)


def test_applied_load_adds_forces_weight_and_spin() -> None:
    surface = box_surface((0.1, 0, 0), (0.3, 0.1, 0.05))
    volume = 0.2 * 0.1 * 0.05
    mass = 2700 * volume
    spec = body_spec(
        [
            {
                "type": "force",
                "x": {"value": 1, "unit": "kN"},
                "y": {"value": 0, "unit": "N"},
                "z": {"value": 0, "unit": "N"},
            },
            {
                "type": "gravity",
                "x": {"value": 0, "unit": "g"},
                "y": {"value": 0, "unit": "g"},
                "z": {"value": -1, "unit": "g"},
            },
            {
                "type": "centrifugal",
                "angularVelocity": {"value": 60, "unit": "rpm"},
                "axisPoint": {
                    "x": {"value": 0, "unit": "mm"},
                    "y": {"value": 50, "unit": "mm"},
                    "z": {"value": 0, "unit": "mm"},
                },
                "axisDirection": {"x": 0, "y": 0, "z": 2},
            },
        ]
    )
    total, gross = applied_load(spec, surface)
    omega2 = (2 * math.pi) ** 2
    # The centroid is 0.2 m from the axis, along x.
    assert total == pytest.approx(
        [1000 + mass * omega2 * 0.2, 0, -mass * 9.80665], rel=1e-9, abs=1e-9
    )
    assert gross == pytest.approx(1000 + mass * 9.80665 + mass * omega2 * 0.2, rel=2e-3)


def test_a_temperature_change_applies_no_load() -> None:
    surface = box_surface((0, 0, 0), (0.1, 0.1, 0.1))
    spec = body_spec([{"type": "temperature", "change": {"value": 50, "unit": "°C"}}])
    assert applied_load(spec, surface) == ([0.0, 0.0, 0.0], 0.0)


def test_applied_load_adds_a_remote_loads_force_but_not_its_moment() -> None:
    surface = box_surface((0, 0, 0), (0.1, 0.1, 0.1))

    def xyz(x: float, y: float, z: float, unit: str) -> dict:
        return {a: {"value": v, "unit": unit} for a, v in zip("xyz", (x, y, z), strict=True)}

    spec = body_spec(
        [
            {
                "type": "remote",
                "point": xyz(1, 2, 3, "m"),
                "force": xyz(3, 0, -4, "kN"),
                "moment": xyz(100, 200, 300, "N·m"),
            }
        ]
    )
    total, gross = applied_load(spec, surface)
    assert total == pytest.approx([3000, 0, -4000], rel=1e-12)
    assert gross == pytest.approx(5000, rel=1e-12)


def test_applied_load_adds_a_hydrostatic_pressure_on_the_wet_part_only() -> None:
    # Water up to z = 0.06 m against the box's x = 0 face (0.1 wide in y, 0.1 tall in z) and
    # its bottom z = 0: rho g h^2/2 per unit width across, rho g h times the bottom upwards.
    surface = box_surface((0, 0, 0), (0.1, 0.1, 0.1))
    m = {"value": 0, "unit": "m"}
    spec = body_spec(
        [
            {
                "type": "hydrostatic",
                "faces": [1, 5],
                "fluidDensity": {"value": 1, "unit": "g/cm³"},
                "gravity": {
                    "x": {"value": 0, "unit": "g"},
                    "y": {"value": 0, "unit": "g"},
                    "z": {"value": -1, "unit": "g"},
                },
                "freeSurface": {"x": m, "y": m, "z": {"value": 6, "unit": "cm"}},
            }
        ]
    )
    total, gross = applied_load(spec, surface)
    g = 9.80665
    across, up = 1000 * g * 0.06**2 / 2 * 0.1, 1000 * g * 0.06 * 0.1 * 0.1
    assert total == pytest.approx([across, 0, up], rel=1e-12, abs=1e-12)
    assert gross == pytest.approx(across + up, rel=1e-12)


def test_distance_integral_about_an_axis_through_a_square_section() -> None:
    # A 2 x 2 square about its own axis, height 1: (4/3)(sqrt 2 + ln(1 + sqrt 2)) for a = 1.
    # The coarse box surface only gets near it with finer triangles, so check the far case
    # exactly and the near case loosely.
    surface = box_surface((-1, -1, 0), (1, 1, 1))
    exact = 4 / 3 * (math.sqrt(2) + math.log(1 + math.sqrt(2)))
    assert distance_integral(surface, [0, 0, 0], [0, 0, 1]) == pytest.approx(exact, rel=0.1)
    far = distance_integral(surface, [100, 0, 0], [0, 0, 1])
    assert far == pytest.approx(4 * 100, rel=1e-4)


# --- The committed cases load, and their reference values follow from their formulas ---


@pytest.mark.parametrize("folder", sorted(p for p in CASES.iterdir() if p.is_dir()))
def test_every_case_folder_is_complete(folder: Path) -> None:
    for name in ("case.yaml", "spec.json", "geometry.py", "reference.md"):
        assert (folder / name).is_file(), f"{folder.name} has no {name}"
    case = load_case(folder)
    assert folder.name.startswith(case.id + "-")
    items = case.spec["supports"] + case.spec["loads"]
    faces = {f for item in items for f in item.get("faces", [])}
    assert faces <= set(case.faces)


@pytest.mark.parametrize("folder", sorted(p for p in ACCEPTANCE.iterdir() if p.is_dir()))
def test_every_acceptance_model_is_complete(folder: Path) -> None:
    # model.md takes the place of reference.md: M9.5 and M9.6 own the acceptance checks.
    for name in ("case.yaml", "spec.json", "geometry.py", "model.md"):
        assert (folder / name).is_file(), f"{folder.name} has no {name}"
    case = load_case(folder)
    assert folder.name.startswith(case.id + "-")
    items = case.spec["supports"] + case.spec["loads"]
    faces = {f for item in items for f in item.get("faces", [])}
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
        [radial] = [
            c for c in checks.values() if c.face == face and c.quantity == "displacement.radial"
        ]
        assert stress.reference == pytest.approx(mises, rel=1e-5)
        assert radial.reference == pytest.approx(u, rel=1e-5)
        [first] = [c for c in checks.values() if c.face == face and c.quantity == "principal.1"]
        assert first.reference == pytest.approx(st, rel=1e-12)
        if face == "bore":
            # At 45 degrees: tau_xy = (sr - st) sin cos, and the tensor strain tau / 2G.
            shear = (sr - st) / 2
            assert checks["Shear stress τxy at 45 degrees on the bore"].reference == pytest.approx(
                shear, rel=1e-12
            )
            strain = checks["Shear strain εxy at 45 degrees on the bore (tensor, γxy / 2)"]
            assert strain.reference == pytest.approx(shear * (1 + nu) / e, rel=1e-12)


def test_v02_references_are_timoshenko_beam_values() -> None:
    case = load_case(CASES / "V-02-cantilever")
    inch, psi = 0.0254, 6894.757293168362
    e, nu = 29000e3 * psi, case.spec["materials"][0]["poissonsRatio"]
    length, a, side = 10 * inch, 1 * inch, 1 * inch
    lbf = 4.4482216152605
    force = case.spec["loads"][0]
    assert force["type"] == "force" and force["y"] == {"value": -500, "unit": "lbf"}
    load = 500 * lbf  # spread over the last inch of the top: a line load w = P / a
    w = load / a
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
    assert checks["Clamp carries the end load"].reference == pytest.approx(load, rel=1e-12)


def test_v10_references_are_a_column_under_its_weight() -> None:
    case = load_case(CASES / "V-10-self-weight")
    inch, lbf = 0.0254, 4.4482216152605
    density = case.spec["materials"][0]["density"]
    assert density == {"value": 0.284, "unit": "lb/in³"}
    rho = 0.284 * 0.45359237 / inch**3
    g = 9.80665
    e = 200e9
    side, height = 4 * inch, 40 * inch
    checks = by_name(case)
    weight = rho * g * side * side * height
    assert checks["Base carries the weight (ρ g A h)"].reference == pytest.approx(weight, rel=1e-12)
    assert weight / lbf == pytest.approx(0.284 * 4 * 4 * 40, rel=1e-12)  # lb times g is lbf
    assert checks["Axial stress at mid-height (ρ g h/2)"].reference == pytest.approx(
        rho * g * height / 2, rel=1e-12
    )
    inside = checks["Axial stress inside at quarter height (ρ g 3h/4)"]
    assert inside.inside and inside.face is None
    assert inside.reference == pytest.approx(-rho * g * height * 3 / 4, rel=1e-12)
    assert checks["Top shortens by ρ g h²/(2E)"].reference == pytest.approx(
        -rho * g * height**2 / (2 * e), rel=1e-5
    )


def test_v06_references_are_a_spinning_plane_stress_ring() -> None:
    case = load_case(CASES / "V-06-rotating-ring")
    rho, nu, e = 7850.0, case.spec["materials"][0]["poissonsRatio"], 210e9
    omega = 10000 * 2 * math.pi / 60
    a, b, t = 0.09, 0.1, 0.005
    k = rho * omega**2

    # Plane stress rotating disc with a hole (Timoshenko and Goodier, rotating discs).
    def hoop(r: float) -> float:
        c = (3 + nu) / 8 * k
        return c * (a * a + b * b + a * a * b * b / r**2 - (1 + 3 * nu) / (3 + nu) * r * r)

    checks = by_name(case)
    assert checks["Hoop stress outside, r = b"].reference == pytest.approx(hoop(b), rel=1e-5)
    assert checks["Hoop stress inside, r = a"].reference == pytest.approx(hoop(a), rel=1e-5)
    # The radial stress is zero on both faces, so u = r σθ / E there.
    assert checks["Radial growth outside (b σθ/E)"].reference == pytest.approx(
        b * hoop(b) / e, rel=1e-5
    )
    assert checks["Radial growth inside (a σθ/E)"].reference == pytest.approx(
        a * hoop(a) / e, rel=1e-5
    )
    force = k * t * (b**3 - a**3) / 3
    for axis in "xy":
        assert checks[f"Hoop force across the cut {axis} = 0"].reference == pytest.approx(
            -force, rel=1e-5
        )
    # The hoop force is also the hoop stress integrated over the cut: integral of σθ dr times t.
    steps = 2000
    dr = (b - a) / steps
    integral = sum(hoop(a + (k_ + 0.5) * dr) for k_ in range(steps)) * dr * t
    assert integral == pytest.approx(force, rel=1e-6)


def test_v09_references_are_the_full_tubes_lame_values() -> None:
    quarter, full = (
        load_case(CASES / "V-09-symmetry-tube"),
        load_case(CASES / "V-01-thick-cylinder"),
    )
    # V-01's von Mises and radial displacement checks; its M3.1 checks have no V-09 twin.
    for check in (c for c in full.checks if c.quantity in ("vonMises", "displacement.radial")):
        [same] = [
            c for c in quarter.checks if c.face == check.face and c.quantity == check.quantity
        ]
        assert same.reference == pytest.approx(check.reference, rel=1e-9)
    # Hoop force p a L across each cut face, along its outward normal.
    p, a, length = 10e6, 0.04, 0.1
    checks = by_name(quarter)
    for degrees, sign, plane in ((30, -1, "30°"), (120, 1, "120°")):
        t = math.radians(degrees)
        normal = (-sign * math.sin(t), sign * math.cos(t))
        for axis, component in zip("xy", normal, strict=True):
            check = checks[f"Hoop force on the {plane} plane, {axis}"]
            assert check.reference == pytest.approx(p * a * length * component, rel=1e-5)


def test_v24_references_are_a_uniformly_stretched_bar() -> None:
    case = load_case(CASES / "V-24-stretched-bar")
    inch, ksi = 0.0254, 6894757.293168362
    e, nu = 29000 * ksi, case.spec["materials"][0]["poissonsRatio"]
    strain = case.spec["supports"][1]["x"]["value"] / 1000 / (4 * inch)
    checks = by_name(case)
    assert checks["von Mises stress at the end (E ε)"].reference == pytest.approx(e * strain)
    assert checks["Side contracts in y (−ν ε y)"].reference == pytest.approx(
        -nu * strain * 0.5 * inch
    )
    assert checks["Force needed at the end (σ A)"].reference == pytest.approx(
        e * strain * (0.5 * inch) ** 2
    )
    for name in (
        "Normal stress σxx along the side (E ε)",
        "Largest principal stress along the side is σxx",
    ):
        assert checks[name].reference == pytest.approx(e * strain)
    assert checks["Axial strain along the side (δ / L)"].reference == pytest.approx(strain)
    assert checks["Lateral strain along the side (−ν ε)"].reference == pytest.approx(-nu * strain)


def test_v08_strain_references_are_the_total_strain() -> None:
    case = load_case(CASES / "V-08-heated-bar")
    material = case.spec["materials"][0]
    nu, alpha, dt = material["poissonsRatio"], 6.5e-6 * 1.8, 50.0
    assert material["thermalExpansion"] == {"value": 6.5, "unit": "µin/(in·°F)"}
    checks = by_name(case)
    for name in (
        "Total strain across the width (1 + nu) alpha dT",
        "Total strain through the thickness (1 + nu) alpha dT",
    ):
        assert checks[name].reference == pytest.approx((1 + nu) * alpha * dt, rel=1e-12)
    axial = checks["Axial stress σxx is compression −E alpha dT"].reference
    assert checks["Smallest principal stress is the axial compression"].reference == axial
    assert axial == pytest.approx(-29000e3 * 6894.757293168362 * alpha * dt, rel=1e-8)


def test_spec_templates_use_mixed_units() -> None:
    units = set()
    for folder in CASES.iterdir():
        spec = json.loads((folder / "spec.json").read_text())
        material = spec["materials"][0]
        # V-19 (M5.5) gives Young's modulus as a table against temperature only.
        units.add((material["youngsModulus"] or material["youngsModulusTable"])["unit"])
        if "density" in spec["materials"][0]:
            units.add(spec["materials"][0]["density"]["unit"])
        for load in spec["loads"]:
            units |= {v["unit"] for v in load.values() if isinstance(v, dict) and "unit" in v}
        units.add(load_case(folder).unit)
    assert {
        "GPa",
        "MPa",
        "bar",
        "mm",
        "ksi",
        "in",
        "lbf",
        "kip",
        "g",
        "rpm",
        "lb/in³",
        "t/mm³",
    } <= units


def test_evaluates_a_temperature_only_run() -> None:
    s = surface()
    n = len(s.positions)
    # A thermal run's fields hold the temperature only (M5.1): no displacement to read.
    fields = {"temperature": [(300.0 + v,) for v in range(n)]}
    check = Check("t", "temperature", "plate", Box((0.05, 0, 0), (0.1, 0.05, 0)), 1.0, "K", {})
    assert evaluate(check, s, fields, {"plate": 7}) == (pytest.approx(304.5), 2)


def test_v13_references_are_a_linear_profile_between_the_fixed_temperatures() -> None:
    case = load_case(CASES / "V-13-plane-wall")
    hot, cold = (300 + 459.67) * 5 / 9, 293.15
    assert [load["temperature"] for load in case.spec["loads"]] == [
        {"value": 300, "unit": "°F"},
        {"value": 20, "unit": "°C"},
    ]
    checks = by_name(case)
    assert checks["Hot face at 300 °F"].reference == pytest.approx(hot, rel=1e-9)
    assert checks["Cold face at 20 °C"].reference == pytest.approx(cold, rel=1e-12)
    for name, x in (
        ("A quarter of the way through, Th − (Th − Tc) / 4", 0.25),
        ("Halfway through, the mean of Th and Tc", 0.5),
        ("Three quarters of the way through, Tc + (Th − Tc) / 4", 0.75),
    ):
        assert checks[name].reference == pytest.approx(hot - (hot - cold) * x, rel=1e-8)


# --- Heat flux, heat flows and the heat balance (M5.3) ---


def test_evaluates_heat_flux_magnitude_and_components() -> None:
    s = surface()
    n = len(s.positions)
    fields = {"heatFlux": [(3.0, -4.0, 0.0)] * n}
    box = Box((0.05, 0, 0), (0.1, 0.05, 0))
    size = Check("q", "heatFlux", "plate", box, 1.0, "W/m²", {})
    along_y = Check("qy", "heatFlux.y", "plate", box, 1.0, "W/m²", {})
    assert evaluate(size, s, fields, {"plate": 7}) == (pytest.approx(5.0), 2)
    assert evaluate(along_y, s, fields, {"plate": 7}) == (pytest.approx(-4.0), 2)


def test_reads_a_loads_heat_flow_from_the_run() -> None:
    check = Check("q", "heatFlow", None, None, 1.0, "W", {}, load="hot")
    flows = [{"loadId": "cold", "heat": -5.0}, {"loadId": "hot", "heat": 5.0}]
    assert heat_flow(check, flows) == 5.0
    with pytest.raises(CaseError, match="no heat flow for load hot"):
        heat_flow(check, flows[:1])


def test_a_heat_flow_check_must_name_a_load(tmp_path: Path) -> None:
    folder = tmp_path / "V-99"
    folder.mkdir()
    (folder / "spec.json").write_text(json.dumps({"loads": [{"id": "hot"}], "supports": []}))
    (folder / "case.yaml").write_text(
        "id: V-99\ntitle: t\ngeometry: {unit: mm}\nfaces: {}\n"
        "mesh: {coarse: {value: 1, unit: mm}, full: {value: 1, unit: mm}}\n"
        "checks:\n  - {name: q, quantity: heatFlow, load: warm, reference: {value: 1, unit: W},"
        " tolerance: {coarse: 0.1, full: 0.1}}\n"
    )
    with pytest.raises(CaseError, match="must name a load id"):
        load_case(folder)


def test_applied_heat_is_flux_times_area_and_generation_times_volume() -> None:
    s = surface()
    area = 0.1 * 0.05  # face 7
    spec = {
        "bodies": [{"tag": 1}],
        "loads": [
            {"id": "q", "type": "heat_flux", "faces": [7], "flux": {"value": 2, "unit": "kW/m²"}},
            {"id": "t", "type": "fixed_temperature", "faces": [7]},
        ],
    }
    # float32 positions in surface.bin.
    assert applied_heat(spec, s) == {"q": pytest.approx(2000 * area, rel=1e-6)}


def test_thermal_cases_check_heat_flux_and_heat_flows_against_closed_forms() -> None:
    # V-13: k (Th − Tc) / L through the 40 mm wall, times its 60 × 60 mm faces.
    k = 26 * 1055.05585262 / (3600 * 0.3048) * 9 / 5
    q = k * ((300 + 459.67) * 5 / 9 - 293.15) / 0.04
    checks = by_name(load_case(CASES / "V-13-plane-wall"))
    assert checks["Heat flux along x, k (Th − Tc) / L"].reference == pytest.approx(q, rel=1e-8)
    assert checks["Heat flux magnitude at the cold face"].reference == pytest.approx(q, rel=1e-8)
    assert checks["Heat in through the hot face, q A"].reference == pytest.approx(
        q * 0.0036, rel=1e-8
    )
    assert checks["Heat out through the cold face, − q A"].reference == pytest.approx(
        -q * 0.0036, rel=1e-8
    )
    # V-15: the films and the wall in series.
    h2 = 20 * 1055.05585262 / (3600 * 0.3048**2) * 9 / 5
    q = 180 / (1 / 250 + 0.04 / 1.5 + 1 / h2)
    checks = by_name(load_case(CASES / "V-15-convection-wall"))
    assert checks["Heat flux along x, ΔT / (1/h1 + L/k + 1/h2)"].reference == pytest.approx(
        q, rel=1e-6
    )
    assert checks["Heat in from the hot gas, q A"].reference == pytest.approx(q * 0.0036, rel=1e-7)
    assert checks["Heat out to the room air, − q A"].reference == pytest.approx(
        -q * 0.0036, rel=1e-7
    )
    # V-16: what the heater brings in is radiated from the front face.
    q = 1500 * 1055.05585262 / (3600 * 0.3048**2)
    checks = by_name(load_case(CASES / "V-16-radiating-plate"))
    assert checks["Heat in from the heater, q A"].reference == pytest.approx(q * 0.0064, rel=1e-7)
    assert checks["Heat radiated to the room, − q A"].reference == pytest.approx(
        -q * 0.0064, rel=1e-7
    )
    # V-17: 0.01 W/mm³ in the 40 × 60 × 60 mm slab leaves through its two cooled faces.
    checks = by_name(load_case(CASES / "V-17-heat-generation"))
    assert checks["Heat out through the cooled faces, − q‴ V"].reference == pytest.approx(
        -1e7 * 0.04 * 0.0036, rel=1e-12
    )
    assert checks["Heat flux at the left face, − q‴ L"].reference == -1e7 * 0.02


# --- Modal cases (M6.1, ADR-070) ---


def _root(equation, lo: float, hi: float) -> float:  # type: ignore[no-untyped-def]
    """The root of ``equation`` between lo and hi, by bisection to the last bit."""
    for _ in range(200):
        mid = (lo + hi) / 2
        if (equation(lo) > 0) == (equation(mid) > 0):
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def _beam_roots(free_end: bool) -> list[float]:
    """βL of a cantilever (cos cosh = -1) or a clamped-clamped beam (cos cosh = 1)."""
    sign = 1.0 if free_end else -1.0

    def equation(x: float) -> float:
        return math.cos(x) * math.cosh(x) + sign

    starts = (1.0, 4.0, 7.0) if free_end else (4.0, 7.0, 10.0)
    return [_root(equation, a, a + 2.5) for a in starts]


def _bar_frequency(beta_l: float, depth: float, spec: dict) -> float:
    """Euler-Bernoulli frequency (Hz) of the 800 mm bar bending across ``depth`` (m)."""
    material = spec["materials"][0]
    e = to_si(material["youngsModulus"]["value"], material["youngsModulus"]["unit"], "pressure")
    rho = to_si(material["density"]["value"], material["density"]["unit"], "density")
    length = 0.8
    return beta_l**2 / (2 * math.pi * length**2) * math.sqrt(e * depth**2 / (12 * rho))


def test_modal_references_are_euler_bernoulli_beam_frequencies() -> None:
    cantilever, clamped = _beam_roots(True), _beam_roots(False)
    z, y = 0.008, 0.016
    expected = {
        "V-20-cantilever-frequencies": [
            (cantilever[0], z),
            (cantilever[0], y),
            (cantilever[1], z),
            (cantilever[1], y),
            (cantilever[2], z),
        ],
        "V-21-clamped-beam-frequencies": [(clamped[0], z), (clamped[0], y), (clamped[1], z)],
        # Free-free bending has the clamped-clamped roots; modes 1 to 6 are rigid-body modes.
        "V-22-free-body-modes": [*[None] * 6, (clamped[0], z), (clamped[0], y)],
    }
    for folder, modes in expected.items():
        case = load_case(CASES / folder)
        assert case.spec["analysis"] == "modal" and case.spec["modes"] == len(modes)
        frequencies = [c for c in case.checks if c.quantity == "frequency"]
        checks = sorted(frequencies, key=lambda c: c.mode or 0)
        assert [c.mode for c in checks] == list(range(1, len(modes) + 1))
        for check, mode in zip(checks, modes, strict=True):
            if mode is None:
                assert check.reference == 0.0 and check.relative_to == 7
                continue
            assert check.reference == pytest.approx(_bar_frequency(*mode, case.spec), rel=2e-8)


def _cantilever_shape(beta_l: float, x: float) -> float:
    """The Euler-Bernoulli cantilever's mode shape at x / L over its value at the tip."""
    sigma = (math.cosh(beta_l) + math.cos(beta_l)) / (math.sinh(beta_l) + math.sin(beta_l))

    def phi(t: float) -> float:
        b = beta_l * t
        return math.cosh(b) - math.cos(b) - sigma * (math.sinh(b) - math.sin(b))

    return phi(x) / phi(1.0)


def test_mode_shape_references_are_the_cantilevers_at_mid_span() -> None:
    # M6.2, ADR-071: mode 1 bends in z, mode 2 in y, mode 3 is the second bending mode in z.
    cantilever = _beam_roots(True)
    case = load_case(CASES / "V-20-cantilever-frequencies")
    shapes = {c.mode: c for c in case.checks if c.quantity.startswith("modeShape.")}
    expected = {1: ("z", cantilever[0]), 2: ("y", cantilever[0]), 3: ("z", cantilever[1])}
    assert sorted(shapes) == sorted(expected)
    for mode, (axis, beta_l) in expected.items():
        check = shapes[mode]
        assert check.quantity == f"modeShape.{axis}"
        assert check.box is not None
        assert check.box.lo[0] == pytest.approx(0.396) and check.box.hi[0] == pytest.approx(0.404)
        assert check.reference == pytest.approx(_cantilever_shape(beta_l, 0.5), rel=1e-6)


def test_a_mode_shape_check_reads_its_modes_field() -> None:
    check = Check("s", "modeShape.y", "top", None, 0.5, "1", {"coarse": 0.01}, mode=2)
    fields = {"mode1": [(1.0, 0.0, 0.0)], "mode2": [(0.0, 0.25, 0.0)]}
    assert _value(check.quantity, (0.0, 0.0, 0.0), fields, 0, check.mode) == 0.25


def test_frequency_error_is_relative_or_against_another_mode() -> None:
    plain = Check("f", "frequency", None, None, 100.0, "Hz", {"coarse": 0.01}, mode=2)
    assert frequency_error(plain, [0.0, 101.0]) == (101.0, pytest.approx(0.01))
    rigid = Check("r", "frequency", None, None, 0.0, "Hz", {"coarse": 0.01}, mode=1, relative_to=2)
    assert frequency_error(rigid, [-0.5, 50.0]) == (-0.5, -0.01)
    with pytest.raises(CaseError, match="found 1 modes"):
        frequency_error(rigid, [0.0])


@pytest.mark.parametrize(
    ("check", "message"),
    [
        ("{name: f, quantity: frequency, reference: {value: 1, unit: Hz}}", "must name its mode"),
        (
            "{name: f, quantity: frequency, mode: 0, reference: {value: 1, unit: Hz}}",
            "mode number from 1",
        ),
        (
            "{name: f, quantity: frequency, mode: 1, reference: {value: 0, unit: Hz}}",
            "give relativeTo",
        ),
        (
            "{name: s, quantity: modeShape.z, face: top, reference: {value: 1, unit: '1'}}",
            "must name its mode and a known face",
        ),
        (
            "{name: s, quantity: modeShape.z, mode: 1, reference: {value: 1, unit: '1'}}",
            "must name its mode and a known face",
        ),
    ],
)
def test_a_frequency_check_names_its_mode(tmp_path: Path, check: str, message: str) -> None:
    folder = tmp_path / "V-99"
    folder.mkdir()
    (folder / "spec.json").write_text(json.dumps({"loads": [], "supports": []}))
    (folder / "case.yaml").write_text(
        "id: V-99\ntitle: t\ngeometry: {unit: mm}\nfaces: {}\n"
        "mesh: {coarse: {value: 1, unit: mm}, full: {value: 1, unit: mm}}\n"
        f"checks:\n  - {check[:-1]}, tolerance: {{coarse: 0.1, full: 0.1}}}}\n"
    )
    with pytest.raises(CaseError, match=message):
        load_case(folder)


# --- The suite's ledger reconciliation (M8 exit) ---


def _entry(seq, amount, balance, reason, job=None, run=None):  # type: ignore[no-untyped-def]
    return {
        "seq": seq,
        "amount": amount,
        "balance": balance,
        "reason": reason,
        "job": None if job is None else {"id": job, "billedSeconds": 5, "ratePerHour": 1_000_000},
        "run": None if run is None else {"id": run},
    }


def _ledger():  # type: ignore[no-untyped-def]
    # 5 s at 1 credit per hour is 1,388.9 micro-credits, rounded to 1,389.
    entries = [
        _entry(3, -1_389, 99_997_222, "solve", "s1", "r1"),
        _entry(2, -1_389, 99_998_611, "mesh", "m1"),
        _entry(1, 10**8, 10**8, "grant"),
    ]
    wallet = {"balance": 99_997_222, "granted": 10**8, "charged": -2_778, "entries": entries}
    runs = {"r1": {"billedSeconds": 5, "amount": 1_389, "charged": True}}
    return wallet, runs


def test_prices_a_job_as_the_platform_does() -> None:
    from harness.ledger import cost_of

    assert cost_of(5, 1_000_000) == 1_389
    assert cost_of(1, 1_800) == 1  # half a micro-credit rounds up
    assert cost_of(0, 4_000_000) == 0


def test_a_consistent_ledger_reconciles() -> None:
    from harness.ledger import reconcile

    wallet, runs = _ledger()
    runs["r2"] = {"billedSeconds": 0, "amount": 0, "charged": False}  # a run not charged
    assert all(r.ok for r in reconcile(wallet, runs))


def test_reconciliation_finds_each_kind_of_mismatch() -> None:
    from harness.ledger import reconcile

    wallet, runs = _ledger()
    wallet["entries"][0]["balance"] -= 1  # a broken running balance
    wallet["balance"] -= 1
    assert [r.ok for r in reconcile(wallet, runs)] == [False, False, True, True, True]

    wallet, runs = _ledger()
    wallet["balance"] += 1  # the wallet disagrees with the sum
    assert [r.ok for r in reconcile(wallet, runs)] == [True, False, True, True, True]

    wallet, runs = _ledger()
    wallet["entries"][1]["job"]["billedSeconds"] = 6  # charged other than its time
    assert [r.ok for r in reconcile(wallet, runs)] == [True, True, False, True, True]

    wallet, runs = _ledger()
    runs["r1"]["amount"] = 1_390  # the run's record disagrees with its charge
    assert [r.ok for r in reconcile(wallet, runs)] == [True, True, True, False, True]

    wallet, runs = _ledger()
    runs["r2"] = {"billedSeconds": 3, "amount": 833, "charged": True}  # a charged run, no entry
    assert [r.ok for r in reconcile(wallet, runs)] == [True, True, True, False, True]

    wallet, runs = _ledger()
    wallet["entries"].insert(0, _entry(4, -5, 99_997_217, "storage"))
    wallet.update(balance=99_997_217, charged=-2_783)
    assert [r.ok for r in reconcile(wallet, runs)] == [True, True, True, True, False]


def test_a_poll_rides_out_a_dropped_connection(monkeypatch: pytest.MonkeyPatch) -> None:
    import urllib.error

    from harness import client as client_module

    answers: list[object] = [
        {"run": {"status": "solving"}},
        urllib.error.URLError(ConnectionResetError(104, "Connection reset by peer")),
        {"run": {"status": "succeeded"}},
    ]

    def answer(self: client_module.Client, method: str, path: str, body: object = None) -> object:
        reply = answers.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply

    monkeypatch.setattr(client_module.Client, "json", answer)
    monkeypatch.setattr(client_module.time, "sleep", lambda seconds: None)
    api = client_module.Client("https://example.test")
    assert api.wait("/api/runs/1", "run", {"solving"}, 60)["status"] == "succeeded"
    assert answers == []
