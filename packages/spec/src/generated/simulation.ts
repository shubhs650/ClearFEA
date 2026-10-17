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
 * linear_static: small-displacement linear elastic static analysis, one load step. steady_thermal: steady-state heat conduction, one step (M5.1, ADR-064), with convection and radiation from faces (M5.2); it solves temperatures only, so it uses thermal loads and no supports. thermal_stress: a steady-state thermal step followed by a linear static step on the temperatures it solved, in one deck (M5.4, ADR-067); it uses supports, the structural loads other than a uniform temperature change, and the thermal loads, and needs the spec's stressFreeTemperature. modal: the natural frequencies of the bodies as they are held, one *FREQUENCY step (M6.1, ADR-070); it uses supports and no loads, and needs the spec's modes; bodies no support holds have rigid-body modes at or near zero.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "AnalysisType".
 */
export type AnalysisType = "linear_static" | "steady_thermal" | "thermal_stress" | "modal";
/**
 * detected: found by bond detection and not yet reviewed; it is tied. accepted: the user reviewed it and keeps it; it is tied. removed: the user removed it; it is not tied, and stays listed so it can be restored.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "BondStatus".
 */
export type BondStatus = "detected" | "accepted" | "removed";
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
  | PressureLoad
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
  | HeatGenerationLoad;
/**
 * What a local mesh size applies to: faces, edges or bodies of the geometry, by their topology.json tags.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "LocalMeshScope".
 */
export type LocalMeshScope = "faces" | "edges" | "bodies";
/**
 * CalculiX's equation solver for a run (ADR-063). pastix, the default, and spooles are direct solvers, verified to the 0.1 percent checks. iterative_cholesky and iterative_scaling need far less memory but stop at CalculiX 2.21's fixed relative residual of 1e-4, which left verification results up to about 0.5 percent off.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "Solver".
 */
export type Solver = "pastix" | "spooles" | "iterative_cholesky" | "iterative_scaling";
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
 * A candidate bond of the geometry (topology.json bonds, M4.2) and what the user decided about it. A bond is identified by its two faces.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "Bond".
 */
export interface Bond {
  /**
   * The two face tags of a candidate bond, smaller first.
   *
   * @minItems 2
   * @maxItems 2
   */
  faces: [number, number];
  status: BondStatus;
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
   * Coefficient of linear thermal expansion, a thermalExpansion quantity (M2.7); zero and negative values are allowed. Needed only by a temperature change and a thermal stress analysis; absent or null until entered.
   */
  thermalExpansion?: Quantity | null;
  /**
   * Thermal conductivity, a thermalConductivity quantity greater than zero (M5.1, ADR-064). Needed only by a steady-state thermal and a thermal stress analysis; absent or null until entered.
   */
  thermalConductivity?: Quantity | null;
  /**
   * Young's modulus against temperature (M5.5, ADR-068), a PropertyTable of pressures; absent or null when it does not vary.
   */
  youngsModulusTable?: PropertyTable | null;
  /**
   * Poisson's ratio against temperature (M5.5, ADR-068), a PropertyTable without unit; absent or null when it does not vary.
   */
  poissonsRatioTable?: PropertyTable | null;
  /**
   * Thermal expansion against temperature (M5.5, ADR-068), an ExpansionTable; absent or null when it does not vary.
   */
  thermalExpansionTable?: ExpansionTable | null;
  /**
   * Thermal conductivity against temperature (M5.5, ADR-068), a PropertyTable of thermal conductivities; absent or null when it does not vary.
   */
  thermalConductivityTable?: PropertyTable | null;
  /**
   * Tensile yield strength, a pressure quantity greater than zero (M3.5, ADR-054). Needed only for the safety factor against yield, which the result shows when every material of the setup has one; absent or null until entered.
   */
  yieldStrength?: Quantity | null;
  /**
   * Where the values came from, as text: a library material's citation, or a note the user saved with a custom material (M2.9, ADR-046). Information only; the setup drops it when a value is changed, since the values then no longer match it. Absent when unknown.
   */
  source?: string;
}
/**
 * A material property that varies with temperature (M5.5, ADR-068): rows of a temperature and the value there, in rising temperature, at least two. Between rows the value is interpolated linearly; below the first row and above the last it is the first and last value (as CalculiX does). temperatureUnit is a temperature unit and unit a unit of the property's kind from packages/spec/units.json; unit is absent for Poisson's ratio. Used in place of the material's single value by steady-state thermal and thermal stress analyses, whose temperatures are solved; a linear static analysis uses the single value.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "PropertyTable".
 */
export interface PropertyTable {
  temperatureUnit: string;
  unit?: string;
  /**
   * @maxItems 50
   */
  rows: PropertyTableRow[];
}
/**
 * One row of a property table: a temperature and the property's value there, as typed in the table's units; either is null until entered.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "PropertyTableRow".
 */
export interface PropertyTableRow {
  temperature: number | null;
  value: number | null;
}
/**
 * A thermal expansion coefficient that varies with temperature (M5.5, ADR-068): a PropertyTable of mean (secant) coefficients, each measured from referenceTemperature, as handbooks print them: the thermal strain at T is alpha(T) (T - referenceTemperature), counted from the stress-free temperature. referenceTemperature is a temperature quantity, null until entered.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "ExpansionTable".
 */
export interface ExpansionTable {
  temperatureUnit: string;
  unit: string;
  /**
   * @maxItems 50
   */
  rows: PropertyTableRow[];
  referenceTemperature: OptionalQuantity;
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
   * A Quantity, or null until the user has entered it.
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
 * The faces held at one temperature in a steady-state thermal analysis (M5.1, ADR-064). temperature is an absolute temperature quantity (with its offset: 20 °C is 293.15 K), null until entered.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "FixedTemperatureLoad".
 */
export interface FixedTemperatureLoad {
  id: ItemId;
  type: "fixed_temperature";
  name: ItemName;
  faces: FaceTags;
  temperature: OptionalQuantity;
}
/**
 * A uniform heat flux through faces in a steady-state thermal analysis (M5.2). flux is a heatFlux quantity, positive into the body and negative out of it, null until entered.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "HeatFluxLoad".
 */
export interface HeatFluxLoad {
  id: ItemId;
  type: "heat_flux";
  name: ItemName;
  faces: FaceTags;
  flux: OptionalQuantity;
}
/**
 * Convection from faces to a surrounding fluid in a steady-state thermal analysis (M5.2): the heat leaving a face is coefficient x (surface temperature - ambientTemperature). coefficient is a heatTransferCoefficient quantity greater than zero; ambientTemperature an absolute temperature quantity above 0 K; each null until entered.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "ConvectionLoad".
 */
export interface ConvectionLoad {
  id: ItemId;
  type: "convection";
  name: ItemName;
  faces: FaceTags;
  coefficient: OptionalQuantity;
  ambientTemperature: OptionalQuantity;
}
/**
 * Radiation from faces to surroundings at one temperature in a steady-state thermal analysis (M5.2): the heat leaving a face is emissivity x Stefan-Boltzmann constant x (surface temperature^4 - ambientTemperature^4), every face seeing only the surroundings. emissivity is dimensionless, above 0 and at most 1; ambientTemperature an absolute temperature quantity above 0 K; each null until entered.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "RadiationLoad".
 */
export interface RadiationLoad {
  id: ItemId;
  type: "radiation";
  name: ItemName;
  faces: FaceTags;
  emissivity: number | null;
  ambientTemperature: OptionalQuantity;
}
/**
 * Heat produced uniformly inside bodies in a steady-state thermal analysis (M5.2). bodies are body tags of the geometry, empty until picked; power is a heatGeneration quantity (per unit of volume), negative for heat absorbed, null until entered.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "HeatGenerationLoad".
 */
export interface HeatGenerationLoad {
  id: ItemId;
  type: "heat_generation";
  name: ItemName;
  bodies: number[];
  power: OptionalQuantity;
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
 * Version 1: one linear static analysis of the bodies of one geometry, isotropic materials, fixed supports, prescribed displacements and frictionless supports (M2.2), elastic supports (M2.6), pressures, forces, gravity and a centrifugal load (M2.3), a uniform temperature change (M2.7), or one steady-state thermal analysis with thermal conductivities and fixed temperatures (M5.1), heat fluxes, convection, radiation and heat generation (M5.2), or one thermal stress analysis with its stress-free temperature (M5.4), or one modal analysis with its number of modes (M6.1), material properties against temperature (M5.5), and the mesh settings: a global size, the element order and local sizes (M2.8), the review of the bonds between touching bodies (M4.2), and the equation solver (ADR-063). Item types joining an array do not change version (ADR-026 item 1); version changes whenever the meaning or shape of existing data does; older stored specs are upgraded by code, never reinterpreted.
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
  /**
   * The equation solver (ADR-063). Absent in specs saved before ADR-063, which means pastix. A run's frozen spec always names it, except for runs made before ADR-063, which were solved with spooles.
   */
  solver?: "pastix" | "spooles" | "iterative_cholesky" | "iterative_scaling";
  /**
   * The temperature at which the bodies have no thermal strain, an absolute temperature quantity above 0 K (M5.4, ADR-067). Used by a thermal stress analysis, whose thermal strain is the thermal expansion times the solved temperature minus this one; absent or null until entered.
   */
  stressFreeTemperature?: Quantity | null;
  /**
   * How many natural frequencies a modal analysis finds, the lowest first (M6.1, ADR-070); absent or null until entered.
   */
  modes?: number | null;
  /**
   * Every candidate bond of the geometry with the user's review of it (M4.2), in the order of topology.json. Absent in specs saved before M4.2, where every candidate counts as detected.
   */
  bonds?: Bond[];
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
  machine?: SimulatedMachine;
}
/**
 * How the worker simulates the run's machine size on one physical machine (M8.5, ADR-081): the solver process is held to `cores` processors and is stopped as out of memory when its resident memory passes memoryLimitBytes, the size's usable memory (the estimator's usableMemoryFraction of it). Jobs queued before M8.5 have none and run unlimited.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "SimulatedMachine".
 */
export interface SimulatedMachine {
  /**
   * The machine size's name.
   */
  size: string;
  /**
   * Processors the solver process may run on.
   */
  cores: number;
  /**
   * Resident memory past which the solver is stopped as out of memory.
   */
  memoryLimitBytes: number;
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
 * Net heat flow (W) of one load of a steady-state thermal run into the body, positive in, negative out (M5.3). A fixed temperature's is the heat its faces take in or give out, from the solver's nodal heat flows with the heat other loads apply at its nodes taken out; a heat flux's, a convection's and a radiation's are integrated over their faces as the solver does, the last two at the solved surface temperatures; a heat generation's is its power times the volume of its bodies.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "HeatFlow".
 */
export interface HeatFlow {
  loadId: ItemId;
  heat: number;
}
/**
 * Heat in against heat out of a steady-state thermal run (M5.3). heatIn is the sum of the loads' heat flows into the body, heatOut the sum of those out of it (positive); ratio is |heatIn - heatOut| over scale, half the sum of the sizes of every load's nodal heat flows, which equals heatIn and heatOut when no load both heats and cools, so a convection that heats part of a face and cools the rest is still measured against its own size. Numbers only; no verdict.
 *
 * This interface was referenced by `Simulation`'s JSON-Schema
 * via the `definition` "HeatBalance".
 */
export interface HeatBalance {
  heatIn: number;
  heatOut: number;
  scale: number;
  ratio: number;
}
/**
 * Result summary of a succeeded solve job (ADR-030). Displacement in metres, stress in pascals, forces in newtons, temperature in kelvin, heat flux in W/m², heat flows in watts. A linear static run has displacement, vonMises and reactions; a steady-state thermal run has temperature instead (M5.1, ADR-064), and since M5.3 heatFlux, heatFlows and heatBalance. A modal run has frequencies only (M6.1, ADR-070).
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
  displacement?: {
    max: NodeValue;
  };
  /**
   * Smallest and largest von Mises stress of CalculiX's nodal stresses.
   */
  vonMises?: {
    min: NodeValue;
    max: NodeValue;
  };
  /**
   * Smallest and largest nodal temperature of a steady-state thermal run, in kelvin (M5.1).
   */
  temperature?: {
    min: NodeValue;
    max: NodeValue;
  };
  /**
   * Largest heat flux magnitude of a steady-state thermal run, in W/m², from CalculiX's nodal heat flux (M5.3). Absent for thermal runs solved before M5.3.
   */
  heatFlux?: {
    max: NodeValue;
  };
  /**
   * One entry per thermal load of a steady-state thermal run, in spec order (M5.3). Absent for thermal runs solved before M5.3.
   */
  heatFlows?: HeatFlow[];
  heatBalance?: HeatBalance1;
  /**
   * The natural frequencies of a modal run in hertz, lowest first: entry k is mode k + 1 (M6.1, ADR-070). Each is the square root of CalculiX's eigenvalue (rad²/s²) over 2π; an eigenvalue below zero, which only rounding gives (the rigid-body modes of a body free to move), gives minus the square root of its size over 2π.
   */
  frequencies?: number[];
  /**
   * One entry per support, in spec order.
   */
  reactions?: SupportReaction[];
  /**
   * One entry per load, in spec order. Absent for runs solved before M3.2.
   */
  loads?: LoadTotal[];
  balance?: BalanceCheck1;
  /**
   * Smallest safety factor against yield over every node of the mesh: the yield strength of the node's material over its von Mises stress, at most 15 (ADR-054). Absent when a material of the setup has no yield strength, and for runs solved before M3.5.
   */
  safetyFactor?: {
    min: NodeValue;
  };
  software: SolveSoftware;
}
/**
 * Absent for thermal runs solved before M5.3.
 */
export interface HeatBalance1 {
  heatIn: number;
  heatOut: number;
  scale: number;
  ratio: number;
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
  /**
   * The solver the estimate is for (ADR-063); absent in estimates made before it, which were for spooles.
   */
  solver?: "pastix" | "spooles" | "iterative_cholesky" | "iterative_scaling";
  /**
   * linear_static: small-displacement linear elastic static analysis, one load step. steady_thermal: steady-state heat conduction, one step (M5.1, ADR-064), with convection and radiation from faces (M5.2); it solves temperatures only, so it uses thermal loads and no supports. thermal_stress: a steady-state thermal step followed by a linear static step on the temperatures it solved, in one deck (M5.4, ADR-067); it uses supports, the structural loads other than a uniform temperature change, and the thermal loads, and needs the spec's stressFreeTemperature. modal: the natural frequencies of the bodies as they are held, one *FREQUENCY step (M6.1, ADR-070); it uses supports and no loads, and needs the spec's modes; bodies no support holds have rigid-body modes at or near zero.
   */
  analysis?: "linear_static" | "steady_thermal" | "thermal_stress" | "modal";
  /**
   * The modes a modal estimate is for (M6.3); absent for other analyses.
   */
  modes?: number;
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
 * Version 1: one linear static analysis of the bodies of one geometry, isotropic materials, fixed supports, prescribed displacements and frictionless supports (M2.2), elastic supports (M2.6), pressures, forces, gravity and a centrifugal load (M2.3), a uniform temperature change (M2.7), or one steady-state thermal analysis with thermal conductivities and fixed temperatures (M5.1), heat fluxes, convection, radiation and heat generation (M5.2), or one thermal stress analysis with its stress-free temperature (M5.4), or one modal analysis with its number of modes (M6.1), material properties against temperature (M5.5), and the mesh settings: a global size, the element order and local sizes (M2.8), the review of the bonds between touching bodies (M4.2), and the equation solver (ADR-063). Item types joining an array do not change version (ADR-026 item 1); version changes whenever the meaning or shape of existing data does; older stored specs are upgraded by code, never reinterpreted.
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
  /**
   * The equation solver (ADR-063). Absent in specs saved before ADR-063, which means pastix. A run's frozen spec always names it, except for runs made before ADR-063, which were solved with spooles.
   */
  solver?: "pastix" | "spooles" | "iterative_cholesky" | "iterative_scaling";
  /**
   * The temperature at which the bodies have no thermal strain, an absolute temperature quantity above 0 K (M5.4, ADR-067). Used by a thermal stress analysis, whose thermal strain is the thermal expansion times the solved temperature minus this one; absent or null until entered.
   */
  stressFreeTemperature?: Quantity | null;
  /**
   * How many natural frequencies a modal analysis finds, the lowest first (M6.1, ADR-070); absent or null until entered.
   */
  modes?: number | null;
  /**
   * Every candidate bond of the geometry with the user's review of it (M4.2), in the order of topology.json. Absent in specs saved before M4.2, where every candidate counts as detected.
   */
  bonds?: Bond[];
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
export const AnalysisTypeValues = ["linear_static", "steady_thermal", "thermal_stress", "modal"] as const satisfies readonly AnalysisType[];
export const validateAnalysisType = validator<AnalysisType>(schema, "AnalysisType");
export const validateBodyAssignment = validator<BodyAssignment>(schema, "BodyAssignment");
export const BondStatusValues = ["detected", "accepted", "removed"] as const satisfies readonly BondStatus[];
export const validateBondStatus = validator<BondStatus>(schema, "BondStatus");
export const validateBond = validator<Bond>(schema, "Bond");
export const validateIsotropicMaterial = validator<IsotropicMaterial>(schema, "IsotropicMaterial");
export const validatePropertyTableRow = validator<PropertyTableRow>(schema, "PropertyTableRow");
export const validatePropertyTable = validator<PropertyTable>(schema, "PropertyTable");
export const validateExpansionTable = validator<ExpansionTable>(schema, "ExpansionTable");
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
export const validateFixedTemperatureLoad = validator<FixedTemperatureLoad>(schema, "FixedTemperatureLoad");
export const validateHeatFluxLoad = validator<HeatFluxLoad>(schema, "HeatFluxLoad");
export const validateConvectionLoad = validator<ConvectionLoad>(schema, "ConvectionLoad");
export const validateRadiationLoad = validator<RadiationLoad>(schema, "RadiationLoad");
export const validateHeatGenerationLoad = validator<HeatGenerationLoad>(schema, "HeatGenerationLoad");
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
export const SolverValues = ["pastix", "spooles", "iterative_cholesky", "iterative_scaling"] as const satisfies readonly Solver[];
export const validateSolver = validator<Solver>(schema, "Solver");
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
export const validateSimulatedMachine = validator<SimulatedMachine>(schema, "SimulatedMachine");
export const validateXYZ = validator<XYZ>(schema, "XYZ");
export const validateNodeValue = validator<NodeValue>(schema, "NodeValue");
export const validateSupportReaction = validator<SupportReaction>(schema, "SupportReaction");
export const validateLoadTotal = validator<LoadTotal>(schema, "LoadTotal");
export const validateBalanceCheck = validator<BalanceCheck>(schema, "BalanceCheck");
export const validateHeatFlow = validator<HeatFlow>(schema, "HeatFlow");
export const validateHeatBalance = validator<HeatBalance>(schema, "HeatBalance");
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
