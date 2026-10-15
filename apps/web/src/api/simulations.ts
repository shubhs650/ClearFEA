// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for /api/simulations. Shapes: packages/spec/schemas/simulation.schema.json.

import {
  type SimulationSpec,
  type SimulationView,
  validateSimulationListResponse,
  validateSimulationResponse,
} from "@clearfea/spec";
import { type ApiResult, apiRequest } from "./request";

/** The signed-in user's simulations of a geometry, newest first. */
export async function listSimulations(geometryId: string): Promise<ApiResult<SimulationView[]>> {
  const path = `/api/simulations?geometryId=${encodeURIComponent(geometryId)}`;
  const result = await apiRequest("GET", path, validateSimulationListResponse);
  return result.kind === "ok" ? { kind: "ok", value: result.value.simulations } : result;
}

/** Creates a simulation with an empty spec. From then on the geometry's unit is locked. */
export async function createSimulation(geometryId: string, name: string): Promise<ApiResult<SimulationView>> {
  const result = await apiRequest("POST", "/api/simulations", validateSimulationResponse, { geometryId, name });
  return result.kind === "ok" ? { kind: "ok", value: result.value.simulation } : result;
}

/** Replaces the simulation's whole spec. */
export async function saveSimulationSpec(id: string, spec: SimulationSpec): Promise<ApiResult<SimulationView>> {
  const path = `/api/simulations/${encodeURIComponent(id)}/spec`;
  const result = await apiRequest("PUT", path, validateSimulationResponse, spec);
  return result.kind === "ok" ? { kind: "ok", value: result.value.simulation } : result;
}
