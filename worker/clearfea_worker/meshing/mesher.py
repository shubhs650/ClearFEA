# SPDX-License-Identifier: AGPL-3.0-or-later
"""The mesh job's work: re-import, check face identity, mesh, map faces (ADR-023, ADR-028).

The geometry is imported exactly as its import job did (``import_options`` with the same
scaling), and every face is compared with topology.json before anything is meshed, so the
face tags a simulation refers to are the faces that get meshed. Gmsh then fills each body
with tetrahedra no larger than the global size, and every surface triangle is matched to
the tetrahedron face with the same corner nodes, which gives the face-to-element map in
mesh.bin (packages/spec/volume-mesh.md). The mesh display file uses the display mesh format.
"""

import logging
import math
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType

from ..geometry.display import FacePatch, write_display
from ..geometry.importer import gmsh_session, import_options, software, topology
from ..spec.geometry_schema import Topology
from ..spec.jobs_schema import FailureCategory
from ..spec.simulation_schema import MeshResult
from ..spec.simulation_schema import Software as MeshSoftware
from ..units import from_si
from .volume import NODES_PER_ELEMENT, TET_FACES, VolumeMesh, write_volume_mesh

log = logging.getLogger(__name__)

#: Re-imports of the same file with the same versions agree exactly (ADR-023); this is
#: the M1.1 spike's tolerance, relative to the face area and to the model size.
REIMPORT_TOLERANCE = 1e-9

#: The most tetrahedra a Phase 0 mesh may have: the design target in DECISIONS.md.
MAX_ELEMENTS = 2_000_000

#: Gmsh fills a body with about 4.5 tetrahedra per size**3 of volume (measured on the test
#: block); 6 keeps the estimate on the high side, so a refused mesh is truly too large.
ELEMENTS_PER_SIZE_CUBED = 6.0

#: Gmsh element types: tetrahedra and the triangles on their faces, by element order.
_TETRAHEDRON = {1: 4, 2: 11}
_TRIANGLE = {1: 2, 2: 9}


class MeshFailure(Exception):
    """The mesh cannot be made. ``category`` says who is at fault; ``message`` what to do."""

    def __init__(self, category: FailureCategory, cause: str, message: str) -> None:
        super().__init__(message)
        self.category = category
        self.cause = cause
        self.message = message


@dataclass(frozen=True)
class MeshOutput:
    result: MeshResult
    mesh_path: Path
    display_path: Path


def topology_mismatch(reference: Topology, current: Topology) -> list[int]:
    """Tags of faces whose identity differs between topology.json and this import."""
    ref = {f.tag: f for f in reference.faces}
    cur = {f.tag: f for f in current.faces}
    wrong = set(ref) ^ set(cur)
    for tag in set(ref) & set(cur):
        a, b = ref[tag], cur[tag]
        moved = math.dist(a.centroid, b.centroid) > REIMPORT_TOLERANCE * reference.size
        resized = abs(a.area - b.area) > REIMPORT_TOLERANCE * a.area
        if moved or resized or a.bodies != b.bodies or a.gmsh_type != b.gmsh_type:
            wrong.add(tag)
    ref_bodies = {b.tag: b.faces for b in reference.bodies}
    cur_bodies = {b.tag: b.faces for b in current.bodies}
    if ref_bodies != cur_bodies:
        wrong.update(f for faces in (*ref_bodies.values(), *cur_bodies.values()) for f in faces)
    return sorted(wrong)


def estimated_elements(reference: Topology, size: float) -> float:
    volume = sum(b.volume for b in reference.bodies)
    return ELEMENTS_PER_SIZE_CUBED * volume / size**3


def _length(value: float, unit: str) -> str:
    return f"{from_si(value, unit, 'length'):.3g} {unit}"


def _round_up(value: float, digits: int = 3) -> float:
    """``value`` rounded up to ``digits`` significant digits."""
    step = 10 ** (math.floor(math.log10(value)) - digits + 1)
    return math.ceil(value / step) * step


def check_size(reference: Topology, size: float, unit: str) -> None:
    """Refuses a size that would give more elements than a Phase 0 mesh may have."""
    estimate = estimated_elements(reference, size)
    if estimate <= MAX_ELEMENTS:
        return
    volume = sum(b.volume for b in reference.bodies)
    smallest = (ELEMENTS_PER_SIZE_CUBED * volume / MAX_ELEMENTS) ** (1 / 3)
    # Rounded up, so the size suggested is one that passes this check.
    suggestion = _round_up(from_si(smallest, unit, "length"))
    raise MeshFailure(
        "user_fault",
        "mesh_too_large",
        f"A mesh size of {_length(size, unit)} would give about {_round_up(estimate, 2):,.0f} "
        f"elements, more than the {MAX_ELEMENTS:,} ClearFEA can mesh. Enter a mesh size of "
        f"at least {suggestion:.3g} {unit}.",
    )


def mesh_options(gmsh: ModuleType, size: float, order: int) -> None:
    """Global size only: no sizes from CAD points or curvature (local sizes come in M2.8)."""
    gmsh.option.setNumber("Mesh.MeshSizeMax", size)
    gmsh.option.setNumber("Mesh.MeshSizeFromPoints", 0)
    gmsh.option.setNumber("Mesh.MeshSizeFromCurvature", 0)
    gmsh.option.setNumber("Mesh.ElementOrder", order)
    # Mid-edge nodes of second-order elements lie on the curved CAD faces.
    gmsh.option.setNumber("Mesh.SecondOrderLinear", 0)


def _volume_mesh(gmsh: ModuleType, order: int) -> tuple[VolumeMesh, list[FacePatch]]:
    model = gmsh.model
    npe = NODES_PER_ELEMENT[order]
    tags, coords, _ = model.mesh.getNodes()
    index = {int(t): i for i, t in enumerate(tags)}
    positions = [float(c) for c in coords]

    elements: list[int] = []
    bodies: dict[int, tuple[int, int]] = {}
    for _, body in sorted(model.getEntities(3)):
        types, _, nodes = model.mesh.getElements(3, body)
        if [int(t) for t in types] != [_TETRAHEDRON[order]]:
            raise MeshFailure(
                "platform_fault", "unexpected_elements", f"Body {body} has element types {types}."
            )
        first = len(elements) // npe
        elements.extend(index[int(n)] for n in nodes[0])
        bodies[body] = (first, len(elements) // npe - first)

    # Surface triangles by their sorted corner nodes, then each tetrahedron face looked up.
    triangle_of: dict[tuple[int, ...], tuple[int, int]] = {}
    patches = []
    for _, face in sorted(model.getEntities(2)):
        types, _, nodes = model.mesh.getElements(2, face)
        if [int(t) for t in types] != [_TRIANGLE[order]]:
            raise MeshFailure(
                "platform_fault", "unexpected_elements", f"Face {face} has element types {types}."
            )
        per = 3 if order == 1 else 6
        flat = [index[int(n)] for n in nodes[0]]
        local: dict[int, int] = {}
        patch_positions: list[float] = []
        triangles: list[int] = []
        for k in range(len(flat) // per):
            corners = flat[k * per : k * per + 3]
            key = tuple(sorted(corners))
            if key in triangle_of:
                raise MeshFailure(
                    "platform_fault", "face_map", f"A triangle lies on faces {face} and another."
                )
            triangle_of[key] = (face, k)
            for n in corners:
                if n not in local:
                    local[n] = len(local)
                    patch_positions.extend(positions[3 * n : 3 * n + 3])
                triangles.append(local[n])
        patches.append(FacePatch(face, patch_positions, triangles))

    faces: dict[int, list[tuple[int, int]]] = {face: [] for _, face in model.getEntities(2)}
    found = 0
    for e in range(len(elements) // npe):
        corners = elements[e * npe : e * npe + 4]
        for local_face, (a, b, c) in enumerate(TET_FACES):
            hit = triangle_of.get(tuple(sorted((corners[a], corners[b], corners[c]))))
            if hit is not None:
                faces[hit[0]].append((e, local_face))
                found += 1
    if found != len(triangle_of):
        raise MeshFailure(
            "platform_fault",
            "face_map",
            f"{len(triangle_of)} surface triangles matched {found} tetrahedron faces.",
        )
    return VolumeMesh(order, positions, elements, bodies, faces), patches


def _inverted(gmsh: ModuleType) -> int:
    """Elements whose scaled Jacobian is zero or negative somewhere: unusable by the solver."""
    count = 0
    for _, body in gmsh.model.getEntities(3):
        _, tags, _ = gmsh.model.mesh.getElements(3, body)
        qualities = gmsh.model.mesh.getElementQualities(tags[0], "minSJ")
        count += sum(1 for q in qualities if q <= 0)
    return count


def mesh_geometry(
    step: Path,
    reference: Topology,
    out_dir: Path,
    *,
    scaling: float,
    size: float,
    unit: str,
    order: int,
) -> MeshOutput:
    """Meshes ``step`` with a global ``size`` in metres; writes mesh.bin and display.bin.

    ``unit`` is the unit the user entered the size in, used only in messages. Raises
    MeshFailure when the mesh cannot be made.
    """
    check_size(reference, size, unit)
    out_dir.mkdir(parents=True, exist_ok=True)
    with gmsh_session() as gmsh:
        import_options(gmsh, scaling)
        gmsh.model.occ.importShapes(str(step))
        gmsh.model.occ.synchronize()
        mismatch = topology_mismatch(reference, topology(gmsh, reference.unit, scaling))
        if mismatch:
            raise MeshFailure(
                "platform_fault",
                "topology_mismatch",
                f"Faces {mismatch} differ from topology.json after re-import.",
            )
        mesh_options(gmsh, size, order)
        try:
            gmsh.model.mesh.generate(3)
        except Exception as error:
            log.info("Gmsh could not mesh %s: %s", step, error)
            raise MeshFailure(
                "user_fault",
                "mesher_failed",
                f"Gmsh could not mesh the part with a mesh size of {_length(size, unit)}. "
                "Try a smaller mesh size; if that fails too, the geometry may have faces "
                "that are broken or very small, which you can repair in your CAD system.",
            ) from None
        inverted = _inverted(gmsh)
        if inverted:
            raise MeshFailure(
                "user_fault",
                "inverted_elements",
                f"The mesh has {inverted} distorted elements that the solver cannot use. "
                f"Try a smaller mesh size than {_length(size, unit)}.",
            )
        mesh, patches = _volume_mesh(gmsh, order)
        versions = software(gmsh)
    mesh_path = out_dir / "mesh.bin"
    write_volume_mesh(mesh_path, mesh)
    display_path = out_dir / "display.bin"
    triangles = write_display(display_path, patches)
    result = MeshResult(
        order=order,
        nodes=mesh.node_count,
        elements=mesh.element_count,
        surface_triangles=triangles,
        software=MeshSoftware(gmsh=versions.gmsh, occt=versions.occt),
    )
    return MeshOutput(result, mesh_path, display_path)
