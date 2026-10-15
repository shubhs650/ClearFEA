// SPDX-License-Identifier: AGPL-3.0-or-later
// Generated from packages/spec/schemas/simulation.schema.json by packages/spec/scripts/generate.mjs.
// Do not edit by hand; change the schema and run `make spec`.

import schema from "../../schemas/simulation.schema.json";
import { validator } from "../validate";

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
 * 1: four-node tetrahedra. 2: ten-node tetrahedra with curved edges on curved faces. Phase 0 meshes always use 2 until M2.8 offers the choice (ADR-028).
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
export type RunFileName = "deck.inp" | "solver.log" | "results.frd" | "results.dat" | "surface.bin" | "fields.bin";

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
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "MeshSettings".
 */
export interface MeshSettings {
  /**
   * Global element size, a length quantity greater than zero; null until entered.
   */
  size: Quantity | null;
}
/**
 * Version 1: one linear static analysis of the bodies of one geometry, isotropic materials, fixed supports, pressures and a global mesh size. version changes whenever the shape does; older stored specs are upgraded by code, never reinterpreted.
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
  supports: FixedSupport[];
  loads: PressureLoad[];
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
}
/**
 * A physical value exactly as the user entered it. unit is a symbol from packages/spec/units.json of the kind the field names; a unit of the wrong kind is refused when the spec is saved.
 */
export interface Quantity1 {
  value: number;
  unit: string;
}
/**
 * Result summary of a succeeded mesh job.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "MeshResult".
 */
export interface MeshResult {
  order: ElementOrder;
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
  status: MeshStatus;
  /**
   * Why meshing failed, in plain language.
   */
  problem: string | null;
  nodeCount: number | null;
  elementCount: number | null;
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
 * Answer to POST /api/simulations/{id}/mesh (HTTP 201) and GET /api/meshes/{id}.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "MeshResponse".
 */
export interface MeshResponse {
  mesh: MeshView;
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
 * Total reaction force of one support, in newtons, as CalculiX reports it for the support's node set.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "SupportReaction".
 */
export interface SupportReaction {
  supportId: ItemId;
  force: XYZ;
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
  software: SolveSoftware;
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
 * A run as its owner sees it, with the record frozen when it started (ADR-030, ADR-032).
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
 * Version 1: one linear static analysis of the bodies of one geometry, isotropic materials, fixed supports, pressures and a global mesh size. version changes whenever the shape does; older stored specs are upgraded by code, never reinterpreted.
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
  supports: FixedSupport[];
  loads: PressureLoad[];
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
export const validateItemId = validator<ItemId>(schema, "ItemId");
export const validateItemName = validator<ItemName>(schema, "ItemName");
export const validateFaceTags = validator<FaceTags>(schema, "FaceTags");
export const AnalysisTypeValues = ["linear_static"] as const satisfies readonly AnalysisType[];
export const validateAnalysisType = validator<AnalysisType>(schema, "AnalysisType");
export const validateBodyAssignment = validator<BodyAssignment>(schema, "BodyAssignment");
export const validateIsotropicMaterial = validator<IsotropicMaterial>(schema, "IsotropicMaterial");
export const validateFixedSupport = validator<FixedSupport>(schema, "FixedSupport");
export const validatePressureLoad = validator<PressureLoad>(schema, "PressureLoad");
export const validateMeshSettings = validator<MeshSettings>(schema, "MeshSettings");
export const validateSimulationSpec = validator<SimulationSpec>(schema, "SimulationSpec");
export const validateSimulationView = validator<SimulationView>(schema, "SimulationView");
export const validateCreateSimulationRequest = validator<CreateSimulationRequest>(schema, "CreateSimulationRequest");
export const validateSimulationResponse = validator<SimulationResponse>(schema, "SimulationResponse");
export const validateSimulationListResponse = validator<SimulationListResponse>(schema, "SimulationListResponse");
export const ElementOrderValues = [1, 2] as const satisfies readonly ElementOrder[];
export const validateElementOrder = validator<ElementOrder>(schema, "ElementOrder");
export const validateMeshParams = validator<MeshParams>(schema, "MeshParams");
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
export const validateSolveResult = validator<SolveResult>(schema, "SolveResult");
export const RunStatusValues = ["solving", "succeeded", "failed"] as const satisfies readonly RunStatus[];
export const validateRunStatus = validator<RunStatus>(schema, "RunStatus");
export const validateRunSoftware = validator<RunSoftware>(schema, "RunSoftware");
export const validateRunMesh = validator<RunMesh>(schema, "RunMesh");
export const RunFileNameValues = ["deck.inp", "solver.log", "results.frd", "results.dat", "surface.bin", "fields.bin"] as const satisfies readonly RunFileName[];
export const validateRunFileName = validator<RunFileName>(schema, "RunFileName");
export const validateRunView = validator<RunView>(schema, "RunView");
export const validateRunResponse = validator<RunResponse>(schema, "RunResponse");
export const validateRunListResponse = validator<RunListResponse>(schema, "RunListResponse");
export const validateRunLogResponse = validator<RunLogResponse>(schema, "RunLogResponse");
