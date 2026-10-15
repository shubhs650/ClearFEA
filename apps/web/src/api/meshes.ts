// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for a simulation's mesh and /api/meshes (M1.6). Shapes: simulation.schema.json.

import { type MeshView, validateMeshResponse, validateSimulationMeshResponse } from "@clearfea/spec";
import { type ApiResult, apiBinary, apiRequest } from "./request";

/** The simulation's latest mesh, or null before one was requested. */
export async function getSimulationMesh(simulationId: string): Promise<ApiResult<MeshView | null>> {
  const path = `/api/simulations/${encodeURIComponent(simulationId)}/mesh`;
  const result = await apiRequest("GET", path, validateSimulationMeshResponse);
  return result.kind === "ok" ? { kind: "ok", value: result.value.mesh } : result;
}

/**
 * Meshes the simulation's geometry with the mesh settings of its saved spec. reused is true when
 * a mesh with the same settings already existed and became the simulation's mesh (M2.10).
 */
export async function requestMesh(simulationId: string): Promise<ApiResult<{ mesh: MeshView; reused: boolean }>> {
  const path = `/api/simulations/${encodeURIComponent(simulationId)}/mesh`;
  const result = await apiRequest("POST", path, validateMeshResponse);
  return result.kind === "ok" ? { kind: "ok", value: { mesh: result.value.mesh, reused: result.value.reused === true } } : result;
}

/** The mesh's surface in the display mesh format (packages/spec/display-mesh.md), unparsed. */
export function fetchMeshDisplay(meshId: string): Promise<ApiResult<ArrayBuffer>> {
  return apiBinary(`/api/meshes/${encodeURIComponent(meshId)}/display`);
}
