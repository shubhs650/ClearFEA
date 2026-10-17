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


type AnalysisType = Literal["linear_static", "steady_thermal", "thermal_stress", "modal"]
"""
linear_static: small-displacement linear elastic static analysis, one load step. steady_thermal: steady-state heat conduction, one step (M5.1, ADR-064), with convection and radiation from faces (M5.2); it solves temperatures only, so it uses thermal loads and no supports. thermal_stress: a steady-state thermal step followed by a linear static step on the temperatures it solved, in one deck (M5.4, ADR-067); it uses supports, the structural loads other than a uniform temperature change, and the thermal loads, and needs the spec's stressFreeTemperature. modal: the natural frequencies of the bodies as they are held, one *FREQUENCY step (M6.1, ADR-070); it uses supports and no loads, and needs the spec's modes; bodies no support holds have rigid-body modes at or near zero.
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


type BondStatus = Literal["detected", "accepted", "removed"]
"""
detected: found by bond detection and not yet reviewed; it is tied. accepted: the user reviewed it and keeps it; it is tied. removed: the user removed it; it is not tied, and stays listed so it can be restored.
"""


class Bond(BaseModel):
    """
    A candidate bond of the geometry (topology.json bonds, M4.2) and what the user decided about it. A bond is identified by its two faces.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    faces: Annotated[list[int], Field(max_length=2, min_length=2)]
    """
    The two face tags of a candidate bond, smaller first.
    """
    status: BondStatus


type PoissonsRatio = Annotated[float, Field(gt=-1.0, lt=0.5)]
"""
Poisson's ratio, dimensionless, between -1 and 0.5 exclusive; null until entered.
"""


class PropertyTableRow(BaseModel):
    """
    One row of a property table: a temperature and the property's value there, as typed in the table's units; either is null until entered.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    temperature: float | None
    value: float | None


class PropertyTable(BaseModel):
    """
    A material property that varies with temperature (M5.5, ADR-068): rows of a temperature and the value there, in rising temperature, at least two. Between rows the value is interpolated linearly; below the first row and above the last it is the first and last value (as CalculiX does). temperatureUnit is a temperature unit and unit a unit of the property's kind from packages/spec/units.json; unit is absent for Poisson's ratio. Used in place of the material's single value by steady-state thermal and thermal stress analyses, whose temperatures are solved; a linear static analysis uses the single value.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    temperature_unit: Annotated[str, Field(alias="temperatureUnit", max_length=20, min_length=1)]
    unit: Annotated[str | None, Field(max_length=20, min_length=1)] = None
    rows: Annotated[list[PropertyTableRow], Field(max_length=50)]


class ExpansionTable(BaseModel):
    """
    A thermal expansion coefficient that varies with temperature (M5.5, ADR-068): a PropertyTable of mean (secant) coefficients, each measured from referenceTemperature, as handbooks print them: the thermal strain at T is alpha(T) (T - referenceTemperature), counted from the stress-free temperature. referenceTemperature is a temperature quantity, null until entered.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    temperature_unit: Annotated[str, Field(alias="temperatureUnit", max_length=20, min_length=1)]
    unit: Annotated[str, Field(max_length=20, min_length=1)]
    rows: Annotated[list[PropertyTableRow], Field(max_length=50)]
    reference_temperature: Annotated[OptionalQuantity, Field(alias="referenceTemperature")]


class MaterialReference(BaseModel):
    """
    A document the material library cites.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: Annotated[str, Field(min_length=1)]
    citation: Annotated[str, Field(min_length=1)]
    links: list[str]


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


class ElasticSupport(BaseModel):
    """
    The faces rest on an elastic foundation (M2.6): at every point the foundation pushes back along the face's normal with a pressure equal to the stiffness times the displacement along the normal, in both directions (it does not lift off). It does not resist sliding along the faces. Written as grounded springs along the normal at each node, each with the stiffness times the node's share of the face area.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: ItemId
    type: Literal["elastic"]
    name: ItemName
    faces: FaceTags
    stiffness: OptionalQuantity
    """
    Foundation stiffness, the pressure per unit of normal displacement, a foundationStiffness quantity greater than zero.
    """


type Support = FixedSupport | PrescribedDisplacement | FrictionlessSupport | ElasticSupport


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


class TemperatureLoad(BaseModel):
    """
    A uniform temperature change of every body from the stress-free state (M2.7): each material expands by its thermal expansion coefficient times the change, and the supports resist it. change is a temperatureDifference quantity, null until entered; a fall is negative. One per setup.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: ItemId
    type: Literal["temperature"]
    name: ItemName
    change: OptionalQuantity


class FixedTemperatureLoad(BaseModel):
    """
    The faces held at one temperature in a steady-state thermal analysis (M5.1, ADR-064). temperature is an absolute temperature quantity (with its offset: 20 °C is 293.15 K), null until entered.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: ItemId
    type: Literal["fixed_temperature"]
    name: ItemName
    faces: FaceTags
    temperature: OptionalQuantity


class HeatFluxLoad(BaseModel):
    """
    A uniform heat flux through faces in a steady-state thermal analysis (M5.2). flux is a heatFlux quantity, positive into the body and negative out of it, null until entered.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: ItemId
    type: Literal["heat_flux"]
    name: ItemName
    faces: FaceTags
    flux: OptionalQuantity


class ConvectionLoad(BaseModel):
    """
    Convection from faces to a surrounding fluid in a steady-state thermal analysis (M5.2): the heat leaving a face is coefficient x (surface temperature - ambientTemperature). coefficient is a heatTransferCoefficient quantity greater than zero; ambientTemperature an absolute temperature quantity above 0 K; each null until entered.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: ItemId
    type: Literal["convection"]
    name: ItemName
    faces: FaceTags
    coefficient: OptionalQuantity
    ambient_temperature: Annotated[OptionalQuantity, Field(alias="ambientTemperature")]


type Emissivity = Annotated[float, Field(gt=0.0, le=1.0)]


class RadiationLoad(BaseModel):
    """
    Radiation from faces to surroundings at one temperature in a steady-state thermal analysis (M5.2): the heat leaving a face is emissivity x Stefan-Boltzmann constant x (surface temperature^4 - ambientTemperature^4), every face seeing only the surroundings. emissivity is dimensionless, above 0 and at most 1; ambientTemperature an absolute temperature quantity above 0 K; each null until entered.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: ItemId
    type: Literal["radiation"]
    name: ItemName
    faces: FaceTags
    emissivity: Emissivity | None
    ambient_temperature: Annotated[OptionalQuantity, Field(alias="ambientTemperature")]


class HeatGenerationLoad(BaseModel):
    """
    Heat produced uniformly inside bodies in a steady-state thermal analysis (M5.2). bodies are body tags of the geometry, empty until picked; power is a heatGeneration quantity (per unit of volume), negative for heat absorbed, null until entered.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: ItemId
    type: Literal["heat_generation"]
    name: ItemName
    bodies: list[int]
    power: OptionalQuantity


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


class HydrostaticLoad(BaseModel):
    """
    The pressure of a still fluid on the faces: p = density × (gravity · (x − s)) at a point x at or below the free surface through s, zero above it. The fluid is on the outside of each face, so the pressure pushes on the face towards the body. Consistent nodal loads in the deck. Each value null until entered.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: ItemId
    type: Literal["hydrostatic"]
    name: ItemName
    faces: FaceTags
    fluid_density: Annotated[OptionalQuantity, Field(alias="fluidDensity")]
    """
    The fluid's density, a density quantity.
    """
    gravity: Components
    """
    The acceleration of gravity acting on the fluid, acceleration quantities in global axes (z = -1 g for gravity downwards along z). Depth is measured along it; it is not applied to the bodies (add a gravity load for their weight).
    """
    free_surface: Annotated[AxisPoint, Field(alias="freeSurface")]
    """
    A point on the fluid's free surface, the plane normal to gravity where the pressure is zero.
    """


type Load = (
    PressureLoad
    | ForceLoad
    | RemoteLoad
    | HydrostaticLoad
    | GravityLoad
    | CentrifugalLoad
    | TemperatureLoad
    | FixedTemperatureLoad
    | HeatFluxLoad
    | ConvectionLoad
    | RadiationLoad
    | HeatGenerationLoad
)


type LocalMeshScope = Literal["faces", "edges", "bodies"]
"""
What a local mesh size applies to: faces, edges or bodies of the geometry, by their topology.json tags.
"""


class LocalMeshSize(BaseModel):
    """
    A smaller element size on some faces, edges or bodies (M2.8, ADR-045). The mesh grows from it to the global size away from them.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: ItemId
    name: ItemName
    scope: LocalMeshScope
    tags: list[int]
    """
    Face, edge or body tags, as scope says; empty until picked.
    """
    size: Quantity | None
    """
    Element size on them, a length quantity greater than zero and no larger than the global size; null until entered.
    """


type Solver = Literal["pastix", "spooles", "iterative_cholesky", "iterative_scaling"]
"""
CalculiX's equation solver for a run (ADR-063). pastix, the default, and spooles are direct solvers, verified to the 0.1 percent checks. iterative_cholesky and iterative_scaling need far less memory but stop at CalculiX 2.21's fixed relative residual of 1e-4, which left verification results up to about 0.5 percent off.
"""


type Modes = Annotated[int, Field(ge=1, le=100)]
"""
How many natural frequencies a modal analysis finds, the lowest first (M6.1, ADR-070); absent or null until entered.
"""


type ElementOrder = Literal[1, 2]
"""
1: four-node tetrahedra (CalculiX C3D4). 2: ten-node tetrahedra with curved edges on curved faces (C3D10), the default (ADR-028, ADR-045).
"""


class LocalSizeParams(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    scope: LocalMeshScope
    tags: list[int]
    """
    Never empty when sent by the API.
    """
    size: Quantity


type ShapeHistogramItem = Annotated[int, Field(ge=0)]


class MeshQuality(BaseModel):
    """
    Quality summary of a mesh (M2.8, ADR-045). shape is Gmsh's gamma, the inscribed to circumscribed sphere radius ratio scaled so a regular tetrahedron is 1 and a flat one 0. jacobianMin is the smallest scaled Jacobian of any element, 1 for an undistorted one; curved second-order elements fall below 1.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    shape_min: Annotated[float, Field(alias="shapeMin")]
    shape_mean: Annotated[float, Field(alias="shapeMean")]
    shape_histogram: Annotated[
        list[ShapeHistogramItem],
        Field(alias="shapeHistogram", max_length=10, min_length=10),
    ]
    """
    Number of elements with shape in [0, 0.1), [0.1, 0.2), ... [0.9, 1].
    """
    jacobian_min: Annotated[float, Field(alias="jacobianMin")]


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
    quality: MeshQuality
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
    local: list[LocalSizeParams]
    """
    The local sizes the mesh was made with, as entered (M2.8).
    """
    status: MeshStatus
    problem: str | None
    """
    Why meshing failed, in plain language.
    """
    node_count: Annotated[int | None, Field(alias="nodeCount")]
    element_count: Annotated[int | None, Field(alias="elementCount")]
    quality: MeshQuality | None
    """
    Null until the mesh is ready, and for meshes made before M2.8.
    """
    created_at: Annotated[str, Field(alias="createdAt")]


class MeshResponse(BaseModel):
    """
    Answer to POST /api/simulations/{id}/mesh (HTTP 201 for a new mesh, 200 when a mesh with the same settings hash is reused, ADR-047) and GET /api/meshes/{id}.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    mesh: MeshView
    reused: bool | None = None
    """
    Present on POST /api/simulations/{id}/mesh: true when an existing mesh of the same geometry, unit and mesh settings was reused, so no mesh job was queued or charged.
    """


class SimulationMeshResponse(BaseModel):
    """
    Answer to GET /api/simulations/{id}/mesh: the simulation's latest mesh, or null before the first one is requested.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    mesh: MeshView | None


class SimulatedMachine(BaseModel):
    """
    How the worker simulates the run's machine size on one physical machine (M8.5, ADR-082): the solver process is held to `cores` processors and is stopped as out of memory when its resident memory passes memoryLimitBytes, the size's usable memory (the estimator's usableMemoryFraction of it). Jobs queued before M8.5 have none and run unlimited.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    size: Annotated[str, Field(min_length=1)]
    """
    The machine size's name.
    """
    cores: Annotated[int, Field(ge=1)]
    """
    Processors the solver process may run on.
    """
    memory_limit_bytes: Annotated[int, Field(alias="memoryLimitBytes", ge=1)]
    """
    Resident memory past which the solver is stopped as out of memory.
    """


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
    Total reaction of one support: the sum over its nodes of the force along the directions it holds, shared with other supports at nodes they also hold (ADR-039), with the loads applied at those nodes taken out (ADR-040, ADR-051); an elastic support's is its springs' force (ADR-043). Forces in newtons, moment in newton metres, point in metres. Runs solved before M3.2 have no moment or point.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    support_id: Annotated[ItemId, Field(alias="supportId")]
    force: XYZ
    moment: XYZ | None = None
    """
    Moment of the reaction about point.
    """
    point: XYZ | None = None
    """
    The area centroid of the support's faces, which the moment is taken about.
    """


class LoadTotal(BaseModel):
    """
    Total force (N) of one load as the solver applies it, and its moment about the origin (N·m) (ADR-051). A temperature change applies none.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    load_id: Annotated[ItemId, Field(alias="loadId")]
    force: XYZ
    moment: XYZ


class BalanceCheck(BaseModel):
    """
    Applied loads against reactions, both about the origin (ADR-051). The imbalance is applied plus reactions; forceRatio is its size over forceScale, the larger of the loads' gross size (the sum of the sizes of their nodal forces, so a load that cancels itself is still measured against its size) and the sum of the reactions' sizes, and momentRatio its moment's size over momentScale, the largest of the applied moment's size, the sum of the reactions' moment sizes about the origin and forceScale times the mesh's bounding-box diagonal. Numbers only; no verdict.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    applied_force: Annotated[XYZ, Field(alias="appliedForce")]
    applied_moment: Annotated[XYZ, Field(alias="appliedMoment")]
    reaction_force: Annotated[XYZ, Field(alias="reactionForce")]
    reaction_moment: Annotated[XYZ, Field(alias="reactionMoment")]
    force_scale: Annotated[float, Field(alias="forceScale", ge=0.0)]
    moment_scale: Annotated[float, Field(alias="momentScale", ge=0.0)]
    force_ratio: Annotated[float, Field(alias="forceRatio", ge=0.0)]
    moment_ratio: Annotated[float, Field(alias="momentRatio", ge=0.0)]


class HeatFlow(BaseModel):
    """
    Net heat flow (W) of one load of a steady-state thermal run into the body, positive in, negative out (M5.3). A fixed temperature's is the heat its faces take in or give out, from the solver's nodal heat flows with the heat other loads apply at its nodes taken out; a heat flux's, a convection's and a radiation's are integrated over their faces as the solver does, the last two at the solved surface temperatures; a heat generation's is its power times the volume of its bodies.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    load_id: Annotated[ItemId, Field(alias="loadId")]
    heat: float


class HeatBalance(BaseModel):
    """
    Heat in against heat out of a steady-state thermal run (M5.3). heatIn is the sum of the loads' heat flows into the body, heatOut the sum of those out of it (positive); ratio is |heatIn - heatOut| over scale, half the sum of the sizes of every load's nodal heat flows, which equals heatIn and heatOut when no load both heats and cools, so a convection that heats part of a face and cools the rest is still measured against its own size. Numbers only; no verdict.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    heat_in: Annotated[float, Field(alias="heatIn", ge=0.0)]
    heat_out: Annotated[float, Field(alias="heatOut", ge=0.0)]
    scale: Annotated[float, Field(ge=0.0)]
    ratio: Annotated[float, Field(ge=0.0)]


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


class Temperature(BaseModel):
    """
    Smallest and largest nodal temperature of a steady-state thermal run, in kelvin (M5.1).
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    min: NodeValue
    max: NodeValue


class HeatFlux(BaseModel):
    """
    Largest heat flux magnitude of a steady-state thermal run, in W/m², from CalculiX's nodal heat flux (M5.3). Absent for thermal runs solved before M5.3.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    max: NodeValue


class SafetyFactor(BaseModel):
    """
    Smallest safety factor against yield over every node of the mesh: the yield strength of the node's material over its von Mises stress, at most 15 (ADR-054). Absent when a material of the setup has no yield strength, and for runs solved before M3.5.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    min: NodeValue


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
    Result summary of a succeeded solve job (ADR-030). Displacement in metres, stress in pascals, forces in newtons, temperature in kelvin, heat flux in W/m², heat flows in watts. A linear static run has displacement, vonMises and reactions; a steady-state thermal run has temperature instead (M5.1, ADR-064), and since M5.3 heatFlux, heatFlows and heatBalance. A modal run has frequencies only (M6.1, ADR-070).
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    nodes: Annotated[int, Field(ge=4)]
    """
    Nodes with results; every node of the mesh.
    """
    displacement: Displacement | None = None
    """
    Largest displacement magnitude.
    """
    von_mises: Annotated[VonMises | None, Field(alias="vonMises")] = None
    """
    Smallest and largest von Mises stress of CalculiX's nodal stresses.
    """
    temperature: Temperature | None = None
    """
    Smallest and largest nodal temperature of a steady-state thermal run, in kelvin (M5.1).
    """
    heat_flux: Annotated[HeatFlux | None, Field(alias="heatFlux")] = None
    """
    Largest heat flux magnitude of a steady-state thermal run, in W/m², from CalculiX's nodal heat flux (M5.3). Absent for thermal runs solved before M5.3.
    """
    heat_flows: Annotated[list[HeatFlow] | None, Field(alias="heatFlows")] = None
    """
    One entry per thermal load of a steady-state thermal run, in spec order (M5.3). Absent for thermal runs solved before M5.3.
    """
    heat_balance: Annotated[HeatBalance | None, Field(alias="heatBalance")] = None
    """
    Absent for thermal runs solved before M5.3.
    """
    frequencies: list[float] | None = None
    """
    The natural frequencies of a modal run in hertz, lowest first: entry k is mode k + 1 (M6.1, ADR-070). Each is the square root of CalculiX's eigenvalue (rad²/s²) over 2π; an eigenvalue below zero, which only rounding gives (the rigid-body modes of a body free to move), gives minus the square root of its size over 2π.
    """
    reactions: list[SupportReaction] | None = None
    """
    One entry per support, in spec order.
    """
    loads: list[LoadTotal] | None = None
    """
    One entry per load, in spec order. Absent for runs solved before M3.2.
    """
    balance: BalanceCheck | None = None
    """
    Absent for runs solved before M3.2.
    """
    safety_factor: Annotated[SafetyFactor | None, Field(alias="safetyFactor")] = None
    """
    Smallest safety factor against yield over every node of the mesh: the yield strength of the node's material over its von Mises stress, at most 15 (ADR-054). Absent when a material of the setup has no yield strength, and for runs solved before M3.5.
    """
    software: Annotated[Software2, Field(title="SolveSoftware")]
    """
    Versions that solved the run.
    """


type RunStatus = Literal["solving", "succeeded", "failed", "cancelled"]
"""
solving while the solve job is queued or running; succeeded, failed or cancelled (by its owner, M8.2) once it ends.
"""


class RunProgress(BaseModel):
    """
    A solving run as it goes (M8.2): when the worker took it (null while queued), the time since then when the answer was made, what that time costs so far at the run's rate (elapsed time rounded up to whole seconds, as metering bills it; null while queued and for runs that are not metered), and whether its owner has asked to cancel it and the worker has not stopped yet.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    started_at: Annotated[str | None, Field(alias="startedAt")]
    elapsed_ms: Annotated[int | None, Field(alias="elapsedMs", ge=0)]
    cost_so_far: Annotated[int | None, Field(alias="costSoFar", ge=0)]
    """
    Micro-credits.
    """
    cancelling: bool


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
    "deck.inp", "solver.log", "results.frd", "results.dat", "surface.bin", "fields.bin", "nodes.bin"
]
"""
A file a solve job stores for its run. deck.inp and solver.log can be viewed and downloaded through GET /api/runs/{id}/files/{name}; results.frd and results.dat, the raw solver output, can be downloaded there while they are kept (M8.6, ADR-086).
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


class SizeEstimate(BaseModel):
    """
    What a run is estimated to cost on one machine size (M2.12, ADR-049). Money is in whole micro-credits: 1,000,000 is one credit.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    size: Annotated[str, Field(min_length=1)]
    cores: Annotated[int, Field(ge=1)]
    memory_bytes: Annotated[int, Field(alias="memoryBytes", ge=1)]
    """
    The machine size's memory.
    """
    rate_per_hour: Annotated[int, Field(alias="ratePerHour", ge=0)]
    """
    Micro-credits per hour of billable time.
    """
    cost: Annotated[int, Field(ge=0)]
    """
    The estimated seconds, billed at this size's rate.
    """
    fits: bool
    """
    Whether the size's usable memory holds the estimated peak memory with the estimator's margin.
    """


class RunEstimate(BaseModel):
    """
    Memory, time and cost estimated for solving a simulation on its mesh, from the estimator's fitted coefficients (packages/spec/estimator.json, ADR-049), and the machine size recommended: the smallest that fits, or null when none does.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    estimator: Annotated[int, Field(ge=1)]
    """
    Version of estimator.json that made the estimate.
    """
    nodes: Annotated[int, Field(ge=0)]
    """
    The mesh's node count the estimate is made from.
    """
    memory_bytes: Annotated[int, Field(alias="memoryBytes", ge=0)]
    """
    Estimated peak memory of the solver.
    """
    seconds: Annotated[int, Field(ge=0)]
    """
    Estimated billable time of the solve job, whole seconds.
    """
    extrapolated: bool
    """
    True when the mesh is larger than any the estimator was fitted on, so the estimate is less certain.
    """
    sizes: list[SizeEstimate]
    recommended: str | None
    solver: Solver | None = None
    """
    The solver the estimate is for (ADR-063); absent in estimates made before it, which were for spooles.
    """
    analysis: AnalysisType | None = None
    """
    The analysis the estimate is for (M6.3); absent in estimates made before it, which used the linear static model for every analysis.
    """
    modes: Annotated[int | None, Field(ge=1)] = None
    """
    The modes a modal estimate is for (M6.3); absent for other analyses.
    """


class EstimateResponse(BaseModel):
    """
    Answer to GET /api/simulations/{id}/estimate: the estimate for the simulation's current ready mesh.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    estimate: RunEstimate


class CreateRunRequest(BaseModel):
    """
    Body of POST /api/simulations/{id}/runs, which may also be sent empty. machineSize names the machine size to run on; without it the run takes the recommended size (the largest when none fits).
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    machine_size: Annotated[str | None, Field(alias="machineSize", min_length=1)] = None


class RunRawOutput(BaseModel):
    """
    What happens to a run's raw solver output, results.frd and results.dat (M8.6, ADR-086). It is removed by the daily storage sweep once the retention period after the run ended has passed, unless the run is pinned; running the same setup again regenerates it. Everything else a run keeps is kept permanently.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    pinned: bool
    """
    True when the owner pinned the run, so its raw output is kept.
    """
    kept_until: Annotated[str | None, Field(alias="keptUntil")]
    """
    When the retention period ends: the run's end time plus the retention days. Null while the run solves, when it is pinned, when its job stored no raw output, or after the raw output was removed. The sweep after this time removes the output.
    """
    removed_at: Annotated[str | None, Field(alias="removedAt")]
    """
    When the sweep removed the raw output; null while it is kept.
    """
    rerun_of: Annotated[str | None, Field(alias="rerunOf")]
    """
    The run whose frozen setup and mesh this run solved again (POST /api/runs/{id}/rerun), or null.
    """


class PinRunRequest(BaseModel):
    """
    Body of PUT /api/runs/{id}/pin: pin the run so its raw solver output is kept, or unpin it so the retention period applies again.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    pinned: bool


class ShareLinkView(BaseModel):
    """
    A run's active read-only share link as its owner sees it (M8.7). Only a hash of the link's token is stored, so the link itself is shown once, when it is made.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    created_at: Annotated[str, Field(alias="createdAt")]


class ShareLinkResponse(BaseModel):
    """
    Answer to GET and DELETE /api/runs/{id}/share: the run's active share link, or null when it has none (after DELETE, always null).
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    share: ShareLinkView | None


class CreatedShareLinkResponse(BaseModel):
    """
    Answer to POST /api/runs/{id}/share (HTTP 201): the new link and its token, which opens the run read-only at /share/{token} until it is revoked. Making a link revokes the run's earlier one.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    share: ShareLinkView
    token: Annotated[str, Field(pattern="^[A-Za-z0-9_-]{43}$")]


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
    thermal_expansion: Annotated[Quantity | None, Field(alias="thermalExpansion")] = None
    """
    Coefficient of linear thermal expansion, a thermalExpansion quantity (M2.7); zero and negative values are allowed. Needed only by a temperature change and a thermal stress analysis; absent or null until entered.
    """
    thermal_conductivity: Annotated[Quantity | None, Field(alias="thermalConductivity")] = None
    """
    Thermal conductivity, a thermalConductivity quantity greater than zero (M5.1, ADR-064). Needed only by a steady-state thermal and a thermal stress analysis; absent or null until entered.
    """
    youngs_modulus_table: Annotated[PropertyTable | None, Field(alias="youngsModulusTable")] = None
    """
    Young's modulus against temperature (M5.5, ADR-068), a PropertyTable of pressures; absent or null when it does not vary.
    """
    poissons_ratio_table: Annotated[PropertyTable | None, Field(alias="poissonsRatioTable")] = None
    """
    Poisson's ratio against temperature (M5.5, ADR-068), a PropertyTable without unit; absent or null when it does not vary.
    """
    thermal_expansion_table: Annotated[
        ExpansionTable | None, Field(alias="thermalExpansionTable")
    ] = None
    """
    Thermal expansion against temperature (M5.5, ADR-068), an ExpansionTable; absent or null when it does not vary.
    """
    thermal_conductivity_table: Annotated[
        PropertyTable | None, Field(alias="thermalConductivityTable")
    ] = None
    """
    Thermal conductivity against temperature (M5.5, ADR-068), a PropertyTable of thermal conductivities; absent or null when it does not vary.
    """
    yield_strength: Annotated[Quantity | None, Field(alias="yieldStrength")] = None
    """
    Tensile yield strength, a pressure quantity greater than zero (M3.5, ADR-054). Needed only for the safety factor against yield, which the result shows when every material of the setup has one; absent or null until entered.
    """
    source: Annotated[str | None, Field(max_length=500, min_length=1)] = None
    """
    Where the values came from, as text: a library material's citation, or a note the user saved with a custom material (M2.9, ADR-046). Information only; the setup drops it when a value is changed, since the values then no longer match it. Absent when unknown.
    """


class MaterialLibrary(BaseModel):
    """
    packages/spec/library/materials.json, the generic library materials (M2.9, ADR-046). Each material holds its values exactly as its source prints them, and its source names the table they come from.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    version: Literal[1]
    description: str
    references: list[MaterialReference]
    materials: list[IsotropicMaterial]


class MaterialsResponse(BaseModel):
    """
    Answer to GET /api/materials: the library's materials in library order, and the signed-in user's own materials by name (M2.9, ADR-046). A material is copied into a simulation with a new id; later changes to either side do not reach the other.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    library: list[IsotropicMaterial]
    custom: list[IsotropicMaterial]


class SaveMaterialRequest(BaseModel):
    """
    Body of POST /api/materials: a material to keep among the user's own materials, usable in every simulation of theirs. Its id is ignored and a new one given. Young's modulus and Poisson's ratio must be entered; its name must not be one of theirs already.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    material: IsotropicMaterial


class MaterialResponse(BaseModel):
    """
    Answer to POST /api/materials (HTTP 201): the saved material with its new id.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    material: IsotropicMaterial


class MeshSettings(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    size: Quantity | None
    """
    Global element size, a length quantity greater than zero; null until entered.
    """
    order: ElementOrder | None = None
    """
    Element order (M2.8). Absent in specs saved before M2.8, which means 2.
    """
    local: list[LocalMeshSize] | None = None
    """
    Local mesh sizes (M2.8). Absent in specs saved before M2.8, which means none.
    """


class SimulationSpec(BaseModel):
    """
    Version 1: one linear static analysis of the bodies of one geometry, isotropic materials, fixed supports, prescribed displacements and frictionless supports (M2.2), elastic supports (M2.6), pressures, forces, gravity and a centrifugal load (M2.3), a uniform temperature change (M2.7), or one steady-state thermal analysis with thermal conductivities and fixed temperatures (M5.1), heat fluxes, convection, radiation and heat generation (M5.2), or one thermal stress analysis with its stress-free temperature (M5.4), or one modal analysis with its number of modes (M6.1), material properties against temperature (M5.5), and the mesh settings: a global size, the element order and local sizes (M2.8), the review of the bonds between touching bodies (M4.2), and the equation solver (ADR-063). Item types joining an array do not change version (ADR-026 item 1); version changes whenever the meaning or shape of existing data does; older stored specs are upgraded by code, never reinterpreted.
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
    solver: Solver | None = None
    """
    The equation solver (ADR-063). Absent in specs saved before ADR-063, which means pastix. A run's frozen spec always names it, except for runs made before ADR-063, which were solved with spooles.
    """
    stress_free_temperature: Annotated[Quantity | None, Field(alias="stressFreeTemperature")] = None
    """
    The temperature at which the bodies have no thermal strain, an absolute temperature quantity above 0 K (M5.4, ADR-067). Used by a thermal stress analysis, whose thermal strain is the thermal expansion times the solved temperature minus this one; absent or null until entered.
    """
    modes: Modes | None = None
    """
    How many natural frequencies a modal analysis finds, the lowest first (M6.1, ADR-070); absent or null until entered.
    """
    bonds: list[Bond] | None = None
    """
    Every candidate bond of the geometry with the user's review of it (M4.2), in the order of topology.json. Absent in specs saved before M4.2, where every candidate counts as detected.
    """


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
    local: list[LocalSizeParams] | None = None
    """
    Local sizes (M2.8), each complete: tags picked and a size entered.
    """


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
    machine: SimulatedMachine | None = None


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
    estimate: RunEstimate | None
    """
    The estimate made when the run started (ADR-049); null for runs made before M2.12.
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
    progress: RunProgress | None
    """
    While the run solves; null once it has ended.
    """
    problem: str | None
    """
    Why the run failed, or that it was cancelled, in plain language.
    """
    result: SolveResult | None
    created_at: Annotated[str, Field(alias="createdAt")]
    finished_at: Annotated[str | None, Field(alias="finishedAt")]
    raw_output: Annotated[RunRawOutput, Field(alias="rawOutput")]


class RunResponse(BaseModel):
    """
    Answer to POST /api/simulations/{id}/runs and POST /api/runs/{id}/rerun (HTTP 201), and to GET /api/runs/{id} and PUT /api/runs/{id}/pin.
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


class SharedRunView(BaseModel):
    """
    A succeeded run as anyone holding its share link sees it (M8.7): the frozen setup, mesh, versions and results, without the owner's machine, estimate or cost.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: str
    spec: SimulationSpec
    mesh: RunMesh
    software: RunSoftware
    status: Literal["succeeded"]
    """
    Always succeeded: only a succeeded run can be shared.
    """
    result: SolveResult
    created_at: Annotated[str, Field(alias="createdAt")]
    finished_at: Annotated[str | None, Field(alias="finishedAt")]


class SharedRunResponse(BaseModel):
    """
    Answer to GET /api/shared/{token}: the shared run, the name of the simulation it was run from, and the owner's unit system, which the results are first shown in.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    run: SharedRunView
    simulation_name: Annotated[str, Field(alias="simulationName")]
    unit_system: Annotated[str, Field(alias="unitSystem")]
