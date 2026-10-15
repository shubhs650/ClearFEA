# SPDX-License-Identifier: AGPL-3.0-or-later
"""The mesh job's meshing step and the volume mesh file (needs Gmsh)."""

import json
import math
from collections.abc import Callable
from pathlib import Path

import pytest

from clearfea_worker.geometry.display import read_display
from clearfea_worker.geometry.importer import import_geometry
from clearfea_worker.meshing.mesher import (
    MAX_ELEMENTS,
    LocalSize,
    MeshFailure,
    check_size,
    estimated_elements,
    mesh_geometry,
)
from clearfea_worker.meshing.volume import (
    NODES_PER_ELEMENT,
    TET_FACES,
    VolumeMesh,
    read_volume_mesh,
    write_volume_mesh,
)
from clearfea_worker.spec.geometry_schema import Topology

from .step_models import block_with_hole, with_length_unit


@pytest.fixture(scope="module")
def imported(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, Topology]:
    root = tmp_path_factory.mktemp("block")
    step = block_with_hole(root / "block.step")
    import_geometry(step, root / "import", None)
    topology = Topology.model_validate_json((root / "import" / "topology.json").read_bytes())
    return step, topology


def corners(mesh: VolumeMesh, element: int, local_face: int) -> list[list[float]]:
    n = NODES_PER_ELEMENT[mesh.order]
    nodes = mesh.elements[element * n : element * n + 4]
    return [mesh.positions[3 * nodes[i] : 3 * nodes[i] + 3] for i in TET_FACES[local_face]]


def triangle_area(a: list[float], b: list[float], c: list[float]) -> float:
    u = [b[i] - a[i] for i in range(3)]
    v = [c[i] - a[i] for i in range(3)]
    cross = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
    return 0.5 * math.hypot(*cross)


@pytest.mark.parametrize("order", [1, 2])
def test_meshes_every_face_and_maps_it_to_element_faces(
    imported: tuple[Path, Topology], tmp_path: Path, order: int
) -> None:
    step, topology = imported
    output = mesh_geometry(
        step, topology, tmp_path, scaling=1.0, size=0.005, unit="mm", order=order
    )
    mesh = read_volume_mesh(output.mesh_path)
    assert mesh.order == order
    assert (output.result.nodes, output.result.elements) == (mesh.node_count, mesh.element_count)
    assert mesh.bodies == {1: (0, mesh.element_count)}
    assert sorted(mesh.faces) == sorted(f.tag for f in topology.faces)
    pad = 1e-9 * topology.size + 2e-7  # OpenCASCADE pads face boxes by its tolerance.
    for face in topology.faces:
        pairs = mesh.faces[face.tag]
        assert pairs, f"face {face.tag} has no element faces"
        area = 0.0
        for element, local_face in pairs:
            points = corners(mesh, element, local_face)
            for p in points:
                for axis in range(3):
                    assert face.bbox[axis] - pad <= p[axis] <= face.bbox[axis + 3] + pad
            area += triangle_area(*points)
        # Straight-edged faces are covered exactly; polygons stand in for the hole's circle.
        assert area == pytest.approx(face.area, rel=0.02)
    # Element faces are on the boundary, so no element face appears twice.
    entries = [pair for pairs in mesh.faces.values() for pair in pairs]
    assert len(entries) == len(set(entries))

    display = {p.tag: p for p in read_display(output.display_path)}
    assert sorted(display) == sorted(mesh.faces)
    for tag, patch in display.items():
        assert len(patch.triangles) // 3 == len(mesh.faces[tag])
    assert output.result.surface_triangles == len(entries)


def test_second_order_mid_edge_nodes_lie_on_the_hole(
    imported: tuple[Path, Topology], tmp_path: Path
) -> None:
    step, topology = imported
    output = mesh_geometry(step, topology, tmp_path, scaling=1.0, size=0.005, unit="mm", order=2)
    mesh = read_volume_mesh(output.mesh_path)
    hole = next(f for f in topology.faces if f.type == "cylinder")
    # Mid-edge nodes 4, 5 and 6 belong to the edges of corner face (0, 1, 2), and so on.
    mid = {0: (4, 5, 6), 1: (4, 9, 7), 2: (6, 8, 7), 3: (5, 8, 9)}
    for element, local_face in mesh.faces[hole.tag]:
        nodes = mesh.elements[element * 10 : element * 10 + 10]
        for k in mid[local_face]:
            x, y, _ = mesh.positions[3 * nodes[k] : 3 * nodes[k] + 3]
            assert math.hypot(x - 0.05, y - 0.025) == pytest.approx(0.01, rel=1e-6)


def test_a_smaller_size_gives_more_elements(
    imported: tuple[Path, Topology], tmp_path: Path
) -> None:
    step, topology = imported
    coarse = mesh_geometry(
        step, topology, tmp_path / "a", scaling=1.0, size=0.01, unit="mm", order=2
    )
    fine = mesh_geometry(
        step, topology, tmp_path / "b", scaling=1.0, size=0.004, unit="mm", order=2
    )
    assert fine.result.elements > 4 * coarse.result.elements


def test_meshes_a_rescaled_geometry_at_its_confirmed_scale(
    imported: tuple[Path, Topology], tmp_path: Path
) -> None:
    step, _ = imported
    inch = tmp_path / "block_in.step"
    inch.write_text(with_length_unit(step.read_text(), "in"))
    # The file says inches; the user confirmed millimetres, so the import used this scaling.
    result = import_geometry(inch, tmp_path / "import", "mm").result
    topology = Topology.model_validate_json((tmp_path / "import" / "topology.json").read_bytes())
    output = mesh_geometry(
        inch, topology, tmp_path / "mesh", scaling=result.scaling, size=0.01, unit="mm", order=2
    )
    mesh = read_volume_mesh(output.mesh_path)
    xs = mesh.positions[0::3]
    assert max(xs) == pytest.approx(0.1, rel=1e-9)


def test_a_face_that_moved_since_import_is_a_platform_fault(
    imported: tuple[Path, Topology], tmp_path: Path
) -> None:
    step, topology = imported
    data = json.loads(topology.model_dump_json(by_alias=True))
    data["faces"][0]["area"] *= 1.001
    drifted = Topology.model_validate(data)
    with pytest.raises(MeshFailure) as failure:
        mesh_geometry(step, drifted, tmp_path, scaling=1.0, size=0.01, unit="mm", order=2)
    assert (failure.value.category, failure.value.cause) == ("platform_fault", "topology_mismatch")
    assert str(data["faces"][0]["tag"]) in failure.value.message


def test_refuses_a_size_that_gives_too_many_elements(
    imported: tuple[Path, Topology], tmp_path: Path
) -> None:
    step, topology = imported
    with pytest.raises(MeshFailure) as failure:
        mesh_geometry(step, topology, tmp_path, scaling=1.0, size=1e-4, unit="mm", order=2)
    assert (failure.value.category, failure.value.cause) == ("user_fault", "mesh_too_large")
    assert f"{MAX_ELEMENTS:,}" in failure.value.message
    assert "about 570,000,000 elements" in failure.value.message
    assert "Enter a mesh size of at least 0.656 mm." in failure.value.message
    # The suggested size passes the check.
    check_size(topology, 0.656e-3, "mm")


def test_volume_mesh_file_round_trips(tmp_path: Path) -> None:
    mesh = VolumeMesh(
        order=1,
        positions=[0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1],
        elements=[0, 1, 2, 3, 1, 2, 3, 4],
        bodies={7: (0, 2)},
        faces={2: [(0, 0), (0, 1)], 1: [(1, 3)]},
    )
    path = tmp_path / "mesh.bin"
    write_volume_mesh(path, mesh)
    assert path.stat().st_size == 32 + 5 * 24 + 8 * 4 + 3 * 12 + 3 * 8
    assert read_volume_mesh(path) == mesh


def test_volume_mesh_reader_refuses_a_damaged_file(tmp_path: Path) -> None:
    mesh = VolumeMesh(1, [0.0] * 12, [0, 1, 2, 3], {1: (0, 1)}, {1: [(0, 0)]})
    path = tmp_path / "mesh.bin"
    write_volume_mesh(path, mesh)
    path.write_bytes(path.read_bytes()[:-4])
    with pytest.raises(ValueError, match="does not match its header"):
        read_volume_mesh(path)
    path.write_bytes(b"CFDM" + bytes(28))
    with pytest.raises(ValueError, match="not a version 1 volume mesh"):
        read_volume_mesh(path)


# Local sizes (M2.8, ADR-045). The block's hole is the cylinder face of radius 10 mm about
# (50, 25) through z = 0 to 20 mm; its top edge is the circle at z = 20 mm.


def corner_edges(mesh: VolumeMesh, near: Callable[[list[float]], bool]) -> list[float]:
    """Lengths of the element corner edges with both ends where ``near`` holds."""
    n = NODES_PER_ELEMENT[mesh.order]
    lengths = set()
    for e in range(mesh.element_count):
        nodes = mesh.elements[e * n : e * n + 4]
        for i in range(4):
            for j in range(i):
                a, b = (
                    mesh.positions[3 * nodes[i] : 3 * nodes[i] + 3],
                    mesh.positions[3 * nodes[j] : 3 * nodes[j] + 3],
                )
                if near(a) and near(b):
                    lengths.add((min(nodes[i], nodes[j]), max(nodes[i], nodes[j]), math.dist(a, b)))
    return [length for _, _, length in lengths]


def on_hole(p: list[float]) -> bool:
    return abs(math.hypot(p[0] - 0.05, p[1] - 0.025) - 0.01) < 1e-6


def on_top_edge(p: list[float]) -> bool:
    return on_hole(p) and abs(p[2] - 0.02) < 1e-6


def mean(values: list[float]) -> float:
    return sum(values) / len(values)


def test_a_local_size_on_a_face_refines_the_mesh_there(
    imported: tuple[Path, Topology], tmp_path: Path
) -> None:
    step, topology = imported
    hole = next(f.tag for f in topology.faces if f.type == "cylinder")
    local = (LocalSize("faces", (hole,), 0.001, "1 mm"),)
    plain = mesh_geometry(
        step, topology, tmp_path / "a", scaling=1.0, size=0.008, unit="mm", order=2
    )
    fine = mesh_geometry(
        step, topology, tmp_path / "b", scaling=1.0, size=0.008, unit="mm", order=2, local=local
    )
    near = corner_edges(read_volume_mesh(fine.mesh_path), on_hole)
    assert 0.8e-3 < mean(near) < 1.4e-3
    # Away from the hole the elements keep the global size.
    far = corner_edges(read_volume_mesh(fine.mesh_path), lambda p: p[0] > 0.09)
    assert mean(far) > 0.006
    assert fine.result.elements > 3 * plain.result.elements
    # The pre-mesh estimate is on the high side.
    assert estimated_elements(topology, 0.008, local) > fine.result.elements


def test_a_local_size_on_an_edge_refines_the_mesh_along_it(
    imported: tuple[Path, Topology], tmp_path: Path
) -> None:
    step, topology = imported
    assert topology.edges is not None
    hole = next(f.tag for f in topology.faces if f.type == "cylinder")
    top = tuple(e.tag for e in topology.edges if hole in e.faces and e.bbox[2] > 0.0199)
    assert top
    local = (LocalSize("edges", top, 0.001, "1 mm"),)
    output = mesh_geometry(
        step, topology, tmp_path, scaling=1.0, size=0.008, unit="mm", order=1, local=local
    )
    mesh = read_volume_mesh(output.mesh_path)
    assert 0.8e-3 < mean(corner_edges(mesh, on_top_edge)) < 1.4e-3
    # The bottom edge of the hole is far from it and keeps a coarser mesh.
    bottom = corner_edges(mesh, lambda p: on_hole(p) and abs(p[2]) < 1e-6)
    assert mean(bottom) > 0.004
    assert estimated_elements(topology, 0.008, local) > output.result.elements


def test_a_local_size_on_a_body_meshes_it_at_that_size(
    imported: tuple[Path, Topology], tmp_path: Path
) -> None:
    step, topology = imported
    local = (LocalSize("bodies", (1,), 0.004, "4 mm"),)
    sized = mesh_geometry(
        step, topology, tmp_path / "a", scaling=1.0, size=0.01, unit="mm", order=2, local=local
    )
    globally = mesh_geometry(
        step, topology, tmp_path / "b", scaling=1.0, size=0.004, unit="mm", order=2
    )
    assert sized.result.elements == pytest.approx(globally.result.elements, rel=0.1)


def test_reports_the_quality_of_the_mesh(imported: tuple[Path, Topology], tmp_path: Path) -> None:
    step, topology = imported
    output = mesh_geometry(step, topology, tmp_path, scaling=1.0, size=0.005, unit="mm", order=2)
    quality = output.result.quality
    assert sum(quality.shape_histogram) == output.result.elements
    assert 0 < quality.shape_min <= quality.shape_mean <= 1
    assert quality.shape_mean > 0.5
    # Straight elements have a scaled Jacobian of 1; the curved ones on the hole a little less.
    assert 0.5 < quality.jacobian_min < 1


@pytest.mark.parametrize(
    ("local", "cause", "words"),
    [
        (
            LocalSize("faces", (1,), 0.02, "20 mm"),
            "local_size_too_large",
            "larger than the global size of 10 mm",
        ),
        (
            LocalSize("faces", (99,), 0.001, "1 mm"),
            "unknown_tags",
            "names face 99, which the geometry does not have",
        ),
        (LocalSize("bodies", (2,), 0.001, "1 mm"), "unknown_tags", "names body 2"),
    ],
)
def test_refuses_local_sizes_it_cannot_use(
    imported: tuple[Path, Topology], tmp_path: Path, local: LocalSize, cause: str, words: str
) -> None:
    step, topology = imported
    with pytest.raises(MeshFailure) as failure:
        mesh_geometry(
            step, topology, tmp_path, scaling=1.0, size=0.01, unit="mm", order=2, local=(local,)
        )
    assert (failure.value.category, failure.value.cause) == ("user_fault", cause)
    assert words in failure.value.message


def test_an_edge_that_moved_since_import_is_a_platform_fault(
    imported: tuple[Path, Topology], tmp_path: Path
) -> None:
    step, topology = imported
    data = json.loads(topology.model_dump_json(by_alias=True))
    data["edges"][0]["length"] *= 1.001
    drifted = Topology.model_validate(data)
    with pytest.raises(MeshFailure) as failure:
        mesh_geometry(step, drifted, tmp_path, scaling=1.0, size=0.01, unit="mm", order=2)
    assert (failure.value.category, failure.value.cause) == ("platform_fault", "topology_mismatch")


def test_refuses_local_sizes_that_give_too_many_elements(imported: tuple[Path, Topology]) -> None:
    _, topology = imported
    hole = next(f.tag for f in topology.faces if f.type == "cylinder")
    with pytest.raises(MeshFailure) as failure:
        check_size(topology, 0.01, "mm", (LocalSize("faces", (hole,), 1e-5, "0.01 mm"),))
    assert failure.value.cause == "mesh_too_large"
    assert "Make the local sizes larger" in failure.value.message
