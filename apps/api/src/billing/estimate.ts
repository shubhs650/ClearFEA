// SPDX-License-Identifier: AGPL-3.0-or-later
// Estimate before a run (M2.12, ADR-049; docs/ARCHITECTURE.md, Estimator): peak memory and job
// time from the estimator's fitted coefficients (packages/spec/estimator.json), the cost of that
// time on every machine size, and the size recommended. Pure: the sizes come from the caller.

import {
  type EstimatorTable,
  estimateMesh,
  estimatorTable,
  memoryFits,
  type RunEstimate,
  type SizeEstimate,
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
 * The estimate for solving a mesh of `nodes` nodes. The solver runs on one thread on every size
 * (ADR-048 item 3), so the time is the same on each and only the rate differs. The recommended
 * size is the cheapest whose memory fits, conservatively (estimator.json's margin); null when
 * none does.
 */
export function estimateRun(
  nodes: number,
  sizes: readonly MachineSize[],
  estimator: EstimatorTable = estimatorTable,
): RunEstimate {
  const mesh = estimateMesh(nodes, estimator);
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
