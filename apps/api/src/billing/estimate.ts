// SPDX-License-Identifier: AGPL-3.0-or-later
// Estimate before a run (M2.12, ADR-049; docs/ARCHITECTURE.md, Estimator): peak memory and job
// time from the estimator's fitted coefficients (packages/spec/estimator.json), the cost of that
// time on every machine size, and the size recommended. Pure: the sizes come from the caller.

import {
  type ElementOrder,
  type EstimatorTable,
  estimateMesh,
  type FailureCategory,
  estimatorTable,
  memoryFits,
  type RunEstimate,
  type RunKind,
  STATIC_RUN,
  type SimulatedMachine,
  type SizeEstimate,
  type Solver,
} from "@clearfea/spec";
import { costOf } from "./cost";

/** A row of machine_sizes: configuration, the same for every user. */
export interface MachineSize {
  name: string;
  cores: number;
  memoryBytes: number;
  /** Micro-credits per hour of billable time. */
  ratePerHour: number;
}

/**
 * The estimate for solving a mesh of `nodes` nodes of element `order` with `solver` (ADR-063),
 * for a run of `kind` (a modal run has its own model, M6.3). The solver runs on one thread on every size
 * (ADR-048 item 3), so the time is the same on each and only the rate differs. The
 * recommended size is the cheapest whose memory fits, conservatively (estimator.json's
 * margin); null when none does. Throws when `solver` cannot solve a run of `kind`.
 */
export function estimateRun(
  nodes: number,
  order: ElementOrder,
  sizes: readonly MachineSize[],
  solver: Solver,
  kind: RunKind = STATIC_RUN,
  estimator: EstimatorTable = estimatorTable,
): RunEstimate {
  const mesh = estimateMesh(nodes, order, solver, kind, estimator);
  const priced: SizeEstimate[] = [...sizes]
    .sort((a, b) => a.ratePerHour - b.ratePerHour || a.memoryBytes - b.memoryBytes || a.name.localeCompare(b.name))
    .map((size) => ({
      size: size.name,
      cores: size.cores,
      memoryBytes: size.memoryBytes,
      ratePerHour: size.ratePerHour,
      cost: costOf(mesh.seconds, size.ratePerHour),
      fits: memoryFits(mesh.memoryBytes, size.memoryBytes, estimator),
    }));
  return {
    estimator: estimator.version,
    nodes,
    memoryBytes: mesh.memoryBytes,
    seconds: mesh.seconds,
    extrapolated: mesh.extrapolated,
    sizes: priced,
    recommended: priced.find((size) => size.fits)?.size ?? null,
    solver,
    analysis: kind.analysis,
    ...(kind.analysis === "modal" && kind.modes != null ? { modes: kind.modes } : {}),
  };
}

/**
 * The size a run goes on: the one asked for, else the recommended one, else (when no size
 * fits) the one with the most memory. Undefined when the size asked for is not on the list.
 */
export function runSize(estimate: RunEstimate, requested?: string): SizeEstimate | undefined {
  if (requested !== undefined) return estimate.sizes.find((size) => size.size === requested);
  const recommended = estimate.sizes.find((size) => size.size === estimate.recommended);
  if (recommended !== undefined) return recommended;
  return [...estimate.sizes].sort((a, b) => b.memoryBytes - a.memoryBytes)[0];
}

/**
 * How the worker simulates `size` (M8.5, ADR-082): the solver held to the size's cores and
 * stopped as out of memory past its usable memory, the share of it the recommendation counts on.
 */
export function simulatedMachine(size: SizeEstimate, estimator: EstimatorTable = estimatorTable): SimulatedMachine {
  return {
    size: size.size,
    cores: size.cores,
    memoryLimitBytes: Math.floor(size.memoryBytes * estimator.usableMemoryFraction),
  };
}

/**
 * Who pays for a run that ran out of memory on the size `sizeName` (DECISIONS "Failed runs",
 * ADR-082). The user does when they chose that size against the platform: it is not the size
 * the platform would have put the run on (the recommended one, or the largest when none fits)
 * and by the estimate its memory does not fit. Otherwise the platform's recommendation or its
 * estimate was wrong, and it pays. A run without an estimate (before M2.12) is the platform's.
 */
export function outOfMemoryFault(estimate: RunEstimate | null, sizeName: string | null): FailureCategory {
  if (estimate === null || sizeName === null) return "platform_fault";
  const size = estimate.sizes.find((s) => s.size === sizeName);
  if (size === undefined) return "platform_fault";
  const platformPick = runSize(estimate);
  return size.size !== platformPick?.size && !size.fits ? "user_fault" : "platform_fault";
}
