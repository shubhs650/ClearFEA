// SPDX-License-Identifier: AGPL-3.0-or-later
// Generated from packages/spec/schemas/simulation.schema.json by packages/spec/scripts/generate.mjs.
// Do not edit by hand; change the schema and run `make spec`.

import schema from "../../schemas/simulation.schema.json";
import { validator } from "../validate";

/**
 * A Quantity, or null until the user has entered it.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "OptionalQuantity".
 */
export type OptionalQuantity = Quantity | null;
/**
 * Identifier of a material, support or load, chosen by the client and unique within the spec.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "ItemId".
 */
export type ItemId = string;
/**
 * The name shown in the simulation tree and the report.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "ItemName".
 */
export type ItemName = string;
/**
 * Face tags from the geometry's topology.json (ARCHITECTURE.md section 3). Empty while the user has not picked any.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "FaceTags".
 */
export type FaceTags = number[];
/**
 * linear_static: small-displacement linear elastic static analysis, one load step.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "AnalysisType".
 */
export type AnalysisType = "linear_static";
/**
 * One global component of a prescribed displacement: a length quantity (zero holds it, any other value moves the faces by that much), "free" when the component is not prescribed, or null until the user has chosen.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "DisplacementComponent".
 */
export type DisplacementComponent = Quantity | "free" | null;
/**
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "Support".
 */
export type Support = FixedSupport | PrescribedDisplacement | FrictionlessSupport | ElasticSupport;
/**
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "Load".
 */
export type Load =
  PressureLoad | ForceLoad | RemoteLoad | HydrostaticLoad | GravityLoad | CentrifugalLoad | TemperatureLoad;
/**
 * What a local mesh size applies to: faces, edges or bodies of the geometry, by their topology.json tags.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "LocalMeshScope".
 */
export type LocalMeshScope = "faces" | "edges" | "bodies";
/**
 * 1: four-node tetrahedra (CalculiX C3D4). 2: ten-node tetrahedra with curved edges on curved faces (C3D10), the default (ADR-028, ADR-045).
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "ElementOrder".
 */
export type ElementOrder = 1 | 2;
/**
 * meshing: the mesh job is queued or running. ready: the mesh and its display file exist. failed: problem says why.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "MeshStatus".
 */
export type MeshStatus = "meshing" | "ready" | "failed";
/**
 * x, y and z components.
 *
 * @minItems 3
 * @maxItems 3
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "XYZ".
 */
export type XYZ = [number, number, number];
/**
 * x, y and z components.
 *
 * @minItems 3
 * @maxItems 3
 */
export type XYZ1 = [number, number, number];
/**
 * x, y and z components.
 *
 * @minItems 3
 * @maxItems 3
 */
export type XYZ2 = [number, number, number];
/**
 * solving while the solve job is queued or running; succeeded or failed once it ends.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "RunStatus".
 */
export type RunStatus = "solving" | "succeeded" | "failed";
/**
 * A file a solve job stores for its run. deck.inp and solver.log can be viewed and downloaded through GET /api/runs/{id}/files/{name}.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "RunFileName".
 */
export type RunFileName =
  "deck.inp" | "solver.log" | "results.frd" | "results.dat" | "surface.bin" | "fields.bin" | "nodes.bin";

/**
 * The SimulationSpec, the one document that describes a simulation's setup (docs/ARCHITECTURE.md section 4, ADR-006, ADR-026), and the wire shapes of /api/simulations. Physical quantities are stored as the user typed them, { value, unit }, and converted to SI only by the deck generator. A spec may be incomplete (null values, items without faces) so the setup can be saved as it is built; pre-run validation (M1.12) lists what is missing. Each message is a definition under $defs.
 */
export interface Simulation {
  [k: string]: unknown;
}
/**
 * A physical value exactly as the user entered it. unit is a symbol from packages/spec/units.json of the kind the field names; a unit of the wrong kind is refused when the spec is saved.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "Quantity".
 */
export interface Quantity {
  value: number;
  unit: string;
}
/**
 * A body of the geometry and the material it is made of. Every body of the geometry appears exactly once.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "BodyAssignment".
 */
export interface BodyAssignment {
  /**
   * Body (volume) tag from topology.json.
   */
  tag: number;
  /**
   * Id of an entry in materials; null until one is assigned.
   */
  material: ItemId | null;
}
/**
 * A linear elastic isotropic material. The spec holds its own copy of the values, so a run made from it never changes when a library material does.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "IsotropicMaterial".
 */
export interface IsotropicMaterial {
  id: ItemId;
  name: ItemName;
  model: "isotropic_elastic";
  /**
   * Young's modulus, a pressure quantity greater than zero; null until entered.
   */
  youngsModulus: Quantity | null;
  /**
   * Poisson's ratio, dimensionless, between -1 and 0.5 exclusive; null until entered.
   */
  poissonsRatio: number | null;
  /**
   * Mass density, a density quantity greater than zero (M2.3). Needed only by gravity and centrifugal loads; absent or null until entered.
   */
  density?: Quantity | null;
  /**
   * Coefficient of linear thermal expansion, a thermalExpansion quantity (M2.7); zero and negative values are allowed. Needed only by a temperature change; absent or null until entered.
   */
  thermalExpansion?: Quantity | null;
  /**
   * Where the values came from, as text: a library material's citation, or a note the user saved with a custom material (M2.9, ADR-046). Information only; the setup drops it when a value is changed, since the values then no longer match it. Absent when unknown.
   */
  source?: string;
}
/**
 * A document the material library cites.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "MaterialReference".
 */
export interface MaterialReference {
  id: string;
  citation: string;
  links: string[];
}
/**
 * packages/spec/library/materials.json, the generic library materials (M2.9, ADR-046). Each material holds its values exactly as its source prints them, and its source names the table they come from.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "MaterialLibrary".
 */
export interface MaterialLibrary {
  version: 1;
  description: string;
  references: MaterialReference[];
  materials: IsotropicMaterial[];
}
/**
 * Answer to GET /api/materials: the library's materials in library order, and the signed-in user's own materials by name (M2.9, ADR-046). A material is copied into a simulation with a new id; later changes to either side do not reach the other.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "MaterialsResponse".
 */
export interface MaterialsResponse {
  library: IsotropicMaterial[];
  custom: IsotropicMaterial[];
}
/**
 * Body of POST /api/materials: a material to keep among the user's own materials, usable in every simulation of theirs. Its id is ignored and a new one given. Young's modulus and Poisson's ratio must be entered; its name must not be one of theirs already.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "SaveMaterialRequest".
 */
export interface SaveMaterialRequest {
  material: IsotropicMaterial;
}
/**
 * Answer to POST /api/materials (HTTP 201): the saved material with its new id.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "MaterialResponse".
 */
export interface MaterialResponse {
  material: IsotropicMaterial;
}
/**
 * All displacement components of the faces' nodes held at zero.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "FixedSupport".
 */
export interface FixedSupport {
  id: ItemId;
  type: "fixed";
  name: ItemName;
  faces: FaceTags;
}
/**
 * The faces' nodes moved by a given displacement in the global x, y and z directions; a free component is left to the solution. At least one component must have a value before a run.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "PrescribedDisplacement".
 */
export interface PrescribedDisplacement {
  id: ItemId;
  type: "displacement";
  name: ItemName;
  faces: FaceTags;
  x: DisplacementComponent;
  y: DisplacementComponent;
  z: DisplacementComponent;
}
/**
 * Each face held against moving along its own normal and free to slide in its plane, in both directions (it does not lift off). The support for symmetry planes. Flat faces only (DECISIONS.md, gate scope).
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "FrictionlessSupport".
 */
export interface FrictionlessSupport {
  id: ItemId;
  type: "frictionless";
  name: ItemName;
  faces: FaceTags;
}
/**
 * The faces rest on an elastic foundation (M2.6): at every point the foundation pushes back along the face's normal with a pressure equal to the stiffness times the displacement along the normal, in both directions (it does not lift off). It does not resist sliding along the faces. Written as grounded springs along the normal at each node, each with the stiffness times the node's share of the face area.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "ElasticSupport".
 */
export interface ElasticSupport {
  id: ItemId;
  type: "elastic";
  name: ItemName;
  faces: FaceTags;
  /**
   * Foundation stiffness, the pressure per unit of normal displacement, a foundationStiffness quantity greater than zero.
   */
  stiffness: Quantity | null;
}
/**
 * A uniform pressure normal to each face. A positive magnitude pushes on the face towards the body (along the inward normal), as a fluid does; a negative one pulls (suction).
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "PressureLoad".
 */
export interface PressureLoad {
  id: ItemId;
  type: "pressure";
  name: ItemName;
  faces: FaceTags;
  /**
   * A pressure quantity; null until entered.
   */
  magnitude: Quantity | null;
}
/**
 * A total force in the global x, y and z directions spread over the faces in proportion to area, as a uniform traction (consistent nodal loads in the deck). Each component is a force quantity, null until entered.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "ForceLoad".
 */
export interface ForceLoad {
  id: ItemId;
  type: "force";
  name: ItemName;
  faces: FaceTags;
  x: OptionalQuantity;
  y: OptionalQuantity;
  z: OptionalQuantity;
}
/**
 * The acceleration of gravity in the global x, y and z directions, acting on every body through its material's density: the weight points along it (z = -1 g for gravity downwards along z). Each component is an acceleration quantity, null until entered. Several gravity loads add up.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "GravityLoad".
 */
export interface GravityLoad {
  id: ItemId;
  type: "gravity";
  name: ItemName;
  x: OptionalQuantity;
  y: OptionalQuantity;
  z: OptionalQuantity;
}
/**
 * A uniform temperature change of every body from the stress-free state (M2.7): each material expands by its thermal expansion coefficient times the change, and the supports resist it. change is a temperatureDifference quantity, null until entered; a fall is negative. One per setup.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "TemperatureLoad".
 */
export interface TemperatureLoad {
  id: ItemId;
  type: "temperature";
  name: ItemName;
  change: OptionalQuantity;
}
/**
 * A point in global coordinates; each coordinate a length quantity, null until entered.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "AxisPoint".
 */
export interface AxisPoint {
  x: OptionalQuantity;
  y: OptionalQuantity;
  z: OptionalQuantity;
}
/**
 * A direction in global axes, dimensionless and of any length other than zero; each component null until entered.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "AxisDirection".
 */
export interface AxisDirection {
  x: number | null;
  y: number | null;
  z: number | null;
}
/**
 * Every body spinning steadily about an axis: a body force density times angular velocity squared times the distance from the axis, pointing away from it. The sense of rotation does not matter. One per setup.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "CentrifugalLoad".
 */
export interface CentrifugalLoad {
  id: ItemId;
  type: "centrifugal";
  name: ItemName;
  /**
   * A Quantity, or null until the user has entered it.
   */
  angularVelocity: Quantity | null;
  axisPoint: AxisPoint1;
  axisDirection: AxisDirection1;
}
/**
 * A point on the axis of rotation.
 */
export interface AxisPoint1 {
  x: OptionalQuantity;
  y: OptionalQuantity;
  z: OptionalQuantity;
}
/**
 * The direction of the axis of rotation.
 */
export interface AxisDirection1 {
  x: number | null;
  y: number | null;
  z: number | null;
}
/**
 * Components along the global x, y and z axes; each a quantity, null until entered.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "Components".
 */
export interface Components {
  x: OptionalQuantity;
  y: OptionalQuantity;
  z: OptionalQuantity;
}
/**
 * A force and a moment acting at a reference point, carried to the faces as the statically equivalent linear traction (a deformable, distributing connection; consistent nodal loads in the deck). The force acting at the point also turns the faces about it. Force components are force quantities, moment components moment quantities, in global axes and right-handed; each null until entered.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "RemoteLoad".
 */
export interface RemoteLoad {
  id: ItemId;
  type: "remote";
  name: ItemName;
  faces: FaceTags;
  point: AxisPoint2;
  force: Components1;
  moment: Components2;
}
/**
 * The reference point the force and moment act at.
 */
export interface AxisPoint2 {
  x: OptionalQuantity;
  y: OptionalQuantity;
  z: OptionalQuantity;
}
/**
 * The force at the reference point.
 */
export interface Components1 {
  x: OptionalQuantity;
  y: OptionalQuantity;
  z: OptionalQuantity;
}
/**
 * The moment at the reference point.
 */
export interface Components2 {
  x: OptionalQuantity;
  y: OptionalQuantity;
  z: OptionalQuantity;
}
/**
 * The pressure of a still fluid on the faces: p = density × (gravity · (x − s)) at a point x at or below the free surface through s, zero above it. The fluid is on the outside of each face, so the pressure pushes on the face towards the body. Consistent nodal loads in the deck. Each value null until entered.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "HydrostaticLoad".
 */
export interface HydrostaticLoad {
  id: ItemId;
  type: "hydrostatic";
  name: ItemName;
  faces: FaceTags;
  /**
   * A Quantity, or null until the user has entered it.
   */
  fluidDensity: Quantity | null;
  gravity: Components3;
  freeSurface: AxisPoint3;
}
/**
 * The acceleration of gravity acting on the fluid, acceleration quantities in global axes (z = -1 g for gravity downwards along z). Depth is measured along it; it is not applied to the bodies (add a gravity load for their weight).
 */
export interface Components3 {
  x: OptionalQuantity;
  y: OptionalQuantity;
  z: OptionalQuantity;
}
/**
 * A point on the fluid's free surface, the plane normal to gravity where the pressure is zero.
 */
export interface AxisPoint3 {
  x: OptionalQuantity;
  y: OptionalQuantity;
  z: OptionalQuantity;
}
/**
 * A smaller element size on some faces, edges or bodies (M2.8, ADR-045). The mesh grows from it to the global size away from them.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "LocalMeshSize".
 */
export interface LocalMeshSize {
  id: ItemId;
  name: ItemName;
  scope: LocalMeshScope;
  /**
   * Face, edge or body tags, as scope says; empty until picked.
   */
  tags: number[];
  /**
   * Element size on them, a length quantity greater than zero and no larger than the global size; null until entered.
   */
  size: Quantity | null;
}
/**
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "MeshSettings".
 */
export interface MeshSettings {
  /**
   * Global element size, a length quantity greater than zero; null until entered.
   */
  size: Quantity | null;
  /**
   * Element order (M2.8). Absent in specs saved before M2.8, which means 2.
   */
  order?: 1 | 2;
  /**
   * Local mesh sizes (M2.8). Absent in specs saved before M2.8, which means none.
   */
  local?: LocalMeshSize[];
}
/**
 * Version 1: one linear static analysis of the bodies of one geometry, isotropic materials, fixed supports, prescribed displacements and frictionless supports (M2.2), elastic supports (M2.6), pressures, forces, gravity and a centrifugal load (M2.3), a uniform temperature change (M2.7), and the mesh settings: a global size, the element order and local sizes (M2.8). Item types joining an array do not change version (ADR-026 item 1); version changes whenever the meaning or shape of existing data does; older stored specs are upgraded by code, never reinterpreted.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "SimulationSpec".
 */
export interface SimulationSpec {
  version: 1;
  analysis: AnalysisType;
  /**
   * The geometry whose face and body tags the spec uses.
   */
  geometryId: string;
  bodies: BodyAssignment[];
  materials: IsotropicMaterial[];
  supports: Support[];
  loads: Load[];
  mesh: MeshSettings;
}
/**
 * A simulation as its owner sees it.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "SimulationView".
 */
export interface SimulationView {
  id: string;
  name: ItemName;
  geometryId: string;
  spec: SimulationSpec;
  createdAt: string;
  updatedAt: string;
}
/**
 * Body of POST /api/simulations. The geometry must be ready (its unit confirmed); from then on its unit is locked. Without spec the simulation starts empty, with every body of the geometry listed and no material assigned.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "CreateSimulationRequest".
 */
export interface CreateSimulationRequest {
  geometryId: string;
  name: ItemName;
  spec?: SimulationSpec;
}
/**
 * Answer to POST /api/simulations (HTTP 201), GET /api/simulations/{id} and PUT /api/simulations/{id}/spec.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "SimulationResponse".
 */
export interface SimulationResponse {
  simulation: SimulationView;
}
/**
 * Answer to GET /api/simulations[?geometryId=]: the signed-in user's simulations, newest first.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "SimulationListResponse".
 */
export interface SimulationListResponse {
  simulations: SimulationView[];
}
/**
 * Parameters of a mesh job (ADR-028). The worker re-imports the geometry's STEP file with scaling, checks it against topology.json, and meshes it with tetrahedra no larger than size.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "MeshParams".
 */
export interface MeshParams {
  /**
   * The geometry whose model.step and topology.json the job reads.
   */
  geometryId: string;
  /**
   * Geometry.OCCScaling of the geometry's topology.json; the re-import must use the same.
   */
  scaling: number;
  size: Quantity1;
  order: ElementOrder;
  /**
   * Local sizes (M2.8), each complete: tags picked and a size entered.
   */
  local?: LocalSizeParams[];
}
/**
 * A physical value exactly as the user entered it. unit is a symbol from packages/spec/units.json of the kind the field names; a unit of the wrong kind is refused when the spec is saved.
 */
export interface Quantity1 {
  value: number;
  unit: string;
}
/**
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "LocalSizeParams".
 */
export interface LocalSizeParams {
  scope: LocalMeshScope;
  /**
   * Never empty when sent by the API.
   */
  tags: number[];
  size: Quantity;
}
/**
 * Quality summary of a mesh (M2.8, ADR-045). shape is Gmsh's gamma, the inscribed to circumscribed sphere radius ratio scaled so a regular tetrahedron is 1 and a flat one 0. jacobianMin is the smallest scaled Jacobian of any element, 1 for an undistorted one; curved second-order elements fall below 1.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "MeshQuality".
 */
export interface MeshQuality {
  shapeMin: number;
  shapeMean: number;
  /**
   * Number of elements with shape in [0, 0.1), [0.1, 0.2), ... [0.9, 1].
   *
   * @minItems 10
   * @maxItems 10
   */
  shapeHistogram: [number, number, number, number, number, number, number, number, number, number];
  jacobianMin: number;
}
/**
 * Result summary of a succeeded mesh job.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "MeshResult".
 */
export interface MeshResult {
  order: ElementOrder;
  quality: MeshQuality;
  nodes: number;
  /**
   * Tetrahedra in the volume mesh.
   */
  elements: number;
  /**
   * Triangles in the mesh display file.
   */
  surfaceTriangles: number;
  /**
   * Versions that made the mesh.
   */
  software: {
    gmsh: string;
    occt: string;
  };
}
/**
 * A mesh as its owner sees it.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "MeshView".
 */
export interface MeshView {
  id: string;
  geometryId: string;
  size: Quantity2;
  order: ElementOrder;
  /**
   * The local sizes the mesh was made with, as entered (M2.8).
   */
  local: LocalSizeParams[];
  status: MeshStatus;
  /**
   * Why meshing failed, in plain language.
   */
  problem: string | null;
  nodeCount: number | null;
  elementCount: number | null;
  /**
   * Null until the mesh is ready, and for meshes made before M2.8.
   */
  quality: MeshQuality | null;
  createdAt: string;
}
/**
 * A physical value exactly as the user entered it. unit is a symbol from packages/spec/units.json of the kind the field names; a unit of the wrong kind is refused when the spec is saved.
 */
export interface Quantity2 {
  value: number;
  unit: string;
}
/**
 * Answer to POST /api/simulations/{id}/mesh (HTTP 201 for a new mesh, 200 when a mesh with the same settings hash is reused, ADR-047) and GET /api/meshes/{id}.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "MeshResponse".
 */
export interface MeshResponse {
  mesh: MeshView;
  /**
   * Present on POST /api/simulations/{id}/mesh: true when an existing mesh of the same geometry, unit and mesh settings was reused, so no mesh job was queued or charged.
   */
  reused?: boolean;
}
/**
 * Answer to GET /api/simulations/{id}/mesh: the simulation's latest mesh, or null before the first one is requested.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "SimulationMeshResponse".
 */
export interface SimulationMeshResponse {
  mesh: MeshView | null;
}
/**
 * Parameters of a solve job (ADR-030): the run's frozen spec and the mesh it is solved on. The worker writes the deck from these two alone.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "SolveParams".
 */
export interface SolveParams {
  /**
   * The mesh whose mesh.bin the job reads.
   */
  meshId: string;
  spec: SimulationSpec;
}
/**
 * A nodal result value and where it occurs. SI units; position in metres.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "NodeValue".
 */
export interface NodeValue {
  value: number;
  /**
   * Index of the node in mesh.bin, from 0.
   */
  node: number;
  position: XYZ;
}
/**
 * Total reaction of one support: the sum over its nodes of the force along the directions it holds, shared with other supports at nodes they also hold (ADR-039), with the loads applied at those nodes taken out (ADR-040, ADR-051); an elastic support's is its springs' force (ADR-043). Forces in newtons, moment in newton metres, point in metres. Runs solved before M3.2 have no moment or point.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "SupportReaction".
 */
export interface SupportReaction {
  supportId: ItemId;
  force: XYZ;
  moment?: XYZ1;
  point?: XYZ2;
}
/**
 * Total force (N) of one load as the solver applies it, and its moment about the origin (N·m) (ADR-051). A temperature change applies none.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "LoadTotal".
 */
export interface LoadTotal {
  loadId: ItemId;
  force: XYZ;
  moment: XYZ;
}
/**
 * Applied loads against reactions, both about the origin (ADR-051). The imbalance is applied plus reactions; forceRatio is its size over forceScale, the larger of the loads' gross size (the sum of the sizes of their nodal forces, so a load that cancels itself is still measured against its size) and the sum of the reactions' sizes, and momentRatio its moment's size over momentScale, the largest of the applied moment's size, the sum of the reactions' moment sizes about the origin and forceScale times the mesh's bounding-box diagonal. Numbers only; no verdict.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "BalanceCheck".
 */
export interface BalanceCheck {
  appliedForce: XYZ;
  appliedMoment: XYZ;
  reactionForce: XYZ;
  reactionMoment: XYZ;
  forceScale: number;
  momentScale: number;
  forceRatio: number;
  momentRatio: number;
}
/**
 * Result summary of a succeeded solve job (ADR-030). Displacement in metres, stress in pascals, forces in newtons.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "SolveResult".
 */
export interface SolveResult {
  /**
   * Nodes with results; every node of the mesh.
   */
  nodes: number;
  /**
   * Largest displacement magnitude.
   */
  displacement: {
    max: NodeValue;
  };
  /**
   * Smallest and largest von Mises stress of CalculiX's nodal stresses.
   */
  vonMises: {
    min: NodeValue;
    max: NodeValue;
  };
  /**
   * One entry per support, in spec order.
   */
  reactions: SupportReaction[];
  /**
   * One entry per load, in spec order. Absent for runs solved before M3.2.
   */
  loads?: LoadTotal[];
  balance?: BalanceCheck1;
  software: SolveSoftware;
}
/**
 * Absent for runs solved before M3.2.
 */
export interface BalanceCheck1 {
  appliedForce: XYZ;
  appliedMoment: XYZ;
  reactionForce: XYZ;
  reactionMoment: XYZ;
  forceScale: number;
  momentScale: number;
  forceRatio: number;
  momentRatio: number;
}
/**
 * Versions that solved the run.
 */
export interface SolveSoftware {
  calculix: string;
}
/**
 * Versions that produced a run (ADR-032): gmsh and occt made its mesh; clearfea, deckFormat and calculix are the worker's that solved it. Null when not known, for example before the worker has reported or for runs made before M1.10.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "RunSoftware".
 */
export interface RunSoftware {
  clearfea: string | null;
  deckFormat: number | null;
  calculix: string | null;
  gmsh: string | null;
  occt: string | null;
}
/**
 * The mesh a run was solved on, as it was made. Meshes do not change once ready.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "RunMesh".
 */
export interface RunMesh {
  size: Quantity;
  order: ElementOrder;
  nodeCount: number | null;
  elementCount: number | null;
}
/**
 * The machine size a run was billed on and its rate, fixed when the run started (ADR-033). Money is in whole micro-credits: 1,000,000 is one credit.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "RunMachine".
 */
export interface RunMachine {
  size: string;
  /**
   * Micro-credits per hour of billable time.
   */
  ratePerHour: number;
}
/**
 * What a finished run's solve job cost (ADR-033). billedSeconds is the measured time rounded up to whole seconds; amount is billedSeconds times the hourly rate over 3600, in micro-credits rounded to the nearest one. charged is false when the job failed through a fault in ClearFEA, which the user does not pay for; amount is then 0.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "RunCost".
 */
export interface RunCost {
  billedSeconds: number;
  amount: number;
  charged: boolean;
}
/**
 * What a run is estimated to cost on one machine size (M2.12, ADR-049). Money is in whole micro-credits: 1,000,000 is one credit.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "SizeEstimate".
 */
export interface SizeEstimate {
  size: string;
  cores: number;
  /**
   * The machine size's memory.
   */
  memoryBytes: number;
  /**
   * Micro-credits per hour of billable time.
   */
  ratePerHour: number;
  /**
   * The estimated seconds, billed at this size's rate.
   */
  cost: number;
  /**
   * Whether the size's usable memory holds the estimated peak memory with the estimator's margin.
   */
  fits: boolean;
}
/**
 * Memory, time and cost estimated for solving a simulation on its mesh, from the estimator's fitted coefficients (packages/spec/estimator.json, ADR-049), and the machine size recommended: the smallest that fits, or null when none does.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "RunEstimate".
 */
export interface RunEstimate {
  /**
   * Version of estimator.json that made the estimate.
   */
  estimator: number;
  /**
   * The mesh's node count the estimate is made from.
   */
  nodes: number;
  /**
   * Estimated peak memory of the solver.
   */
  memoryBytes: number;
  /**
   * Estimated billable time of the solve job, whole seconds.
   */
  seconds: number;
  /**
   * True when the mesh is larger than any the estimator was fitted on, so the estimate is less certain.
   */
  extrapolated: boolean;
  sizes: SizeEstimate[];
  recommended: string | null;
}
/**
 * Answer to GET /api/simulations/{id}/estimate: the estimate for the simulation's current ready mesh.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "EstimateResponse".
 */
export interface EstimateResponse {
  estimate: RunEstimate;
}
/**
 * Body of POST /api/simulations/{id}/runs, which may also be sent empty. machineSize names the machine size to run on; without it the run takes the recommended size (the largest when none fits).
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "CreateRunRequest".
 */
export interface CreateRunRequest {
  machineSize?: string;
}
/**
 * A run as its owner sees it, with the record frozen when it started (ADR-030, ADR-032, ADR-033).
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "RunView".
 */
export interface RunView {
  id: string;
  simulationId: string;
  meshId: string;
  spec: SimulationSpec1;
  mesh: RunMesh;
  software: RunSoftware;
  /**
   * The files stored for the run, known once it has finished; empty while it solves.
   */
  files: RunFileName[];
  /**
   * Null for runs made before M1.11, which were not metered.
   */
  machine: RunMachine | null;
  /**
   * The estimate made when the run started (ADR-049); null for runs made before M2.12.
   */
  estimate: RunEstimate | null;
  /**
   * Known once the run has finished; null while it solves and for runs that were not metered.
   */
  cost: RunCost | null;
  status: RunStatus;
  /**
   * What the solve job is doing: queued, then the worker's stage.
   */
  stage: string | null;
  /**
   * Why the run failed, in plain language.
   */
  problem: string | null;
  result: SolveResult | null;
  createdAt: string;
  finishedAt: string | null;
}
/**
 * Version 1: one linear static analysis of the bodies of one geometry, isotropic materials, fixed supports, prescribed displacements and frictionless supports (M2.2), elastic supports (M2.6), pressures, forces, gravity and a centrifugal load (M2.3), a uniform temperature change (M2.7), and the mesh settings: a global size, the element order and local sizes (M2.8). Item types joining an array do not change version (ADR-026 item 1); version changes whenever the meaning or shape of existing data does; older stored specs are upgraded by code, never reinterpreted.
 */
export interface SimulationSpec1 {
  version: 1;
  analysis: AnalysisType;
  /**
   * The geometry whose face and body tags the spec uses.
   */
  geometryId: string;
  bodies: BodyAssignment[];
  materials: IsotropicMaterial[];
  supports: Support[];
  loads: Load[];
  mesh: MeshSettings;
}
/**
 * Answer to POST /api/simulations/{id}/runs (HTTP 201) and GET /api/runs/{id}.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "RunResponse".
 */
export interface RunResponse {
  run: RunView;
}
/**
 * Answer to GET /api/simulations/{id}/runs: the simulation's runs, newest first.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "RunListResponse".
 */
export interface RunListResponse {
  runs: RunView[];
}
/**
 * Answer to GET /api/runs/{id}/log?after={n}: the solver log written after chunk n, and the n to ask with next time.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "RunLogResponse".
 */
export interface RunLogResponse {
  text: string;
  next: number;
}

export const validateQuantity = validator<Quantity>(schema, "Quantity");
export const validateOptionalQuantity = validator<OptionalQuantity>(schema, "OptionalQuantity");
export const validateItemId = validator<ItemId>(schema, "ItemId");
export const validateItemName = validator<ItemName>(schema, "ItemName");
export const validateFaceTags = validator<FaceTags>(schema, "FaceTags");
export const AnalysisTypeValues = ["linear_static"] as const satisfies readonly AnalysisType[];
export const validateAnalysisType = validator<AnalysisType>(schema, "AnalysisType");
export const validateBodyAssignment = validator<BodyAssignment>(schema, "BodyAssignment");
export const validateIsotropicMaterial = validator<IsotropicMaterial>(schema, "IsotropicMaterial");
export const validateMaterialReference = validator<MaterialReference>(schema, "MaterialReference");
export const validateMaterialLibrary = validator<MaterialLibrary>(schema, "MaterialLibrary");
export const validateMaterialsResponse = validator<MaterialsResponse>(schema, "MaterialsResponse");
export const validateSaveMaterialRequest = validator<SaveMaterialRequest>(schema, "SaveMaterialRequest");
export const validateMaterialResponse = validator<MaterialResponse>(schema, "MaterialResponse");
export const validateFixedSupport = validator<FixedSupport>(schema, "FixedSupport");
export const validateDisplacementComponent = validator<DisplacementComponent>(schema, "DisplacementComponent");
export const validatePrescribedDisplacement = validator<PrescribedDisplacement>(schema, "PrescribedDisplacement");
export const validateFrictionlessSupport = validator<FrictionlessSupport>(schema, "FrictionlessSupport");
export const validateElasticSupport = validator<ElasticSupport>(schema, "ElasticSupport");
export const validateSupport = validator<Support>(schema, "Support");
export const validatePressureLoad = validator<PressureLoad>(schema, "PressureLoad");
export const validateForceLoad = validator<ForceLoad>(schema, "ForceLoad");
export const validateGravityLoad = validator<GravityLoad>(schema, "GravityLoad");
export const validateTemperatureLoad = validator<TemperatureLoad>(schema, "TemperatureLoad");
export const validateAxisPoint = validator<AxisPoint>(schema, "AxisPoint");
export const validateAxisDirection = validator<AxisDirection>(schema, "AxisDirection");
export const validateCentrifugalLoad = validator<CentrifugalLoad>(schema, "CentrifugalLoad");
export const validateComponents = validator<Components>(schema, "Components");
export const validateRemoteLoad = validator<RemoteLoad>(schema, "RemoteLoad");
export const validateHydrostaticLoad = validator<HydrostaticLoad>(schema, "HydrostaticLoad");
export const validateLoad = validator<Load>(schema, "Load");
export const LocalMeshScopeValues = ["faces", "edges", "bodies"] as const satisfies readonly LocalMeshScope[];
export const validateLocalMeshScope = validator<LocalMeshScope>(schema, "LocalMeshScope");
export const validateLocalMeshSize = validator<LocalMeshSize>(schema, "LocalMeshSize");
export const validateMeshSettings = validator<MeshSettings>(schema, "MeshSettings");
export const validateSimulationSpec = validator<SimulationSpec>(schema, "SimulationSpec");
export const validateSimulationView = validator<SimulationView>(schema, "SimulationView");
export const validateCreateSimulationRequest = validator<CreateSimulationRequest>(schema, "CreateSimulationRequest");
export const validateSimulationResponse = validator<SimulationResponse>(schema, "SimulationResponse");
export const validateSimulationListResponse = validator<SimulationListResponse>(schema, "SimulationListResponse");
export const ElementOrderValues = [1, 2] as const satisfies readonly ElementOrder[];
export const validateElementOrder = validator<ElementOrder>(schema, "ElementOrder");
export const validateMeshParams = validator<MeshParams>(schema, "MeshParams");
export const validateLocalSizeParams = validator<LocalSizeParams>(schema, "LocalSizeParams");
export const validateMeshQuality = validator<MeshQuality>(schema, "MeshQuality");
export const validateMeshResult = validator<MeshResult>(schema, "MeshResult");
export const MeshStatusValues = ["meshing", "ready", "failed"] as const satisfies readonly MeshStatus[];
export const validateMeshStatus = validator<MeshStatus>(schema, "MeshStatus");
export const validateMeshView = validator<MeshView>(schema, "MeshView");
export const validateMeshResponse = validator<MeshResponse>(schema, "MeshResponse");
export const validateSimulationMeshResponse = validator<SimulationMeshResponse>(schema, "SimulationMeshResponse");
export const validateSolveParams = validator<SolveParams>(schema, "SolveParams");
export const validateXYZ = validator<XYZ>(schema, "XYZ");
export const validateNodeValue = validator<NodeValue>(schema, "NodeValue");
export const validateSupportReaction = validator<SupportReaction>(schema, "SupportReaction");
export const validateLoadTotal = validator<LoadTotal>(schema, "LoadTotal");
export const validateBalanceCheck = validator<BalanceCheck>(schema, "BalanceCheck");
export const validateSolveResult = validator<SolveResult>(schema, "SolveResult");
export const RunStatusValues = ["solving", "succeeded", "failed"] as const satisfies readonly RunStatus[];
export const validateRunStatus = validator<RunStatus>(schema, "RunStatus");
export const validateRunSoftware = validator<RunSoftware>(schema, "RunSoftware");
export const validateRunMesh = validator<RunMesh>(schema, "RunMesh");
export const RunFileNameValues = ["deck.inp", "solver.log", "results.frd", "results.dat", "surface.bin", "fields.bin", "nodes.bin"] as const satisfies readonly RunFileName[];
export const validateRunFileName = validator<RunFileName>(schema, "RunFileName");
export const validateRunMachine = validator<RunMachine>(schema, "RunMachine");
export const validateRunCost = validator<RunCost>(schema, "RunCost");
export const validateSizeEstimate = validator<SizeEstimate>(schema, "SizeEstimate");
export const validateRunEstimate = validator<RunEstimate>(schema, "RunEstimate");
export const validateEstimateResponse = validator<EstimateResponse>(schema, "EstimateResponse");
export const validateCreateRunRequest = validator<CreateRunRequest>(schema, "CreateRunRequest");
export const validateRunView = validator<RunView>(schema, "RunView");
export const validateRunResponse = validator<RunResponse>(schema, "RunResponse");
export const validateRunListResponse = validator<RunListResponse>(schema, "RunListResponse");
export const validateRunLogResponse = validator<RunLogResponse>(schema, "RunLogResponse");
