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


type OptionalQuantity = Quantity | None
"""
A Quantity, or null until the user has entered it.
"""


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
    density: Quantity | None = None
    """
    Mass density, a density quantity greater than zero (M2.3). Needed only by gravity and centrifugal loads; absent or null until entered.
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


type DisplacementComponent = Quantity | Literal["free"] | None
"""
One global component of a prescribed displacement: a length quantity (zero holds it, any other value moves the faces by that much), "free" when the component is not prescribed, or null until the user has chosen.
"""


class PrescribedDisplacement(BaseModel):
    """
    The faces' nodes moved by a given displacement in the global x, y and z directions; a free component is left to the solution. At least one component must have a value before a run.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: ItemId
    type: Literal["displacement"]
    name: ItemName
    faces: FaceTags
    x: DisplacementComponent
    y: DisplacementComponent
    z: DisplacementComponent


class FrictionlessSupport(BaseModel):
    """
    Each face held against moving along its own normal and free to slide in its plane, in both directions (it does not lift off). The support for symmetry planes. Flat faces only (DECISIONS.md, gate scope).
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: ItemId
    type: Literal["frictionless"]
    name: ItemName
    faces: FaceTags


type Support = FixedSupport | PrescribedDisplacement | FrictionlessSupport


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


class ForceLoad(BaseModel):
    """
    A total force in the global x, y and z directions spread over the faces in proportion to area, as a uniform traction (consistent nodal loads in the deck). Each component is a force quantity, null until entered.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: ItemId
    type: Literal["force"]
    name: ItemName
    faces: FaceTags
    x: OptionalQuantity
    y: OptionalQuantity
    z: OptionalQuantity


class GravityLoad(BaseModel):
    """
    The acceleration of gravity in the global x, y and z directions, acting on every body through its material's density: the weight points along it (z = -1 g for gravity downwards along z). Each component is an acceleration quantity, null until entered. Several gravity loads add up.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: ItemId
    type: Literal["gravity"]
    name: ItemName
    x: OptionalQuantity
    y: OptionalQuantity
    z: OptionalQuantity


class AxisPoint(BaseModel):
    """
    A point in global coordinates; each coordinate a length quantity, null until entered.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    x: OptionalQuantity
    y: OptionalQuantity
    z: OptionalQuantity


class AxisDirection(BaseModel):
    """
    A direction in global axes, dimensionless and of any length other than zero; each component null until entered.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    x: float | None
    y: float | None
    z: float | None


class CentrifugalLoad(BaseModel):
    """
    Every body spinning steadily about an axis: a body force density times angular velocity squared times the distance from the axis, pointing away from it. The sense of rotation does not matter. One per setup.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: ItemId
    type: Literal["centrifugal"]
    name: ItemName
    angular_velocity: Annotated[OptionalQuantity, Field(alias="angularVelocity")]
    """
    An angular velocity quantity; null until entered.
    """
    axis_point: Annotated[AxisPoint, Field(alias="axisPoint")]
    """
    A point on the axis of rotation.
    """
    axis_direction: Annotated[AxisDirection, Field(alias="axisDirection")]
    """
    The direction of the axis of rotation.
    """


class Components(BaseModel):
    """
    Components along the global x, y and z axes; each a quantity, null until entered.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    x: OptionalQuantity
    y: OptionalQuantity
    z: OptionalQuantity


class RemoteLoad(BaseModel):
    """
    A force and a moment acting at a reference point, carried to the faces as the statically equivalent linear traction (a deformable, distributing connection; consistent nodal loads in the deck). The force acting at the point also turns the faces about it. Force components are force quantities, moment components moment quantities, in global axes and right-handed; each null until entered.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: ItemId
    type: Literal["remote"]
    name: ItemName
    faces: FaceTags
    point: AxisPoint
    """
    The reference point the force and moment act at.
    """
    force: Components
    """
    The force at the reference point.
    """
    moment: Components
    """
    The moment at the reference point.
    """


type Load = PressureLoad | ForceLoad | RemoteLoad | GravityLoad | CentrifugalLoad


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
    Version 1: one linear static analysis of the bodies of one geometry, isotropic materials, fixed supports, prescribed displacements and frictionless supports (M2.2), pressures, forces, gravity and a centrifugal load (M2.3), and a global mesh size. Item types joining an array do not change version (ADR-026 item 1); version changes whenever the meaning or shape of existing data does; older stored specs are upgraded by code, never reinterpreted.
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
    supports: list[Support]
    loads: list[Load]
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


class SolveParams(BaseModel):
    """
    Parameters of a solve job (ADR-030): the run's frozen spec and the mesh it is solved on. The worker writes the deck from these two alone.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    mesh_id: Annotated[str, Field(alias="meshId")]
    """
    The mesh whose mesh.bin the job reads.
    """
    spec: SimulationSpec


type XYZ = Annotated[list[float], Field(max_length=3, min_length=3)]
"""
x, y and z components.
"""


class NodeValue(BaseModel):
    """
    A nodal result value and where it occurs. SI units; position in metres.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    value: float
    node: Annotated[int, Field(ge=0)]
    """
    Index of the node in mesh.bin, from 0.
    """
    position: XYZ


class SupportReaction(BaseModel):
    """
    Total reaction force of one support, in newtons: CalculiX's total for the support's node set when every support is fixed, otherwise the sum over its nodes of the force along the directions it holds, shared with other supports at nodes they also hold (ADR-039).
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    support_id: Annotated[ItemId, Field(alias="supportId")]
    force: XYZ


class Displacement(BaseModel):
    """
    Largest displacement magnitude.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    max: NodeValue


class VonMises(BaseModel):
    """
    Smallest and largest von Mises stress of CalculiX's nodal stresses.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    min: NodeValue
    max: NodeValue


class Software2(BaseModel):
    """
    Versions that solved the run.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    calculix: str


class SolveResult(BaseModel):
    """
    Result summary of a succeeded solve job (ADR-030). Displacement in metres, stress in pascals, forces in newtons.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    nodes: Annotated[int, Field(ge=4)]
    """
    Nodes with results; every node of the mesh.
    """
    displacement: Displacement
    """
    Largest displacement magnitude.
    """
    von_mises: Annotated[VonMises, Field(alias="vonMises")]
    """
    Smallest and largest von Mises stress of CalculiX's nodal stresses.
    """
    reactions: list[SupportReaction]
    """
    One entry per support, in spec order.
    """
    software: Annotated[Software2, Field(title="SolveSoftware")]
    """
    Versions that solved the run.
    """


type RunStatus = Literal["solving", "succeeded", "failed"]
"""
solving while the solve job is queued or running; succeeded or failed once it ends.
"""


class RunSoftware(BaseModel):
    """
    Versions that produced a run (ADR-032): gmsh and occt made its mesh; clearfea, deckFormat and calculix are the worker's that solved it. Null when not known, for example before the worker has reported or for runs made before M1.10.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    clearfea: str | None
    deck_format: Annotated[int | None, Field(alias="deckFormat")]
    calculix: str | None
    gmsh: str | None
    occt: str | None


class RunMesh(BaseModel):
    """
    The mesh a run was solved on, as it was made. Meshes do not change once ready.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    size: Quantity
    order: ElementOrder
    node_count: Annotated[int | None, Field(alias="nodeCount")]
    element_count: Annotated[int | None, Field(alias="elementCount")]


type RunFileName = Literal[
    "deck.inp", "solver.log", "results.frd", "results.dat", "surface.bin", "fields.bin"
]
"""
A file a solve job stores for its run. deck.inp and solver.log can be viewed and downloaded through GET /api/runs/{id}/files/{name}.
"""


class RunMachine(BaseModel):
    """
    The machine size a run was billed on and its rate, fixed when the run started (ADR-033). Money is in whole micro-credits: 1,000,000 is one credit.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    size: Annotated[str, Field(min_length=1)]
    rate_per_hour: Annotated[int, Field(alias="ratePerHour", ge=0)]
    """
    Micro-credits per hour of billable time.
    """


class RunCost(BaseModel):
    """
    What a finished run's solve job cost (ADR-033). billedSeconds is the measured time rounded up to whole seconds; amount is billedSeconds times the hourly rate over 3600, in micro-credits rounded to the nearest one. charged is false when the job failed through a fault in ClearFEA, which the user does not pay for; amount is then 0.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    billed_seconds: Annotated[int, Field(alias="billedSeconds", ge=0)]
    amount: Annotated[int, Field(ge=0)]
    charged: bool


class RunView(BaseModel):
    """
    A run as its owner sees it, with the record frozen when it started (ADR-030, ADR-032, ADR-033).
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: str
    simulation_id: Annotated[str, Field(alias="simulationId")]
    mesh_id: Annotated[str, Field(alias="meshId")]
    spec: SimulationSpec
    """
    The setup as it was saved when the run started.
    """
    mesh: RunMesh
    software: RunSoftware
    files: list[RunFileName]
    """
    The files stored for the run, known once it has finished; empty while it solves.
    """
    machine: RunMachine | None
    """
    Null for runs made before M1.11, which were not metered.
    """
    cost: RunCost | None
    """
    Known once the run has finished; null while it solves and for runs that were not metered.
    """
    status: RunStatus
    stage: str | None
    """
    What the solve job is doing: queued, then the worker's stage.
    """
    problem: str | None
    """
    Why the run failed, in plain language.
    """
    result: SolveResult | None
    created_at: Annotated[str, Field(alias="createdAt")]
    finished_at: Annotated[str | None, Field(alias="finishedAt")]


class RunResponse(BaseModel):
    """
    Answer to POST /api/simulations/{id}/runs (HTTP 201) and GET /api/runs/{id}.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    run: RunView


class RunListResponse(BaseModel):
    """
    Answer to GET /api/simulations/{id}/runs: the simulation's runs, newest first.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    runs: list[RunView]


class RunLogResponse(BaseModel):
    """
    Answer to GET /api/runs/{id}/log?after={n}: the solver log written after chunk n, and the n to ask with next time.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    text: str
    next: Annotated[int, Field(ge=0)]
