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
    linear_static: AnalysisModel;
  };
  /**
   * Factor on the fitted peak memory that a machine size must hold before it is recommended. Recommendations are conservative on memory, because the platform pays when its recommendation is too small (ARCHITECTURE.md).
   */
  memoryMargin: number;
  /**
   * Share of a machine size's memory the solver may use; the rest is left to the system and the worker.
   */
  usableMemoryFraction: number;
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
 * constant + coefficient * nodes ^ exponent, where nodes is the mesh's node count.
 *
 * This interface was referenced by `EstimatorTable`'s JSON-Schema
 * via the `definition` "PowerLaw".
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

export const validateEstimatorTable = validator<EstimatorTable>(schema);
export const validateAnalysisModel = validator<AnalysisModel>(schema, "AnalysisModel");
export const validatePowerLaw = validator<PowerLaw>(schema, "PowerLaw");
