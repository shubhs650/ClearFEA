# SPDX-License-Identifier: AGPL-3.0-or-later
"""Fast tests of the verification harness: its file readers, face naming, setup and checks.

No API, worker or solver: those run in `make verify`.
"""

import json
import math
import re
from pathlib import Path

import pytest

from harness.binfiles import Patch, Surface, read_fields, read_surface
from harness.cases import (
    Box,
    Case,
    CaseError,
    Check,
    applied_load,
    balance,
    build_spec,
    distance_integral,
    evaluate,
    load_case,
    name_faces,
    reaction,
    unexpected_warnings,
    volume_and_moment,
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


def test_reads_a_reaction_component_of_the_named_support() -> None:
    check = Check("r", "reaction.y", None, None, 1.0, "N", {"coarse": 0.1, "full": 0.1}, "b")
    reactions = [{"supportId": "a", "force": [1, 2, 3]}, {"supportId": "b", "force": [4, 5, 6]}]
    assert reaction(check, reactions) == 5.0


def test_balance_without_a_load_is_measured_against_the_reactions() -> None:
    assert balance([0.0, 0.0, -10.0], 10.0, [[0.0, 0.0, 9.0]]) == pytest.approx((1.0, 10.0))
    miss, size = balance(
        [0.0, 0.0, 0.0], 0.0, [[3.0, 0.0, 0.0], [-3.0, 0.0, 0.0], [0.0, 0.0, 1e-3]]
    )
    assert (miss, size) == pytest.approx((1e-3, 6.001))


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
    for check in full.checks:
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


def test_spec_templates_use_mixed_units() -> None:
    units = set()
    for folder in CASES.iterdir():
        spec = json.loads((folder / "spec.json").read_text())
        units.add(spec["materials"][0]["youngsModulus"]["unit"])
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
