// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for /api/materials (M2.9). Shapes: packages/spec/schemas/simulation.schema.json.

import {
  type IsotropicMaterial,
  type MaterialsResponse,
  validateMaterialResponse,
  validateMaterialsResponse,
} from "@clearfea/spec";
import { type ApiResult, apiRequest } from "./request";

/** The library's materials and the signed-in user's own. */
export function listMaterials(): Promise<ApiResult<MaterialsResponse>> {
  return apiRequest("GET", "/api/materials", validateMaterialsResponse);
}

/** Keeps a material among the user's own; the answer carries its new id. */
export async function saveMaterial(material: IsotropicMaterial): Promise<ApiResult<IsotropicMaterial>> {
  const result = await apiRequest("POST", "/api/materials", validateMaterialResponse, { material });
  return result.kind === "ok" ? { kind: "ok", value: result.value.material } : result;
}

export function deleteMaterial(id: string): Promise<ApiResult<undefined>> {
  return apiRequest("DELETE", `/api/materials/${encodeURIComponent(id)}`, null);
}
