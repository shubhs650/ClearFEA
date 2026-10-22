# SPDX-License-Identifier: AGPL-3.0-or-later
# Generated from packages/spec/schemas by packages/spec/scripts/generate-python.sh.
# Do not edit by hand; change the schema and run `make spec`.

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

type Geometry = Annotated[Any, Field(title="Geometry")]
"""
Uploaded STEP geometry: the topology file the import job writes, the import job's parameters and result, and the wire shapes of /api/geometries (docs/ARCHITECTURE.md sections 3 and 4, ADR-023, ADR-024). Lengths are in metres. Each message is a definition under $defs.
"""


type LengthUnit = Annotated[str, Field(max_length=20, min_length=1)]
"""
A length unit symbol from packages/spec/units.json.
"""


type Vector3 = Annotated[list[float], Field(max_length=3, min_length=3)]


type BoundingBox = Annotated[list[float], Field(max_length=6, min_length=6)]
"""
xmin, ymin, zmin, xmax, ymax, zmax in metres.
"""


type FaceType = Literal["plane", "cylinder", "other"]


class UnitReading(BaseModel):
    """
    What the import job read about the file's length unit. Factors are metres per file unit.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    declared: str | None
    """
    The unit as the file writes it, for example SI_UNIT(.MILLI.,.METRE.) or 'INCH'; null when it declares none.
    """
    detected_unit: Annotated[LengthUnit | None, Field(alias="detectedUnit")]
    """
    The declared unit as a units.json symbol; null when the file declares none, several, an unsupported one, or one whose factor disagrees with the table. The user must then choose one.
    """
    problem: str | None
    """
    Why there is no detected unit, in plain language; null when there is one.
    """
    reading_factor: Annotated[float, Field(alias="readingFactor", gt=0.0)]
    """
    Metres per file coordinate that OpenCASCADE applies when importing the file as it is (ADR-024).
    """


class TopologyBody(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    tag: int
    name: Annotated[str | None, Field(min_length=1)] = None
    """
    The body's name from the STEP file (its part's name), when the file gives one (M4.1, ADR-058). Absent for geometries imported before M4.1 and for unnamed bodies.
    """
    volume: float
    """
    Cubic metres.
    """
    faces: list[int]


class TopologyFace(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    tag: int
    type: FaceType
    gmsh_type: Annotated[str, Field(alias="gmshType")]
    """
    Gmsh's own surface type name, for example Plane or BSpline surface.
    """
    area: float
    """
    Square metres.
    """
    centroid: Vector3
    bbox: BoundingBox
    bodies: list[int]


class TopologyEdge(BaseModel):
    """
    An edge (CAD curve) of the geometry (M2.8). points is a polyline along it, from the display tessellation, for drawing and picking it in the viewer; it is not part of the edge's identity.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    tag: int
    length: float
    """
    Metres.
    """
    bbox: BoundingBox
    faces: list[int]
    """
    The faces the edge bounds.
    """
    points: Annotated[list[float], Field(min_length=6)]
    """
    x, y, z of each polyline point in turn, in metres; a closed edge repeats its first point at the end.
    """


class TopologyBond(BaseModel):
    """
    Two faces of different bodies that touch over an area (M4.2): a candidate bond, which M4.3 ties unless the user removes it. Found by the import job within the topology's bondTolerance.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    faces: Annotated[list[int], Field(max_length=2, min_length=2)]
    """
    The two face tags, smaller first.
    """
    bodies: Annotated[list[int], Field(max_length=2, min_length=2)]
    """
    The body of each face, in the order of faces.
    """
    area: float
    """
    Square metres over which the faces lie within the tolerance of each other.
    """
    gap: float
    """
    Largest distance between the faces over that area, in metres; at most bondTolerance.
    """


class Software(BaseModel):
    """
    Versions that produced the tags. Tags are only stable for the same file and the same versions.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    gmsh: str
    occt: str


class Topology(BaseModel):
    """
    topology.json: the reference for face identity (ARCHITECTURE.md section 3). Written by the import job in metres, at the geometry's confirmed scale once the unit is confirmed.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    version: Literal[1]
    size: float
    """
    Diagonal of the model's bounding box, in metres.
    """
    bbox: BoundingBox
    unit: UnitReading
    scaling: Annotated[float, Field(gt=0.0)]
    """
    Geometry.OCCScaling the file was imported with: 1, or the confirmed unit's factor divided by the reading factor.
    """
    software: Software
    """
    Versions that produced the tags. Tags are only stable for the same file and the same versions.
    """
    bodies: list[TopologyBody]
    faces: list[TopologyFace]
    bond_tolerance: Annotated[float | None, Field(alias="bondTolerance", gt=0.0)] = None
    """
    Metres: faces of different bodies closer than this over an area are candidate bonds (M4.2). Absent for geometries imported before M4.2.
    """
    bonds: list[TopologyBond] | None = None
    """
    Candidate bonds between touching faces of different bodies (M4.2), sorted by face tags. Absent for geometries imported before M4.2, whose bonds cannot be detected until the file is uploaded again.
    """
    edges: list[TopologyEdge] | None = None
    """
    Every edge of the geometry (M2.8). Absent for geometries imported before M2.8, whose edges cannot be picked until the file is uploaded again.
    """


class ImportParams(BaseModel):
    """
    Parameters of an import job. confirmedUnit is null on the first import, which reads the file as it is.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    confirmed_unit: Annotated[LengthUnit | None, Field(alias="confirmedUnit")]


class ImportResult(BaseModel):
    """
    Result summary of a succeeded import job.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    unit: UnitReading
    scaling: Annotated[float, Field(gt=0.0)]
    bodies: Annotated[int, Field(ge=1)]
    faces: Annotated[int, Field(ge=1)]
    size: float
    bbox: BoundingBox
    display_triangles: Annotated[int, Field(alias="displayTriangles", ge=1)]


type GeometryStatus = Literal["importing", "needs_unit", "unconfirmed", "ready", "failed"]
"""
importing: an import job is queued or running. needs_unit: the file declares no usable unit and the user must choose one. unconfirmed: a unit was detected and awaits the user's confirmation. ready: the unit is confirmed and topology.json is at that scale. failed: the import failed; problem says why.
"""


class GeometryView(BaseModel):
    """
    A geometry as its owner sees it. Lengths in metres; the browser converts for display.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: str
    name: str
    """
    The uploaded file's name.
    """
    size_bytes: Annotated[int, Field(alias="sizeBytes")]
    status: GeometryStatus
    problem: str | None
    """
    Why the import failed, in plain language.
    """
    declared_unit: Annotated[str | None, Field(alias="declaredUnit")]
    detected_unit: Annotated[LengthUnit | None, Field(alias="detectedUnit")]
    unit_problem: Annotated[str | None, Field(alias="unitProblem")]
    reading_factor: Annotated[float | None, Field(alias="readingFactor")]
    """
    Metres per file coordinate as the file is read; with scaling it turns sizes back into the file's own numbers.
    """
    scaling: float | None
    """
    Geometry.OCCScaling of the current topology.
    """
    confirmed_unit: Annotated[LengthUnit | None, Field(alias="confirmedUnit")]
    unit_locked: Annotated[bool, Field(alias="unitLocked")]
    """
    True once a simulation uses the geometry: its face tags and sizes are then fixed, so the unit can no longer be changed (ADR-026).
    """
    body_count: Annotated[int | None, Field(alias="bodyCount")]
    face_count: Annotated[int | None, Field(alias="faceCount")]
    size: float | None
    """
    Bounding box diagonal in metres at the current scale.
    """
    bbox: BoundingBox | None
    created_at: Annotated[str, Field(alias="createdAt")]


class GeometryResponse(BaseModel):
    """
    Answer to POST /api/geometries (HTTP 201), GET /api/geometries/{id} and POST /api/geometries/{id}/unit.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    geometry: GeometryView
    wait: dict[str, Any] | None = None
    """
    On GET while the import job has not finished: a JobWait (jobs.schema.json), checked against that schema by the browser (M11.2, ADR-112).
    """


class GeometryListResponse(BaseModel):
    """
    Answer to GET /api/geometries[?projectId=]: the signed-in user's geometries, newest first, those of one project when it is named.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    geometries: list[GeometryView]


class ConfirmUnitRequest(BaseModel):
    """
    Body of POST /api/geometries/{id}/unit: the length unit the file is really in.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    unit: LengthUnit
