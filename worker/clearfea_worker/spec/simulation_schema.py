# SPDX-License-Identifier: AGPL-3.0-or-later
# Generated from packages/spec/schemas by packages/spec/scripts/generate-python.sh.
# Do not edit by hand; change the schema and run `make spec`.

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

type Simulation = Annotated[Any, Field(title="Simulation")]
"""
The SimulationSpec, the one document that describes a simulation's setup (docs/ARCHITECTURE.md section 4, ADR-006, ADR-026), and the wire shapes of /api/simulations. Physical quantities are stored as the user typed them, { value, unit }, and converted to SI only by the deck generator. A spec may be incomplete (null values, items without faces) so the setup can be saved as it is built; pre-run validation (M1.12) lists what is missing. Each message is a definition under $defs.
"""


class Quantity(BaseModel):
    """
    A physical value exactly as the user entered it. unit is a symbol from packages/spec/units.json of the kind the field names; a unit of the wrong kind is refused when the spec is saved.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    value: float
    unit: Annotated[str, Field(max_length=20, min_length=1)]


type ItemId = Annotated[str, Field(pattern="^[A-Za-z0-9_-]{1,64}$")]
"""
Identifier of a material, support or load, chosen by the client and unique within the spec.
"""


type ItemName = Annotated[str, Field(max_length=100, min_length=1)]
"""
The name shown in the simulation tree and the report.
"""


type FaceTags = list[int]
"""
Face tags from the geometry's topology.json (ARCHITECTURE.md section 3). Empty while the user has not picked any.
"""


type AnalysisType = Literal["linear_static"]
"""
linear_static: small-displacement linear elastic static analysis, one load step.
"""


class BodyAssignment(BaseModel):
    """
    A body of the geometry and the material it is made of. Every body of the geometry appears exactly once.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    tag: int
    """
    Body (volume) tag from topology.json.
    """
    material: ItemId | None
    """
    Id of an entry in materials; null until one is assigned.
    """


type PoissonsRatio = Annotated[float, Field(gt=-1.0, lt=0.5)]
"""
Poisson's ratio, dimensionless, between -1 and 0.5 exclusive; null until entered.
"""


class IsotropicMaterial(BaseModel):
    """
    A linear elastic isotropic material. The spec holds its own copy of the values, so a run made from it never changes when a library material does.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: ItemId
    name: ItemName
    model: Literal["isotropic_elastic"]
    youngs_modulus: Annotated[Quantity | None, Field(alias="youngsModulus")]
    """
    Young's modulus, a pressure quantity greater than zero; null until entered.
    """
    poissons_ratio: Annotated[PoissonsRatio | None, Field(alias="poissonsRatio")]
    """
    Poisson's ratio, dimensionless, between -1 and 0.5 exclusive; null until entered.
    """


class FixedSupport(BaseModel):
    """
    All displacement components of the faces' nodes held at zero.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: ItemId
    type: Literal["fixed"]
    name: ItemName
    faces: FaceTags


class PressureLoad(BaseModel):
    """
    A uniform pressure normal to each face. A positive magnitude pushes on the face towards the body (along the inward normal), as a fluid does; a negative one pulls (suction).
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: ItemId
    type: Literal["pressure"]
    name: ItemName
    faces: FaceTags
    magnitude: Quantity | None
    """
    A pressure quantity; null until entered.
    """


class MeshSettings(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    size: Quantity | None
    """
    Global element size, a length quantity greater than zero; null until entered.
    """


class SimulationSpec(BaseModel):
    """
    Version 1: one linear static analysis of the bodies of one geometry, isotropic materials, fixed supports, pressures and a global mesh size. version changes whenever the shape does; older stored specs are upgraded by code, never reinterpreted.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    version: Literal[1]
    analysis: AnalysisType
    geometry_id: Annotated[str, Field(alias="geometryId")]
    """
    The geometry whose face and body tags the spec uses.
    """
    bodies: list[BodyAssignment]
    materials: list[IsotropicMaterial]
    supports: list[FixedSupport]
    loads: list[PressureLoad]
    mesh: MeshSettings


class SimulationView(BaseModel):
    """
    A simulation as its owner sees it.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: str
    name: ItemName
    geometry_id: Annotated[str, Field(alias="geometryId")]
    spec: SimulationSpec
    created_at: Annotated[str, Field(alias="createdAt")]
    updated_at: Annotated[str, Field(alias="updatedAt")]


class CreateSimulationRequest(BaseModel):
    """
    Body of POST /api/simulations. The geometry must be ready (its unit confirmed); from then on its unit is locked. Without spec the simulation starts empty, with every body of the geometry listed and no material assigned.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    geometry_id: Annotated[str, Field(alias="geometryId")]
    name: ItemName
    spec: SimulationSpec | None = None


class SimulationResponse(BaseModel):
    """
    Answer to POST /api/simulations (HTTP 201), GET /api/simulations/{id} and PUT /api/simulations/{id}/spec.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    simulation: SimulationView


class SimulationListResponse(BaseModel):
    """
    Answer to GET /api/simulations[?geometryId=]: the signed-in user's simulations, newest first.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    simulations: list[SimulationView]


type ElementOrder = Literal[1, 2]
"""
1: four-node tetrahedra. 2: ten-node tetrahedra with curved edges on curved faces. Phase 0 meshes always use 2 until M2.8 offers the choice (ADR-028).
"""


class MeshParams(BaseModel):
    """
    Parameters of a mesh job (ADR-028). The worker re-imports the geometry's STEP file with scaling, checks it against topology.json, and meshes it with tetrahedra no larger than size.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    geometry_id: Annotated[str, Field(alias="geometryId")]
    """
    The geometry whose model.step and topology.json the job reads.
    """
    scaling: Annotated[float, Field(gt=0.0)]
    """
    Geometry.OCCScaling of the geometry's topology.json; the re-import must use the same.
    """
    size: Quantity
    """
    Global element size as the user entered it (a length quantity); the worker converts it to metres.
    """
    order: ElementOrder


class Software(BaseModel):
    """
    Versions that made the mesh.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    gmsh: str
    occt: str


class MeshResult(BaseModel):
    """
    Result summary of a succeeded mesh job.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    order: ElementOrder
    nodes: Annotated[int, Field(ge=4)]
    elements: Annotated[int, Field(ge=1)]
    """
    Tetrahedra in the volume mesh.
    """
    surface_triangles: Annotated[int, Field(alias="surfaceTriangles", ge=1)]
    """
    Triangles in the mesh display file.
    """
    software: Software
    """
    Versions that made the mesh.
    """


type MeshStatus = Literal["meshing", "ready", "failed"]
"""
meshing: the mesh job is queued or running. ready: the mesh and its display file exist. failed: problem says why.
"""


class MeshView(BaseModel):
    """
    A mesh as its owner sees it.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: str
    geometry_id: Annotated[str, Field(alias="geometryId")]
    size: Quantity
    """
    The global size the mesh was made with, as entered.
    """
    order: ElementOrder
    status: MeshStatus
    problem: str | None
    """
    Why meshing failed, in plain language.
    """
    node_count: Annotated[int | None, Field(alias="nodeCount")]
    element_count: Annotated[int | None, Field(alias="elementCount")]
    created_at: Annotated[str, Field(alias="createdAt")]


class MeshResponse(BaseModel):
    """
    Answer to POST /api/simulations/{id}/mesh (HTTP 201) and GET /api/meshes/{id}.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    mesh: MeshView


class SimulationMeshResponse(BaseModel):
    """
    Answer to GET /api/simulations/{id}/mesh: the simulation's latest mesh, or null before the first one is requested.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    mesh: MeshView | None
