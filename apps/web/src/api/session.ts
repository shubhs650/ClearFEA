// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for /api/session (ADR-022). Shapes: packages/spec/schemas/session.schema.json.

import { type SessionUser, validateSessionResponse } from "@clearfea/spec";
import { type ApiResult, apiRequest } from "./request";

export async function fetchSession(): Promise<ApiResult<SessionUser>> {
  const result = await apiRequest("GET", "/api/session", validateSessionResponse);
  return result.kind === "ok" ? { kind: "ok", value: result.value.user } : result;
}

export async function signIn(login: string, password: string): Promise<ApiResult<SessionUser>> {
  const result = await apiRequest("POST", "/api/session", validateSessionResponse, {
    login,
    password,
  });
  return result.kind === "ok" ? { kind: "ok", value: result.value.user } : result;
}

export function signOut(): Promise<ApiResult<undefined>> {
  return apiRequest<undefined>("DELETE", "/api/session", null);
}
