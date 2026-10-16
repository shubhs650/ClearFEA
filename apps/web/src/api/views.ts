// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for /api/simulations/:id/views (M3.6, ADR-055). Shapes: packages/spec/schemas/view.schema.json.

import { type SavedView, type ViewSettings, validateViewListResponse, validateViewResponse } from "@clearfea/spec";
import { type ApiResult, apiRequest } from "./request";

const path = (simulationId: string) => `/api/simulations/${encodeURIComponent(simulationId)}/views`;

/** The simulation's saved views, by name. */
export async function listViews(simulationId: string): Promise<ApiResult<SavedView[]>> {
  const result = await apiRequest("GET", path(simulationId), validateViewListResponse);
  return result.kind === "ok" ? { kind: "ok", value: result.value.views } : result;
}

/** Saves a view under a name, replacing the simulation's view of that name. */
export async function saveView(simulationId: string, name: string, settings: ViewSettings): Promise<ApiResult<SavedView>> {
  const result = await apiRequest("POST", path(simulationId), validateViewResponse, { name, settings });
  return result.kind === "ok" ? { kind: "ok", value: result.value.view } : result;
}

export function deleteView(simulationId: string, id: string): Promise<ApiResult<undefined>> {
  return apiRequest("DELETE", `${path(simulationId)}/${encodeURIComponent(id)}`, null);
}
