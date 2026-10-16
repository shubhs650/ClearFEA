// SPDX-License-Identifier: AGPL-3.0-or-later
export * from "./generated";
export { movesByDisplacement, preRunProblems } from "./prerun";
export {
  checkSimulationSpec,
  displacementAxes,
  elementOrder,
  emptySimulationSpec,
  hasBodyLoad,
  hasTemperatureChange,
  loadHasFaces,
  loadKinds,
  materialProblems,
  localScopes,
  localSizeParams,
  MESH_SETTINGS_VERSION,
  meshSettingsText,
  sameMeshSettings,
  type SpecProblem,
  simulationSpecProblems,
  supportKinds,
  type TopologyTags,
} from "./simulation";
export {
  checkEstimatorTable,
  DEFAULT_SOLVER,
  elementLimitProblem,
  estimateMesh,
  estimatorTable,
  ITERATIVE_ACCURACY_NOTE,
  isIterative,
  limitMemoryText,
  type MeshEstimate,
  maxElements,
  memoryFits,
  powerLaw,
  SOLVER_LABELS,
  SOLVERS,
  specSolver,
} from "./estimator";
export { checkUnitsTable, isUnitSystem, systemUnit, unitsTable } from "./units";
export { type Validation, validator } from "./validate";
export { checkMaterialLibrary, materialLibrary } from "./library";
