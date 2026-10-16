# SPDX-License-Identifier: AGPL-3.0-or-later
"""The viewer's result files: mesh surface and the nodal fields on it (M1.9, ADR-031)."""

import math
from array import array
from pathlib import Path

import pytest

from clearfea_worker.geometry.display import read_display
from clearfea_worker.results import principal_stresses, von_mises
from clearfea_worker.results import read_fields as read_nodal_fields
from clearfea_worker.results.surface import (
    SurfaceField,
    extract_surface,
    read_fields,
    surface_fields,
    write_fields,
    write_viewer_files,
)

from .deck_meshes import two_tets

SOLVE = Path(__file__).resolve().parent / "fixtures" / "solve"
FIXTURE = Path(__file__).resolve().parents[2] / "packages" / "spec" / "fixtures"


def _point(positions: list[float], v: int) -> tuple[float, ...]:
    return tuple(positions[3 * v : 3 * v + 3])


@pytest.mark.parametrize(("order", "per_face"), [(1, 1), (2, 4)])
def test_every_boundary_element_face_is_drawn_facing_outwards(order: int, per_face: int) -> None:
    mesh = two_tets(order)
    surface = extract_surface(mesh)
    assert [p.tag for p in surface.patches] == [1, 2, 3, 4]
    # Six element faces lie on the boundary; the face B C D the two elements share does not.
    assert sum(len(p.triangles) // 3 for p in surface.patches) == 6 * per_face
    # Both tetrahedra together are convex, so outwards means away from their centroid.
    centre = [sum(mesh.positions[3 * n + i] for n in range(5)) / 5 for i in range(3)]
    for patch in surface.patches:
        for k in range(len(patch.triangles) // 3):
            a, b, c = (_point(patch.positions, v) for v in patch.triangles[3 * k : 3 * k + 3])
            u = [b[i] - a[i] for i in range(3)]
            w = [c[i] - a[i] for i in range(3)]
            normal = (
                u[1] * w[2] - u[2] * w[1],
                u[2] * w[0] - u[0] * w[2],
                u[0] * w[1] - u[1] * w[0],
            )
            assert math.hypot(*normal) > 0
            out = [a[i] - centre[i] for i in range(3)]
            assert sum(normal[i] * out[i] for i in range(3)) > 0, (patch.tag, k)


def test_each_vertex_sits_on_its_mesh_node_and_every_surface_node_is_used() -> None:
    mesh = two_tets(order=2)
    surface = extract_surface(mesh)
    flat = [x for p in surface.patches for x in p.positions]
    assert len(flat) == 3 * len(surface.nodes)
    for v, node in enumerate(surface.nodes):
        assert _point(flat, v) == _point(mesh.positions, node)
    # Every edge of the inner face B C D also bounds an outer face, so all 14 nodes show.
    assert set(surface.nodes) == set(range(mesh.node_count))


def test_each_vertex_takes_its_nodes_displacement_stress_and_strain() -> None:
    mesh = two_tets(order=2)
    nodal = read_nodal_fields(SOLVE / "job.frd", mesh.node_count)
    surface = extract_surface(mesh)
    displacement, mises, stress, principal, strain = surface_fields(surface, nodal)
    assert (displacement.name, displacement.kind, displacement.components) == (
        "displacement",
        "length",
        3,
    )
    assert (mises.name, mises.kind, mises.components) == ("vonMises", "pressure", 1)
    for v, node in enumerate(surface.nodes):
        expected = nodal.displacement[3 * node : 3 * node + 3]
        assert list(displacement.values[3 * v : 3 * v + 3]) == pytest.approx(expected, rel=1e-6)
        tensor = nodal.stress[6 * node : 6 * node + 6]
        assert mises.values[v] == pytest.approx(von_mises(*tensor), rel=1e-6)
        assert list(stress.values[6 * v : 6 * v + 6]) == pytest.approx(tensor, rel=1e-6)
        assert list(principal.values[3 * v : 3 * v + 3]) == pytest.approx(
            principal_stresses(*tensor), rel=1e-6
        )
        expected = nodal.strain[6 * node : 6 * node + 6]
        assert list(strain.values[6 * v : 6 * v + 6]) == pytest.approx(expected, rel=1e-6)
    # Name, units.json kind and component count of each new field (result-fields.md).
    assert [(f.name, f.kind, f.components) for f in (stress, principal, strain)] == [
        ("stress", "pressure", 6),
        ("principalStress", "pressure", 3),
        ("strain", "strain", 6),
    ]


def test_writes_the_surface_and_fields_the_viewer_reads(tmp_path: Path) -> None:
    mesh = two_tets(order=2)
    nodal = read_nodal_fields(SOLVE / "job.frd", mesh.node_count)
    files = write_viewer_files(mesh, nodal, tmp_path)
    patches = read_display(files.surface_path)
    vertices = sum(len(p.positions) // 3 for p in patches)
    count, fields = read_fields(files.fields_path)
    assert count == vertices
    assert [f.name for f in fields] == [
        "displacement",
        "vonMises",
        "stress",
        "principalStress",
        "strain",
    ]
    expected = surface_fields(extract_surface(mesh), nodal)
    assert [f.values for f in fields] == [f.values for f in expected]


# The fields in packages/spec/fixtures/result-fields-three-vertices.bin. The web viewer's
# reader is tested against the same file (apps/web/test/resultFields.test.ts).
FIXTURE_FIELDS = [
    SurfaceField(
        "displacement", "length", 3, array("f", [0, 0, 0, 1e-3, -2e-3, 0.5e-3, 0, 0, 4e-3])
    ),
    SurfaceField("vonMises", "pressure", 1, array("f", [1.5e6, 2.5e8, 0.0])),
]


def test_writes_the_shared_fixture_byte_for_byte(tmp_path: Path) -> None:
    path = tmp_path / "fields.bin"
    write_fields(path, 3, FIXTURE_FIELDS)
    assert path.read_bytes() == (FIXTURE / "result-fields-three-vertices.bin").read_bytes()


def test_refuses_a_field_of_the_wrong_length(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="2 values for 3 vertices"):
        write_fields(tmp_path / "f.bin", 3, [SurfaceField("x", "length", 1, array("f", [1, 2]))])


def test_refuses_a_file_with_the_wrong_magic(tmp_path: Path) -> None:
    path = tmp_path / "fields.bin"
    path.write_bytes(b"XXXX" + bytes(12))
    with pytest.raises(ValueError, match="not a version 1"):
        read_fields(path)
