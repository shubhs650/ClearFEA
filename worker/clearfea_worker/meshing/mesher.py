# SPDX-License-Identifier: AGPL-3.0-or-later
"""The mesh job's work: re-import, check face identity, mesh, map faces (ADR-023, ADR-028).

The geometry is imported exactly as its import job did (``import_options`` with the same
scaling), and every face (and since M2.8 every edge) is compared with topology.json before
anything is meshed, so the tags a simulation refers to are the ones that get meshed. Gmsh
then fills each body with tetrahedra no larger than the global size, smaller near local
sizes on faces, edges and bodies (M2.8, ADR-045), and every surface triangle is matched to
the tetrahedron face with the same corner nodes, which gives the face-to-element map in
mesh.bin (packages/spec/volume-mesh.md). The mesh display file uses the display mesh format.
"""

import logging
import math
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType

from ..geometry.display import FacePatch, write_display
from ..geometry.importer import gmsh_session, import_options, software, topology
from ..spec.geometry_schema import Topology
from ..spec.jobs_schema import FailureCategory
from ..spec.simulation_schema import MeshQuality, MeshResult
from ..spec.simulation_schema import Software as MeshSoftware
from ..units import from_si
from .volume import NODES_PER_ELEMENT, TET_FACES, VolumeMesh, write_volume_mesh

log = logging.getLogger(__name__)

#: Re-imports of the same file with the same versions agree exactly (ADR-023); this is
#: the M1.1 spike's tolerance, relative to the face area and to the model size.
REIMPORT_TOLERANCE = 1e-9

#: The most tetrahedra the mesher makes. What a run may solve is less, per solver and element
#: order (packages/spec/estimator.json, ADR-063); the 2-million-element design target is dropped.
MAX_ELEMENTS = 2_000_000

#: Gmsh fills a body with about 4.5 tetrahedra per size**3 of volume (measured on the test
#: block); 6 keeps the estimate on the high side, so a refused mesh is truly too large.
ELEMENTS_PER_SIZE_CUBED = 6.0

#: How fast elements grow away from a local size on a face or edge: the size at distance d
#: is the local size plus GROWTH * d, up to the global size, so neighbouring elements differ
#: by about 20 percent (ADR-045).
GROWTH = 0.2

#: Distance field samples per face or edge direction: about two per local element over the
#: entity's extent, within these bounds (Gmsh's default is 20).
SAMPLING_MIN, SAMPLING_MAX = 20, 400

#: Gmsh element types: tetrahedra and the triangles on their faces, by element order.
_TETRAHEDRON = {1: 4, 2: 11}
_TRIANGLE = {1: 2, 2: 9}
_LINE = {1: 1, 2: 8}


class MeshFailure(Exception):
    """The mesh cannot be made. ``category`` says who is at fault; ``message`` what to do."""

    def __init__(self, category: FailureCategory, cause: str, message: str) -> None:
        super().__init__(message)
        self.category = category
        self.cause = cause
        self.message = message


@dataclass(frozen=True)
class LocalSize:
    """A local size in metres on faces, edges or bodies (``scope``), by tag."""

    scope: str
    tags: tuple[int, ...]
    size: float
    #: The size as the user entered it, for messages.
    text: str


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
    if reference.edges is not None:
        ref_edges = {e.tag: e for e in reference.edges}
        cur_edges = {e.tag: e for e in current.edges or []}
        wrong_edges = set(ref_edges) ^ set(cur_edges)
        for tag in set(ref_edges) & set(cur_edges):
            a, b = ref_edges[tag], cur_edges[tag]
            moved = any(
                abs(p - q) > REIMPORT_TOLERANCE * reference.size
                for p, q in zip(a.bbox, b.bbox, strict=True)
            )
            resized = abs(a.length - b.length) > REIMPORT_TOLERANCE * a.length
            if moved or resized or a.faces != b.faces:
                wrong_edges.add(tag)
        # An edge that differs makes the faces it bounds suspect too.
        for tag in wrong_edges:
            edge = ref_edges.get(tag) or cur_edges[tag]
            wrong.update(edge.faces)
    ref_bodies = {b.tag: b.faces for b in reference.bodies}
    cur_bodies = {b.tag: b.faces for b in current.bodies}
    if ref_bodies != cur_bodies:
        wrong.update(f for faces in (*ref_bodies.values(), *cur_bodies.values()) for f in faces)
    return sorted(wrong)


def _graded(size: float, local: float, spread: Callable[[float], float]) -> float:
    """Elements in the zone where the size grows from ``local`` to ``size``.

    ``spread(d)`` is the area of the zone's surface at distance d from the entity, so the
    zone's volume element is spread(d) dd and it holds ELEMENTS_PER_SIZE_CUBED per size**3.
    Integrated with the midpoint rule over steps that are even in log(size).
    """
    if local >= size:
        return 0.0
    steps = 200
    total = 0.0
    ratio = size / local
    for k in range(steps):
        s0 = local * ratio ** (k / steps)
        s1 = local * ratio ** ((k + 1) / steps)
        s = math.sqrt(s0 * s1)
        d = (s - local) / GROWTH
        total += ELEMENTS_PER_SIZE_CUBED * spread(d) / s**3 * (s1 - s0) / GROWTH
    return total


def estimated_elements(
    reference: Topology, size: float, local: tuple[LocalSize, ...] = ()
) -> float:
    """Elements a mesh will have, on the high side (ADR-028 item 5, ADR-045).

    A local size adds the elements of its zone: a face's zone is the parallel set of the face
    on the body's side (its area, its perimeter rounded off as a half tube, its corners as a
    half sphere), an edge's a tube with round ends, and a body is filled at its local size.
    """
    volume = sum(b.volume for b in reference.bodies)
    total = ELEMENTS_PER_SIZE_CUBED * volume / size**3
    faces = {f.tag: f for f in reference.faces}
    edges = {e.tag: e for e in reference.edges or []}
    bodies = {b.tag: b for b in reference.bodies}
    for item in local:
        for tag in item.tags:
            if item.scope == "bodies":
                total += ELEMENTS_PER_SIZE_CUBED * bodies[tag].volume / item.size**3
            elif item.scope == "faces":
                area = faces[tag].area
                perimeter = sum(e.length for e in edges.values() if tag in e.faces)
                if not edges:  # a geometry imported before M2.8: a square face's perimeter
                    perimeter = 4 * math.sqrt(area)
                sides = max(len(faces[tag].bodies), 1)
                total += sides * _graded(
                    size,
                    item.size,
                    lambda d, a=area, p=perimeter: a + math.pi * p * d / 2 + 2 * math.pi * d * d,
                )
            else:
                length = edges[tag].length
                total += _graded(
                    size,
                    item.size,
                    lambda d, n=length: 2 * math.pi * n * d + 4 * math.pi * d * d,
                )
    return total


def _length(value: float, unit: str) -> str:
    return f"{from_si(value, unit, 'length'):.3g} {unit}"


def _round_up(value: float, digits: int = 3) -> float:
    """``value`` rounded up to ``digits`` significant digits."""
    step = 10 ** (math.floor(math.log10(value)) - digits + 1)
    return math.ceil(value / step) * step


def check_local(reference: Topology, size: float, unit: str, local: tuple[LocalSize, ...]) -> None:
    """Refuses local sizes larger than the global size and tags the geometry does not have."""
    known = {
        "faces": {f.tag for f in reference.faces},
        "edges": {e.tag for e in reference.edges or []},
        "bodies": {b.tag for b in reference.bodies},
    }
    noun = {"faces": "face", "edges": "edge", "bodies": "body"}
    for item in local:
        unknown = [t for t in item.tags if t not in known[item.scope]]
        if unknown:
            hint = (
                " Upload the STEP file again to pick its edges."
                if item.scope == "edges" and reference.edges is None
                else ""
            )
            raise MeshFailure(
                "user_fault",
                "unknown_tags",
                f"The local size of {item.text} names {noun[item.scope]} "
                f"{', '.join(map(str, unknown))}, which the geometry does not have.{hint}",
            )
        if item.size > size * (1 + 1e-9):
            raise MeshFailure(
                "user_fault",
                "local_size_too_large",
                f"A local size of {item.text} is larger than the global size of "
                f"{_length(size, unit)}. Local sizes make the mesh finer; enter one no larger "
                "than the global size, or make the global size larger.",
            )


def check_size(
    reference: Topology, size: float, unit: str, local: tuple[LocalSize, ...] = ()
) -> None:
    """Refuses sizes that would give more elements than a Phase 0 mesh may have."""
    estimate = estimated_elements(reference, size, local)
    if estimate <= MAX_ELEMENTS:
        return
    if local:
        raise MeshFailure(
            "user_fault",
            "mesh_too_large",
            f"These mesh sizes would give about {_round_up(estimate, 2):,.0f} elements, more "
            f"than the {MAX_ELEMENTS:,} ClearFEA can mesh. Make the local sizes larger, or put "
            "them on fewer faces, edges or bodies.",
        )
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
    """The global size: no sizes from CAD points or curvature, so the size means what it says."""
    gmsh.option.setNumber("Mesh.MeshSizeMax", size)
    gmsh.option.setNumber("Mesh.MeshSizeFromPoints", 0)
    gmsh.option.setNumber("Mesh.MeshSizeFromCurvature", 0)
    gmsh.option.setNumber("Mesh.ElementOrder", order)
    # Mid-edge nodes of second-order elements lie on the curved CAD faces.
    gmsh.option.setNumber("Mesh.SecondOrderLinear", 0)


def _sampling(gmsh: ModuleType, dim: int, tags: tuple[int, ...], size: float) -> int:
    extent = 0.0
    for tag in tags:
        box = gmsh.model.getBoundingBox(dim, tag)
        extent = max(extent, math.dist(box[:3], box[3:]))
    return min(max(math.ceil(2 * extent / size) + 1, SAMPLING_MIN), SAMPLING_MAX)


def local_size_fields(gmsh: ModuleType, size: float, local: tuple[LocalSize, ...]) -> None:
    """Local sizes as Gmsh background fields, the smallest winning (ADR-045).

    A face or edge gets a Distance field and a Threshold on it: the local size on the entity,
    growing by GROWTH per unit of distance up to the global size. A body gets a Constant
    field of its size inside it and on its boundary. Without local sizes no field is set, so
    meshes made with only a global size are the ones M1.6 made.
    """
    if not any(item.tags for item in local):
        return
    field = gmsh.model.mesh.field
    fields = []
    for item in local:
        tags = list(item.tags)
        if not tags:
            continue
        if item.scope == "bodies":
            f = field.add("Constant")
            field.setNumbers(f, "VolumesList", tags)
            field.setNumber(f, "VIn", item.size)
            field.setNumber(f, "VOut", size)
            field.setNumber(f, "IncludeBoundary", 1)
            fields.append(f)
            continue
        dim = 2 if item.scope == "faces" else 1
        distance = field.add("Distance")
        field.setNumbers(distance, "SurfacesList" if dim == 2 else "CurvesList", tags)
        field.setNumber(distance, "Sampling", _sampling(gmsh, dim, item.tags, item.size))
        threshold = field.add("Threshold")
        field.setNumber(threshold, "InField", distance)
        field.setNumber(threshold, "SizeMin", item.size)
        field.setNumber(threshold, "SizeMax", size)
        field.setNumber(threshold, "DistMin", 0)
        field.setNumber(threshold, "DistMax", (size - item.size) / GROWTH)
        fields.append(threshold)
    smallest = field.add("Min")
    field.setNumbers(smallest, "FieldsList", fields)
    field.setAsBackgroundMesh(smallest)


def quality(gmsh: ModuleType) -> MeshQuality:
    """The mesh's quality summary: element shape (gamma) and the smallest scaled Jacobian."""
    shapes: list[float] = []
    jacobian = math.inf
    for _, body in gmsh.model.getEntities(3):
        _, tags, _ = gmsh.model.mesh.getElements(3, body)
        shapes.extend(float(q) for q in gmsh.model.mesh.getElementQualities(tags[0], "gamma"))
        jacobian = min(
            jacobian, *(float(q) for q in gmsh.model.mesh.getElementQualities(tags[0], "minSJ"))
        )
    histogram = [0] * 10
    for q in shapes:
        histogram[min(max(int(q * 10), 0), 9)] += 1
    return MeshQuality(
        shape_min=min(shapes),
        shape_mean=sum(shapes) / len(shapes),
        shape_histogram=histogram,
        jacobian_min=jacobian,
    )


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
    # The segments along each edge (ADR-105), for supports on edges: Gmsh's line elements,
    # whose nodes are the two ends and then, for order 2, the middle node.
    edges: dict[int, list[int]] = {}
    for _, curve in sorted(model.getEntities(1)):
        types, _, nodes = model.mesh.getElements(1, curve)
        if [int(t) for t in types] != [_LINE[order]]:
            raise MeshFailure(
                "platform_fault", "unexpected_elements", f"Edge {curve} has element types {types}."
            )
        edges[curve] = [index[int(n)] for n in nodes[0]]
    return VolumeMesh(order, positions, elements, bodies, faces, edges), patches


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
    local: tuple[LocalSize, ...] = (),
) -> MeshOutput:
    """Meshes ``step`` with a global ``size`` and ``local`` sizes in metres; writes mesh.bin
    and display.bin.

    ``unit`` is the unit the user entered the size in, used only in messages. Raises
    MeshFailure when the mesh cannot be made.
    """
    check_local(reference, size, unit, local)
    check_size(reference, size, unit, local)
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
        local_size_fields(gmsh, size, local)
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
        elements = len(gmsh.model.mesh.getElementsByType(_TETRAHEDRON[order])[0])
        if elements > MAX_ELEMENTS:
            raise MeshFailure(
                "user_fault",
                "mesh_too_large",
                f"The mesh has {elements:,} elements, more than the {MAX_ELEMENTS:,} ClearFEA "
                "can mesh. Make the mesh sizes larger.",
            )
        summary = quality(gmsh)
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
        quality=summary,
        software=MeshSoftware(gmsh=versions.gmsh, occt=versions.occt),
    )
    return MeshOutput(result, mesh_path, display_path)
