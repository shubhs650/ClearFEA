// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for a simulation's runs and /api/runs (M1.8), a run's result files (M1.9) and its
// solver input and log (M1.10), the estimate before a run (M2.12), and its mesh and values at
// every node for cut planes (M3.4) and export (M3.8); the estimate is for a solver (ADR-063)
// and an analysis, with a modal run's modes (M6.3); a run's pin and a rerun of its frozen setup
// that regenerates removed raw output (M8.6). Shapes: simulation.schema.json.

import {
  type RunEstimate,
  type RunFileName,
  type RunKind,
  STATIC_RUN,
  type RunLogResponse,
  type RunView,
  type Solver,
  validateEstimateResponse,
  validateRunListResponse,
  validateRunLogResponse,
  validateRunResponse,
} from "@clearfea/spec";
import { type ApiResult, apiBinary, apiRequest } from "./request";

/** The simulation's runs, newest first. */
export async function listRuns(simulationId: string): Promise<ApiResult<RunView[]>> {
  const path = `/api/simulations/${encodeURIComponent(simulationId)}/runs`;
  const result = await apiRequest("GET", path, validateRunListResponse);
  return result.kind === "ok" ? { kind: "ok", value: result.value.runs } : result;
}

/**
 * Solves the simulation's saved setup on its current mesh, on the machine size named or, without
 * one, on the recommended size.
 */
export async function startRun(simulationId: string, machineSize?: string): Promise<ApiResult<RunView>> {
  const path = `/api/simulations/${encodeURIComponent(simulationId)}/runs`;
  const body = machineSize === undefined ? undefined : { machineSize };
  const result = await apiRequest("POST", path, validateRunResponse, body);
  return result.kind === "ok" ? { kind: "ok", value: result.value.run } : result;
}

/** Memory, time and cost estimated for solving on the current mesh, per machine size. */
export async function getEstimate(
  simulationId: string,
  solver: Solver,
  kind: RunKind = STATIC_RUN,
): Promise<ApiResult<RunEstimate>> {
  const modes = kind.analysis === "modal" && kind.modes != null ? `&modes=${kind.modes}` : "";
  const path =
    `/api/simulations/${encodeURIComponent(simulationId)}/estimate?solver=${encodeURIComponent(solver)}` +
    `&analysis=${encodeURIComponent(kind.analysis)}${modes}`;
  const result = await apiRequest("GET", path, validateEstimateResponse);
  return result.kind === "ok" ? { kind: "ok", value: result.value.estimate } : result;
}

export async function getRun(runId: string): Promise<ApiResult<RunView>> {
  const result = await apiRequest("GET", `/api/runs/${encodeURIComponent(runId)}`, validateRunResponse);
  return result.kind === "ok" ? { kind: "ok", value: result.value.run } : result;
}

/**
 * Cancels a solving run (M8.2): one still waiting ends at once; one the solver is on stops
 * within a few seconds, and the time it used is charged. Answers the run as it is now.
 */
export async function cancelRun(runId: string): Promise<ApiResult<RunView>> {
  const result = await apiRequest("POST", `/api/runs/${encodeURIComponent(runId)}/cancel`, validateRunResponse);
  return result.kind === "ok" ? { kind: "ok", value: result.value.run } : result;
}

/** The solver log written after chunk `after`. */
export function getRunLog(runId: string, after: number): Promise<ApiResult<RunLogResponse>> {
  return apiRequest("GET", `/api/runs/${encodeURIComponent(runId)}/log?after=${after}`, validateRunLogResponse);
}

/** The run's mesh surface in the display mesh format (packages/spec/display-mesh.md), unparsed. */
export function fetchRunSurface(runId: string): Promise<ApiResult<ArrayBuffer>> {
  return apiBinary(`/api/runs/${encodeURIComponent(runId)}/surface`);
}

/** The run's result values per surface vertex (packages/spec/result-fields.md), unparsed. */
export function fetchRunFields(runId: string): Promise<ApiResult<ArrayBuffer>> {
  return apiBinary(`/api/runs/${encodeURIComponent(runId)}/fields`);
}

/** The volume mesh the run was solved on (packages/spec/volume-mesh.md), unparsed, for cut
 * planes (M3.4). */
export function fetchRunMesh(runId: string): Promise<ApiResult<ArrayBuffer>> {
  return apiBinary(`/api/runs/${encodeURIComponent(runId)}/mesh`);
}

/** One result field at every node of the run's mesh, as a result-fields file
 * (packages/spec/result-fields.md) with that field alone, unparsed, for cut planes (M3.4). */
export function fetchRunNodeField(runId: string, field: string): Promise<ApiResult<ArrayBuffer>> {
  return apiBinary(`/api/runs/${encodeURIComponent(runId)}/nodes?field=${encodeURIComponent(field)}`);
}

/** Every result field at every node of the run's mesh (packages/spec/result-fields.md),
 * unparsed, for CSV and VTK export (M3.8). */
export function fetchRunNodes(runId: string): Promise<ApiResult<ArrayBuffer>> {
  return apiBinary(`/api/runs/${encodeURIComponent(runId)}/nodes`);
}

/**
 * Where the browser shows one of a run's text files (deck.inp, solver.log), or with `download`
 * saves it; the raw solver output (results.frd, results.dat) is always saved. Plain links, so
 * the browser streams large files itself.
 */
export function runFileUrl(runId: string, name: RunFileName, download = false): string {
  const path = `/api/runs/${encodeURIComponent(runId)}/files/${encodeURIComponent(name)}`;
  return download ? `${path}?download=1` : path;
}

/** Pins the run so its raw solver output is kept, or unpins it (M8.6, ADR-086). */
export async function pinRun(runId: string, pinned: boolean): Promise<ApiResult<RunView>> {
  const path = `/api/runs/${encodeURIComponent(runId)}/pin`;
  const result = await apiRequest("PUT", path, validateRunResponse, { pinned });
  return result.kind === "ok" ? { kind: "ok", value: result.value.run } : result;
}

/** Solves the run's frozen setup again on its mesh, as a new run (M8.6, ADR-086). */
export async function rerunRun(runId: string): Promise<ApiResult<RunView>> {
  const result = await apiRequest("POST", `/api/runs/${encodeURIComponent(runId)}/rerun`, validateRunResponse);
  return result.kind === "ok" ? { kind: "ok", value: result.value.run } : result;
}
