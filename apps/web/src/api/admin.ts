// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for /api/admin (M10.3, ADR-097). Shapes: packages/spec/schemas/admin.schema.json.

import { type AdminResponse, validateAdminResponse } from "@clearfea/spec";
import { type ApiResult, apiRequest } from "./request";

export function fetchAdmin(): Promise<ApiResult<AdminResponse>> {
  return apiRequest("GET", "/api/admin", validateAdminResponse);
}

export function addAllowed(email: string): Promise<ApiResult<AdminResponse>> {
  return apiRequest("POST", "/api/admin/allowed", validateAdminResponse, { email });
}

export function removeAllowed(email: string): Promise<ApiResult<AdminResponse>> {
  return apiRequest("DELETE", `/api/admin/allowed/${encodeURIComponent(email)}`, validateAdminResponse);
}

export function switchCloudSize(name: string, enabled: boolean): Promise<ApiResult<AdminResponse>> {
  return apiRequest("PUT", `/api/admin/machine-sizes/${encodeURIComponent(name)}`, validateAdminResponse, { enabled });
}
