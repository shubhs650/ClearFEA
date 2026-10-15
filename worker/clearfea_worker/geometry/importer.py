# SPDX-License-Identifier: AGPL-3.0-or-later
"""STEP import with Gmsh: topology.json and the display mesh (ARCHITECTURE.md section 3).

The import follows ADR-023 and ADR-024: the declared length unit is read from the file
(``step_units``), Gmsh is asked for metres (``Geometry.OCCTargetUnit = "M"``, its default
is millimetres), and a unit the user corrects is applied by re-importing with
``Geometry.OCCScaling``, never by scaling after import. Every later job that imports the
same geometry must use ``import_options`` with the same scaling, or the face tags and
measures in topology.json no longer describe what it meshes.
"""

import json
import logging
import math
import re
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType

from ..spec.geometry_schema import (
    ImportResult,
    Software,
    Topology,
    TopologyBody,
    TopologyEdge,
    TopologyFace,
    UnitReading,
)
from ..units import default_table, to_si
from .display import FacePatch, write_display
from .step_units import Detection, StepFormatError, detect_length_unit

#: Display tessellation: elements per 2*pi of curvature, and the largest triangle edge as a
#: fraction of the model's bounding box diagonal (the values the M1.1 spike checked).
DISPLAY_CURVATURE_ELEMENTS = 16
DISPLAY_MAX_SIZE_FRACTION = 1 / 20

#: Points of an edge's display polyline (M2.8): straight edges need their two ends, curved
#: ones are sampled evenly in their parameter, which draws arcs smoothly at viewer scale.
EDGE_POINTS_CURVED = 49

log = logging.getLogger(__name__)

_FACE_TYPES = {"Plane": "plane", "Cylinder": "cylinder"}
#: Gmsh element type of a 3-node triangle.
_TRIANGLE = 2


class ImportFailure(Exception):
    """The file cannot be imported. ``message`` tells the user what to do about it."""

    def __init__(self, cause: str, message: str) -> None:
        super().__init__(message)
        self.cause = cause
        self.message = message


@dataclass(frozen=True)
class ImportOutput:
    result: ImportResult
    topology_path: Path
    display_path: Path


def supported_units() -> str:
    return ", ".join(default_table().kinds["length"].units)


def scaling_for(detection: Detection, confirmed_unit: str | None) -> float:
    """``Geometry.OCCScaling`` that makes the file read in ``confirmed_unit``."""
    if detection.reading_factor is None:
        raise ImportFailure(
            "unit_unreadable",
            f"{detection.problem} ClearFEA cannot tell how the coordinates are scaled. "
            f"Export the file again in one of these units: {supported_units()}.",
        )
    if confirmed_unit is None:
        return 1.0
    return to_si(1.0, confirmed_unit, "length") / detection.reading_factor


@contextmanager
def gmsh_session() -> Iterator[ModuleType]:
    import gmsh

    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        # One thread, so the same input gives the same tessellation (ADR-023).
        gmsh.option.setNumber("General.NumThreads", 1)
        yield gmsh
    finally:
        gmsh.finalize()


def import_options(gmsh: ModuleType, scaling: float) -> None:
    """The options every import of a geometry uses."""
    gmsh.option.setString("Geometry.OCCTargetUnit", "M")
    gmsh.option.setNumber("Geometry.OCCScaling", scaling)


def software(gmsh: ModuleType) -> Software:
    info = gmsh.option.getString("General.BuildInfo")
    occt = re.search(r"OCC version:\s*([0-9.]+)", info)
    return Software(
        gmsh=gmsh.option.getString("General.Version"),
        occt=occt.group(1) if occt else "unknown",
    )


def _bbox(gmsh: ModuleType, dim: int, tag: int) -> list[float]:
    return [float(v) for v in gmsh.model.getBoundingBox(dim, tag)]


def topology(gmsh: ModuleType, unit: UnitReading, scaling: float) -> Topology:
    model = gmsh.model
    bodies = []
    for _, vol in model.getEntities(3):
        _, faces = model.getAdjacencies(3, vol)
        bodies.append(
            TopologyBody(
                tag=vol,
                volume=model.occ.getMass(3, vol),
                faces=sorted(int(f) for f in faces),
            )
        )
    faces = []
    for _, tag in model.getEntities(2):
        up, _ = model.getAdjacencies(2, tag)
        kind = model.getType(2, tag)
        faces.append(
            TopologyFace(
                tag=tag,
                type=_FACE_TYPES.get(kind, "other"),
                gmsh_type=kind,
                area=model.occ.getMass(2, tag),
                centroid=[float(c) for c in model.occ.getCenterOfMass(2, tag)],
                bbox=_bbox(gmsh, 2, tag),
                bodies=sorted(int(b) for b in up),
            )
        )
    box = _bbox(gmsh, -1, -1)
    return Topology(
        version=1,
        size=math.dist(box[:3], box[3:]),
        bbox=box,
        unit=unit,
        scaling=scaling,
        software=software(gmsh),
        bodies=bodies,
        faces=faces,
        edges=edges(gmsh),
    )


def _rounded(value: float) -> float:
    """Seven significant digits: a display polyline needs no more, and topology.json stays small."""
    return float(f"{value:.7g}")


def edges(gmsh: ModuleType) -> list[TopologyEdge]:
    """Every edge of the model with its length, box and faces, and a polyline to draw it (M2.8).

    The polyline is sampled from the curve's own parametrisation, not from a mesh, so the mesh
    job's re-import finds the same edges without tessellating (its comparison leaves the
    points out). Degenerate edges of zero length (the apex of a cone) cannot be picked or
    sized and are left out.
    """
    model = gmsh.model
    result = []
    for _, tag in model.getEntities(1):
        length = model.occ.getMass(1, tag)
        if length <= 0:
            continue
        up, _ = model.getAdjacencies(1, tag)
        lo, hi = model.getParametrizationBounds(1, tag)
        n = 2 if model.getType(1, tag) == "Line" else EDGE_POINTS_CURVED
        params = [lo[0] + (hi[0] - lo[0]) * k / (n - 1) for k in range(n)]
        points = model.getValue(1, tag, params)
        result.append(
            TopologyEdge(
                tag=tag,
                length=length,
                bbox=_bbox(gmsh, 1, tag),
                faces=sorted(int(f) for f in up),
                points=[_rounded(float(c)) for c in points],
            )
        )
    return result


def tessellate(gmsh: ModuleType, size: float) -> list[FacePatch]:
    """A curvature-sized surface mesh of every face, separate from the analysis mesh."""
    gmsh.option.setNumber("Mesh.MeshSizeFromCurvature", DISPLAY_CURVATURE_ELEMENTS)
    gmsh.option.setNumber("Mesh.MeshSizeMax", size * DISPLAY_MAX_SIZE_FRACTION)
    model = gmsh.model
    model.mesh.generate(2)
    tags, coords, _ = model.mesh.getNodes()
    xyz = {
        int(t): (float(coords[3 * i]), float(coords[3 * i + 1]), float(coords[3 * i + 2]))
        for i, t in enumerate(tags)
    }
    patches = []
    for _, face in model.getEntities(2):
        types, _, nodes = model.mesh.getElements(2, face)
        local: dict[int, int] = {}
        positions: list[float] = []
        triangles: list[int] = []
        for kind, conn in zip(types, nodes, strict=True):
            if int(kind) != _TRIANGLE:
                raise RuntimeError(f"Face {face} was tessellated with element type {kind}.")
            for node in conn:
                node = int(node)
                if node not in local:
                    local[node] = len(local)
                    positions.extend(xyz[node])
                triangles.append(local[node])
        patches.append(FacePatch(face, positions, triangles))
    return patches


def import_geometry(step: Path, out_dir: Path, confirmed_unit: str | None) -> ImportOutput:
    """Imports ``step`` and writes topology.json and display.bin into ``out_dir``.

    ``confirmed_unit`` is the unit the user says the file is in, or None to read the file
    as it is. Raises ImportFailure when the file is the problem.
    """
    text = step.read_text(encoding="utf-8", errors="replace")
    try:
        detection = detect_length_unit(text)
    except StepFormatError:
        raise ImportFailure(
            "not_step",
            "The file is not a STEP file: it does not start with ISO-10303-21 or has no DATA "
            "section. Export the part from your CAD system as STEP (.step or .stp).",
        ) from None
    scaling = scaling_for(detection, confirmed_unit)
    unit = UnitReading(
        declared=detection.declared,
        detected_unit=detection.unit.symbol if detection.unit else None,
        problem=detection.problem,
        reading_factor=detection.reading_factor,
    )
    out_dir.mkdir(parents=True, exist_ok=True)
    with gmsh_session() as gmsh:
        import_options(gmsh, scaling)
        try:
            gmsh.model.occ.importShapes(str(step))
            gmsh.model.occ.synchronize()
        except Exception as error:
            log.info("Gmsh could not import %s: %s", step, error)
            raise ImportFailure(
                "step_unreadable",
                "Gmsh could not read the STEP file. Check that the file is complete, then "
                "export it again from your CAD system.",
            ) from None
        if not gmsh.model.getEntities(3):
            raise ImportFailure(
                "no_solids",
                "The file contains no solid bodies. ClearFEA analyses solids only; export "
                "the part as a solid body, not as surfaces.",
            )
        topo = topology(gmsh, unit, scaling)
        try:
            patches = tessellate(gmsh, topo.size)
        except Exception as error:
            log.info("Gmsh could not tessellate %s: %s", step, error)
            raise ImportFailure(
                "tessellation_failed",
                "Gmsh could not draw the faces of this part. The geometry may have faces "
                "that are broken or too small; repair them in your CAD system.",
            ) from None
    topology_path = out_dir / "topology.json"
    topology_path.write_text(
        json.dumps(topo.model_dump(mode="json", by_alias=True)), encoding="utf-8"
    )
    display_path = out_dir / "display.bin"
    triangles = write_display(display_path, patches)
    result = ImportResult(
        unit=unit,
        scaling=scaling,
        bodies=len(topo.bodies),
        faces=len(topo.faces),
        size=topo.size,
        bbox=topo.bbox,
        display_triangles=triangles,
    )
    return ImportOutput(result, topology_path, display_path)
