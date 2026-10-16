// SPDX-License-Identifier: AGPL-3.0-or-later
// The run estimator's coefficients (../estimator.json, ADR-049), checked against their
// schema when first imported, and the memory and time they predict for a mesh with each
// equation solver; and the element limits per solver and element order on a 16 GiB machine
// (ADR-058). Pure: the cost per machine size is the API's (apps/api/src/billing/estimate.ts).

import table from "../estimator.json";
import { type EstimatorTable, type PowerLaw, validateEstimatorTable } from "./generated/estimator";
import type { ElementOrder, SimulationSpec, Solver } from "./generated/simulation";

/** The solver of a spec that names none: specs saved before ADR-058. */
export const DEFAULT_SOLVER: Solver = "pastix";

/** Every solver a run can use, in the order the setup offers them. */
export const SOLVERS: readonly Solver[] = ["pastix", "spooles", "iterative_cholesky", "iterative_scaling"];

/** What each solver is called in the app and the report. */
export const SOLVER_LABELS: Record<Solver, string> = {
  pastix: "PaStiX",
  spooles: "SPOOLES",
  iterative_cholesky: "Iterative Cholesky",
  iterative_scaling: "Iterative scaling",
};

/** The iterative solvers, which are not verified to the 0.1 percent checks (ADR-058). */
export function isIterative(solver: Solver): boolean {
  return solver === "iterative_cholesky" || solver === "iterative_scaling";
}

/** The accuracy note shown wherever an iterative solver is chosen or was used (ADR-058). */
export const ITERATIVE_ACCURACY_NOTE =
  "Iterative solvers stop at a fixed relative residual of 1e-4 in CalculiX 2.21. On the verification cases their results were up to about 0.5 percent off, while PaStiX and SPOOLES are verified to 0.1 percent.";

/** The solver a spec asks for. */
export function specSolver(spec: SimulationSpec): Solver {
  return spec.solver ?? DEFAULT_SOLVER;
}

export function checkEstimatorTable(raw: unknown, source = "packages/spec/estimator.json"): EstimatorTable {
  const checked = validateEstimatorTable(raw);
  if (!checked.ok) {
    throw new Error(`${source} does not match its schema: ${checked.errors.join("; ")}`);
  }
  for (const [analysis, models] of Object.entries(checked.value.analyses)) {
    for (const [solver, model] of Object.entries(models)) {
      const [low, high] = model.fittedNodes;
      if (low === undefined || high === undefined || low > high) {
        throw new Error(
          `${source}: ${analysis} ${solver}'s fittedNodes must be the smallest then the largest node count.`,
        );
      }
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

/** What a linear static solve of a mesh with `nodes` nodes is fitted to need with `solver`. */
export function estimateMesh(
  nodes: number,
  solver: Solver = DEFAULT_SOLVER,
  estimator: EstimatorTable = estimatorTable,
): MeshEstimate {
  if (!Number.isSafeInteger(nodes) || nodes < 0) {
    throw new RangeError(`a node count must be a whole number, 0 or more, not ${nodes}`);
  }
  const model = estimator.analyses.linear_static[solver];
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

/** The most elements of `order` a run with `solver` may have on the limits' machine (ADR-058). */
export function maxElements(solver: Solver, order: ElementOrder, estimator: EstimatorTable = estimatorTable): number {
  const limits = estimator.analyses.linear_static[solver].maxElements;
  return order === 1 ? limits.order1 : limits.order2;
}

/** The limits' machine memory as people say it: "16 GB". */
export function limitMemoryText(estimator: EstimatorTable = estimatorTable): string {
  return `${Math.round(estimator.limitMemoryBytes / 2 ** 30)} GB`;
}

const ORDER_WORDS: Record<ElementOrder, string> = { 1: "4-node", 2: "10-node" };

/**
 * Why a mesh of `elements` elements of `order` is too large for `solver`, in plain language
 * with what to do; null when it is within the solver's limit (ADR-058). A run past the limit
 * could run out of memory, so it is refused before any machine is used.
 */
export function elementLimitProblem(
  solver: Solver,
  order: ElementOrder,
  elements: number,
  estimator: EstimatorTable = estimatorTable,
): string | null {
  const limit = maxElements(solver, order, estimator);
  if (elements <= limit) return null;
  const count = (n: number) => n.toLocaleString("en-US");
  const larger = SOLVERS.filter((other) => maxElements(other, order, estimator) >= elements).map(
    (other) => `${SOLVER_LABELS[other]} (up to ${count(maxElements(other, order, estimator))})`,
  );
  const otherOrder: ElementOrder = order === 2 ? 1 : 2;
  const switchOrder =
    order === 2 && maxElements(solver, otherOrder, estimator) > limit ? ", use 4-node elements" : "";
  const choose = larger.length > 0 ? `, or choose a solver that takes it: ${larger.join(", ")}` : "";
  return (
    `The mesh has ${count(elements)} ${ORDER_WORDS[order]} elements, more than the ${count(limit)} ` +
    `${SOLVER_LABELS[solver]} can solve on a ${limitMemoryText(estimator)} machine. ` +
    `Make the mesh coarser${switchOrder}${choose}.`
  );
}
