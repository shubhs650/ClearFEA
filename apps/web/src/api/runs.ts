// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for a simulation's runs and /api/runs (M1.8). Shapes: simulation.schema.json.

import {
  type RunLogResponse,
  type RunView,
  validateRunListResponse,
  validateRunLogResponse,
  validateRunResponse,
} from "@clearfea/spec";
import { type ApiResult, apiRequest } from "./request";

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
