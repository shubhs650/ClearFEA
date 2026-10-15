// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for a simulation's runs and /api/runs (M1.8), a run's result files (M1.9) and its
// solver input and log (M1.10). Shapes: simulation.schema.json.

import {
  type RunFileName,
  type RunLogResponse,
  type RunView,
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

/** Solves the simulation's saved setup on its current mesh. */
export async function startRun(simulationId: string): Promise<ApiResult<RunView>> {
  const path = `/api/simulations/${encodeURIComponent(simulationId)}/runs`;
  const result = await apiRequest("POST", path, validateRunResponse);
  return result.kind === "ok" ? { kind: "ok", value: result.value.run } : result;
}

export async function getRun(runId: string): Promise<ApiResult<RunView>> {
  const result = await apiRequest("GET", `/api/runs/${encodeURIComponent(runId)}`, validateRunResponse);
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

/**
 * Where the browser shows one of a run's text files (deck.inp, solver.log), or with `download`
 * saves it. Plain links, so the browser streams large files itself.
 */
export function runFileUrl(runId: string, name: RunFileName, download = false): string {
  const path = `/api/runs/${encodeURIComponent(runId)}/files/${encodeURIComponent(name)}`;
  return download ? `${path}?download=1` : path;
}
