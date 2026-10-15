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
