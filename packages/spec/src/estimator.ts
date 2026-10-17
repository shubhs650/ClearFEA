// SPDX-License-Identifier: AGPL-3.0-or-later
// The run estimator's coefficients (../estimator.json, ADR-049), checked against their
// schema when first imported, and the memory and time they predict for a mesh with each
// equation solver; and the element limits per solver and element order on a 16 GiB machine
// (ADR-063). Since M6.3 a modal run has a model of its own, with a part per mode, for the
// solvers that may solve it. Pure: the cost per machine size is the API's
// (apps/api/src/billing/estimate.ts).

import table from "../estimator.json";
import {
  type AnalysisModel,
  type EstimatorTable,
  type ModalModel,
  type PowerLaw,
  validateEstimatorTable,
} from "./generated/estimator";
import type { AnalysisType, ElementOrder, SimulationSpec, Solver } from "./generated/simulation";

/** The solver of a spec that names none: specs saved before ADR-063. */
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

/** The iterative solvers, which are not verified to the 0.1 percent checks (ADR-063). */
export function isIterative(solver: Solver): boolean {
  return solver === "iterative_cholesky" || solver === "iterative_scaling";
}

/** The accuracy note shown wherever an iterative solver is chosen or was used (ADR-063). */
export const ITERATIVE_ACCURACY_NOTE =
  "Iterative solvers stop at a fixed relative residual of 1e-4 in CalculiX 2.21. On the verification cases their results were up to about 0.5 percent off, while PaStiX and SPOOLES are verified to 0.1 percent.";

/** The solver a spec asks for. */
export function specSolver(spec: SimulationSpec): Solver {
  return spec.solver ?? DEFAULT_SOLVER;
}

/** What a run solves, as far as the estimate is concerned. */
export interface RunKind {
  analysis: AnalysisType;
  /** Modes a modal run finds; ignored for other analyses. */
  modes?: number | null;
}

/** A linear static run: the estimate of a spec that says nothing else. */
export const STATIC_RUN: RunKind = { analysis: "linear_static" };

/** The most modes a modal setup may ask for (simulation.schema.json); modal limits are for it. */
export const MAX_MODES = 100;

/** What a spec's run solves. A modal setup with no number of modes yet counts the most. */
export function specRunKind(spec: Pick<SimulationSpec, "analysis" | "modes">): RunKind {
  return spec.analysis === "modal" ? { analysis: "modal", modes: spec.modes ?? MAX_MODES } : { analysis: spec.analysis };
}

type Model = { kind: "static"; model: AnalysisModel } | { kind: "modal"; model: ModalModel; modes: number };

/**
 * The fitted model for a run, or null when `solver` cannot solve it (a modal run with a solver
 * the table has no modal model for). Thermal runs use the linear static model (ADR-064): one
 * unknown per node instead of three, so the estimate is high, the safe side.
 */
function modelFor(solver: Solver, kind: RunKind, estimator: EstimatorTable): Model | null {
  if (kind.analysis !== "modal") return { kind: "static", model: estimator.analyses.linear_static[solver] };
  const model = estimator.analyses.modal[solver as keyof EstimatorTable["analyses"]["modal"]];
  return model === undefined ? null : { kind: "modal", model, modes: kind.modes ?? MAX_MODES };
}

/** modelFor, for a solver known to solve a run of `kind`. */
function solvedBy(solver: Solver, kind: RunKind, estimator: EstimatorTable): Model {
  const found = modelFor(solver, kind, estimator);
  if (found === null) throw new RangeError(runSolverProblem(solver, kind, estimator) ?? "no model");
  return found;
}

/** The solvers a run of `kind` may use, in the order the setup offers them. */
export function runSolvers(kind: RunKind = STATIC_RUN, estimator: EstimatorTable = estimatorTable): Solver[] {
  return SOLVERS.filter((solver) => modelFor(solver, kind, estimator) !== null);
}

/**
 * Why `solver` cannot solve a run of `kind`, in plain language with what to do; null when it
 * can. Pre-run validation gives its own reasons for the same setups; this one is for the
 * estimate of a solver choice.
 */
export function runSolverProblem(
  solver: Solver,
  kind: RunKind = STATIC_RUN,
  estimator: EstimatorTable = estimatorTable,
): string | null {
  if (modelFor(solver, kind, estimator) !== null) return null;
  const others = runSolvers(kind, estimator).map((other) => SOLVER_LABELS[other]);
  return `${SOLVER_LABELS[solver]} cannot solve a modal analysis. Choose ${others.join(" or ")} as the equation solver.`;
}

export function checkEstimatorTable(raw: unknown, source = "packages/spec/estimator.json"): EstimatorTable {
  const checked = validateEstimatorTable(raw);
  if (!checked.ok) {
    throw new Error(`${source} does not match its schema: ${checked.errors.join("; ")}`);
  }
  for (const [analysis, models] of Object.entries(checked.value.analyses)) {
    for (const [solver, model] of Object.entries(models as Record<string, { fittedNodes: number[] }>)) {
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

/**
 * What a solve of a mesh with `nodes` nodes of element `order` is fitted to need with `solver`:
 * a linear static one unless `kind` says otherwise. The static job time is fitted per element
 * order (M8.9); memory, and a modal run's model, are for both orders. Throws when `solver` cannot solve a run of `kind`
 * (runSolverProblem says why).
 */
export function estimateMesh(
  nodes: number,
  order: ElementOrder,
  solver: Solver = DEFAULT_SOLVER,
  kind: RunKind = STATIC_RUN,
  estimator: EstimatorTable = estimatorTable,
): MeshEstimate {
  if (!Number.isSafeInteger(nodes) || nodes < 0) {
    throw new RangeError(`a node count must be a whole number, 0 or more, not ${nodes}`);
  }
  const found = solvedBy(solver, kind, estimator);
  if (found.kind === "static") {
    const { model } = found;
    return {
      memoryBytes: Math.ceil(powerLaw(model.peakMemoryBytes, nodes)),
      seconds: Math.ceil(powerLaw(order === 1 ? model.jobSecondsByOrder.order1 : model.jobSecondsByOrder.order2, nodes)),
      extrapolated: nodes > model.fittedNodes[1],
    };
  }
  const { model, modes } = found;
  return {
    memoryBytes: Math.ceil(
      powerLaw(model.peakMemoryBytes, nodes) + modes * powerLaw(model.peakMemoryBytesPerMode, nodes),
    ),
    seconds: Math.ceil(powerLaw(model.jobSeconds, nodes) + modes * powerLaw(model.jobSecondsPerMode, nodes)),
    extrapolated: nodes > model.fittedNodes[1] || modes > model.fittedModes[1],
  };
}

/**
 * Whether a machine with `memoryBytes` of memory holds a solve fitted to peak at `peakBytes`:
 * the peak times the margin must fit in the share of the memory the solver may use.
 */
export function memoryFits(peakBytes: number, memoryBytes: number, estimator: EstimatorTable = estimatorTable): boolean {
  return peakBytes * estimator.memoryMargin <= memoryBytes * estimator.usableMemoryFraction;
}

/**
 * The most elements of `order` a run of `kind` with `solver` may have on the limits' machine
 * (ADR-063); a modal run's limit is for the most modes (M6.3). Throws when `solver` cannot
 * solve a run of `kind`.
 */
export function maxElements(
  solver: Solver,
  order: ElementOrder,
  kind: RunKind = STATIC_RUN,
  estimator: EstimatorTable = estimatorTable,
): number {
  const limits = solvedBy(solver, kind, estimator).model.maxElements;
  return order === 1 ? limits.order1 : limits.order2;
}

/** The limits' machine memory as people say it: "16 GB". */
export function limitMemoryText(estimator: EstimatorTable = estimatorTable): string {
  return `${Math.round(estimator.limitMemoryBytes / 2 ** 30)} GB`;
}

const ORDER_WORDS: Record<ElementOrder, string> = { 1: "4-node", 2: "10-node" };

/**
 * Why a mesh of `elements` elements of `order` is too large for `solver`, in plain language
 * with what to do; null when it is within the solver's limit (ADR-063), or when the solver
 * cannot solve a run of `kind` at all (pre-run validation says so). A run past the limit
 * could run out of memory, so it is refused before any machine is used.
 */
export function elementLimitProblem(
  solver: Solver,
  order: ElementOrder,
  elements: number,
  kind: RunKind = STATIC_RUN,
  estimator: EstimatorTable = estimatorTable,
): string | null {
  if (runSolverProblem(solver, kind, estimator) !== null) return null;
  const limit = maxElements(solver, order, kind, estimator);
  if (elements <= limit) return null;
  const count = (n: number) => n.toLocaleString("en-US");
  const larger = runSolvers(kind, estimator)
    .filter((other) => maxElements(other, order, kind, estimator) >= elements)
    .map((other) => `${SOLVER_LABELS[other]} (up to ${count(maxElements(other, order, kind, estimator))})`);
  const otherOrder: ElementOrder = order === 2 ? 1 : 2;
  const switchOrder =
    order === 2 && maxElements(solver, otherOrder, kind, estimator) > limit ? ", use 4-node elements" : "";
  const choose = larger.length > 0 ? `, or choose a solver that takes it: ${larger.join(", ")}` : "";
  const modal = kind.analysis === "modal" ? ` in a modal analysis of up to ${MAX_MODES} modes` : "";
  return (
    `The mesh has ${count(elements)} ${ORDER_WORDS[order]} elements, more than the ${count(limit)} ` +
    `${SOLVER_LABELS[solver]} can solve${modal} on a ${limitMemoryText(estimator)} machine. ` +
    `Make the mesh coarser${switchOrder}${choose}.`
  );
}
