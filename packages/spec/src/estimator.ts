// SPDX-License-Identifier: AGPL-3.0-or-later
// The run estimator's fitted coefficients (../estimator.json, ADR-049), checked against their
// schema when first imported, and the memory and time they predict for a mesh. Pure: the cost
// per machine size is the API's (apps/api/src/billing/estimate.ts).

import table from "../estimator.json";
import { type EstimatorTable, type PowerLaw, validateEstimatorTable } from "./generated/estimator";

export function checkEstimatorTable(raw: unknown, source = "packages/spec/estimator.json"): EstimatorTable {
  const checked = validateEstimatorTable(raw);
  if (!checked.ok) {
    throw new Error(`${source} does not match its schema: ${checked.errors.join("; ")}`);
  }
  for (const [analysis, model] of Object.entries(checked.value.analyses)) {
    const [low, high] = model.fittedNodes;
    if (low === undefined || high === undefined || low > high) {
      throw new Error(`${source}: ${analysis}'s fittedNodes must be the smallest then the largest node count.`);
    }
  }
  return checked.value;
}

export const estimatorTable: EstimatorTable = checkEstimatorTable(table);

/** constant + coefficient × nodes ^ exponent. */
export function powerLaw(term: PowerLaw, nodes: number): number {
  return term.constant + term.coefficient * nodes ** term.exponent;
}

export interface MeshEstimate {
  /** Fitted peak memory of the solver, bytes, rounded up. */
  memoryBytes: number;
  /** Fitted billable time of the solve job, whole seconds, rounded up. */
  seconds: number;
  /** The mesh has more nodes than any the fit was measured on. */
  extrapolated: boolean;
}

/** What a linear static solve of a mesh with `nodes` nodes is fitted to need. */
export function estimateMesh(nodes: number, estimator: EstimatorTable = estimatorTable): MeshEstimate {
  if (!Number.isSafeInteger(nodes) || nodes < 0) {
    throw new RangeError(`a node count must be a whole number, 0 or more, not ${nodes}`);
  }
  const model = estimator.analyses.linear_static;
  return {
    memoryBytes: Math.ceil(powerLaw(model.peakMemoryBytes, nodes)),
    seconds: Math.ceil(powerLaw(model.jobSeconds, nodes)),
    extrapolated: nodes > model.fittedNodes[1],
  };
}

/**
 * Whether a machine with `memoryBytes` of memory holds a solve fitted to peak at `peakBytes`:
 * the peak times the margin must fit in the share of the memory the solver may use.
 */
export function memoryFits(peakBytes: number, memoryBytes: number, estimator: EstimatorTable = estimatorTable): boolean {
  return peakBytes * estimator.memoryMargin <= memoryBytes * estimator.usableMemoryFraction;
}
