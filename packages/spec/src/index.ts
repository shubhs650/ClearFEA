// SPDX-License-Identifier: AGPL-3.0-or-later
export * from "./generated";
export { movesByDisplacement, preRunProblems, thermalBodyMessages, unheldBodyMessages, wrongAnalysisMessage } from "./prerun";
export {
  analysisKinds,
  analysisLoads,
  bodyLabels,
  bondIsTied,
  bondKey,
  checkSimulationSpec,
  displacementAxes,
  elementOrder,
  emptySimulationSpec,
  faceHeatConflicts,
  hasBodyLoad,
  hasTemperatureChange,
  isThermal,
  loadHasFaces,
  loadKinds,
  materialProblems,
  localScopes,
  localSizeParams,
  MESH_SETTINGS_VERSION,
  meshSettingsText,
  sameMeshSettings,
  setsTemperature,
  type SpecProblem,
  simulationSpecProblems,
  specBonds,
  unheldBodies,
  supportKinds,
  type TopologyBondTags,
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
export { checkReportNotes, hasTiedBonds, reportNotes, runReportNotes } from "./report";
export { checkUnitsTable, isUnitSystem, systemUnit, unitsTable } from "./units";
export { type Validation, validator } from "./validate";
export { checkMaterialLibrary, materialLibrary } from "./library";
