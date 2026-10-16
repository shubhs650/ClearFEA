// SPDX-License-Identifier: AGPL-3.0-or-later
// Generated from packages/spec/schemas/estimator.schema.json by packages/spec/scripts/generate.mjs.
// Do not edit by hand; change the schema and run `make spec`.

import schema from "../../schemas/estimator.schema.json";
import { validator } from "../validate";

/**
 * Shape of packages/spec/estimator.json, the run estimator's fitted coefficients (ARCHITECTURE.md, Estimator; ADR-049). Written by worker/benchmarks/solver/fit.py from the benchmark data; never edited by hand. Every quantity is SI: bytes and seconds.
 */
export interface EstimatorTable {
  /**
   * Bumped whenever a coefficient changes, so a run's frozen estimate says which fit made it.
   */
  version: number;
  /**
   * Where the fit's data came from, for people.
   */
  source: string;
  /**
   * One model per analysis type a run can have.
   */
  analyses: {
    linear_static: SolverModels;
    modal: ModalSolverModels;
  };
  /**
   * Factor on the fitted peak memory that a machine size must hold before it is recommended. Recommendations are conservative on memory, because the platform pays when its recommendation is too small (ARCHITECTURE.md).
   */
  memoryMargin: number;
  /**
   * Share of a machine size's memory the solver may use; the rest is left to the system and the worker.
   */
  usableMemoryFraction: number;
  /**
   * Memory of the machine the element limits are for (ADR-063): 16 GiB in Phase 0. A run whose mesh has more elements than its solver's limit is refused.
   */
  limitMemoryBytes: number;
}
/**
 * Linear static runs; steady-state thermal and thermal stress runs are estimated with it too (ADR-064).
 */
export interface SolverModels {
  pastix: AnalysisModel;
  spooles: AnalysisModel;
  iterative_cholesky: AnalysisModel;
  iterative_scaling: AnalysisModel;
}
/**
 * This interface was referenced by `EstimatorTable`'s JSON-Schema
 * via the `definition` "AnalysisModel".
 */
export interface AnalysisModel {
  /**
   * The solver and threads the fit was measured with.
   */
  solver: string;
  peakMemoryBytes: PowerLaw;
  jobSeconds: PowerLaw1;
  /**
   * Smallest and largest node count among the measurements; outside this range the estimate is an extrapolation.
   *
   * @minItems 2
   * @maxItems 2
   */
  fittedNodes: [number, number];
  maxElements: MaxElements;
}
/**
 * Peak resident memory of the solver process.
 */
export interface PowerLaw {
  constant: number;
  coefficient: number;
  exponent: number;
  /**
   * Largest measured value over the fitted one among the measurements: how far the fit fell short at worst.
   */
  largestRatio: number;
}
/**
 * Wall time of the solve job's billable phase: writing the deck, the solver, reading results and writing the viewer's files.
 */
export interface PowerLaw1 {
  constant: number;
  coefficient: number;
  exponent: number;
  /**
   * Largest measured value over the fitted one among the measurements: how far the fit fell short at worst.
   */
  largestRatio: number;
}
/**
 * Largest element count a run with this solver may have, per element order, on a machine of limitMemoryBytes: the node count whose fitted peak memory times memoryMargin fits in usableMemoryFraction of it, turned into elements with the nodes per element of the measured mesh nearest it, at most the largest mesh measured, rounded down to a thousand.
 *
 * This interface was referenced by `EstimatorTable`'s JSON-Schema
 * via the `definition` "MaxElements".
 */
export interface MaxElements {
  /**
   * Four-node tetrahedra.
   */
  order1: number;
  /**
   * Ten-node tetrahedra.
   */
  order2: number;
}
/**
 * One model per equation solver a modal run may use (M6.3). A solver without one cannot solve a modal run: CalculiX refuses the iterative solvers on a frequency step (ADR-070), and PaStiX is not measured (ADR-072).
 *
 * This interface was referenced by `EstimatorTable`'s JSON-Schema
 * via the `definition` "ModalSolverModels".
 */
export interface ModalSolverModels {
  pastix?: ModalModel;
  spooles?: ModalModel;
}
/**
 * A modal run's peak memory and job time are a part for the mesh plus a part per mode found: peakMemoryBytes + modes × peakMemoryBytesPerMode, and the same for jobSeconds (M6.3). Each part is a power law in the node count. The largestRatio of peakMemoryBytes and jobSeconds is the worst shortfall of the whole sum among the modal measurements.
 *
 * This interface was referenced by `EstimatorTable`'s JSON-Schema
 * via the `definition` "ModalModel".
 */
export interface ModalModel {
  /**
   * The solver and threads the fit was measured with.
   */
  solver: string;
  peakMemoryBytes: PowerLaw2;
  peakMemoryBytesPerMode: PowerLaw3;
  jobSeconds: PowerLaw4;
  jobSecondsPerMode: PowerLaw5;
  /**
   * Smallest and largest node count among the measurements; outside this range the estimate is an extrapolation.
   *
   * @minItems 2
   * @maxItems 2
   */
  fittedNodes: [number, number];
  /**
   * Fewest and most modes among the measurements.
   *
   * @minItems 2
   * @maxItems 2
   */
  fittedModes: [number, number];
  maxElements: MaxElements1;
}
/**
 * Peak resident memory of the solver process, the part that does not grow with the modes.
 */
export interface PowerLaw2 {
  constant: number;
  coefficient: number;
  exponent: number;
  /**
   * Largest measured value over the fitted one among the measurements: how far the fit fell short at worst.
   */
  largestRatio: number;
}
/**
 * Peak resident memory added by each mode asked for.
 */
export interface PowerLaw3 {
  constant: number;
  coefficient: number;
  exponent: number;
  /**
   * Largest measured value over the fitted one among the measurements: how far the fit fell short at worst.
   */
  largestRatio: number;
}
/**
 * Wall time of the solve job's billable phase, the part that does not grow with the modes.
 */
export interface PowerLaw4 {
  constant: number;
  coefficient: number;
  exponent: number;
  /**
   * Largest measured value over the fitted one among the measurements: how far the fit fell short at worst.
   */
  largestRatio: number;
}
/**
 * Wall time added by each mode asked for.
 */
export interface PowerLaw5 {
  constant: number;
  coefficient: number;
  exponent: number;
  /**
   * Largest measured value over the fitted one among the measurements: how far the fit fell short at worst.
   */
  largestRatio: number;
}
/**
 * Largest element count a run with this solver may have, per element order, on a machine of limitMemoryBytes: the node count whose fitted peak memory times memoryMargin fits in usableMemoryFraction of it, turned into elements with the nodes per element of the measured mesh nearest it, at most the largest mesh measured, rounded down to a thousand.
 */
export interface MaxElements1 {
  /**
   * Four-node tetrahedra.
   */
  order1: number;
  /**
   * Ten-node tetrahedra.
   */
  order2: number;
}
/**
 * One model per equation solver a run can use (ADR-063), keyed as SimulationSpec's solver.
 *
 * This interface was referenced by `EstimatorTable`'s JSON-Schema
 * via the `definition` "SolverModels".
 */
export interface SolverModels1 {
  pastix: AnalysisModel;
  spooles: AnalysisModel;
  iterative_cholesky: AnalysisModel;
  iterative_scaling: AnalysisModel;
}
/**
 * constant + coefficient * nodes ^ exponent, where nodes is the mesh's node count.
 *
 * This interface was referenced by `EstimatorTable`'s JSON-Schema
 * via the `definition` "PowerLaw".
 */
export interface PowerLaw6 {
  constant: number;
  coefficient: number;
  exponent: number;
  /**
   * Largest measured value over the fitted one among the measurements: how far the fit fell short at worst.
   */
  largestRatio: number;
}

export const validateEstimatorTable = validator<EstimatorTable>(schema);
export const validateSolverModels = validator<SolverModels>(schema, "SolverModels");
export const validateModalSolverModels = validator<ModalSolverModels>(schema, "ModalSolverModels");
export const validateModalModel = validator<ModalModel>(schema, "ModalModel");
export const validateAnalysisModel = validator<AnalysisModel>(schema, "AnalysisModel");
export const validateMaxElements = validator<MaxElements>(schema, "MaxElements");
export const validatePowerLaw = validator<PowerLaw>(schema, "PowerLaw");
