// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for /api/project. Shapes: packages/spec/schemas/project.schema.json.

import { type ProjectView, validateProjectResponse } from "@clearfea/spec";
import { type ApiResult, apiRequest } from "./request";

/** The signed-in user's project, made on first use. */
export async function fetchProject(): Promise<ApiResult<ProjectView>> {
  const result = await apiRequest("GET", "/api/project", validateProjectResponse);
  return result.kind === "ok" ? { kind: "ok", value: result.value.project } : result;
}

/** Sets the project's unit system. */
export async function setProjectUnitSystem(unitSystem: string): Promise<ApiResult<ProjectView>> {
  const result = await apiRequest("PATCH", "/api/project", validateProjectResponse, { unitSystem });
  return result.kind === "ok" ? { kind: "ok", value: result.value.project } : result;
}
