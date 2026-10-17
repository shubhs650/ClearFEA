// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for a run's read-only share link (M8.7, ADR-083): the owner's /api/runs/:id/share, and
// /api/shared/:token, which the link's page reads without signing in. Shapes:
// simulation.schema.json.

import {
  type CreatedShareLinkResponse,
  type ShareLinkView,
  type SharedRunResponse,
  type Topology,
  validateCreatedShareLinkResponse,
  validateShareLinkResponse,
  validateSharedRunResponse,
  validateTopology,
} from "@clearfea/spec";
import type { ViewerSource } from "../layout/Viewer";
import { type ApiResult, apiBinary, apiRequest } from "./request";

const sharePath = (runId: string) => `/api/runs/${encodeURIComponent(runId)}/share`;

/** The run's active link, or null when it has none. */
export async function getShareLink(runId: string): Promise<ApiResult<ShareLinkView | null>> {
  const result = await apiRequest("GET", sharePath(runId), validateShareLinkResponse);
  return result.kind === "ok" ? { kind: "ok", value: result.value.share } : result;
}

/** Makes a new link to the run, which stops its earlier one; the token comes back only now. */
export function makeShareLink(runId: string): Promise<ApiResult<CreatedShareLinkResponse>> {
  return apiRequest("POST", sharePath(runId), validateCreatedShareLinkResponse);
}

/** Revokes the run's link. */
export async function revokeShareLink(runId: string): Promise<ApiResult<null>> {
  const result = await apiRequest("DELETE", sharePath(runId), validateShareLinkResponse);
  return result.kind === "ok" ? { kind: "ok", value: null } : result;
}

/** The page a token opens. */
export function shareUrl(token: string): string {
  return `${window.location.origin}/share/${token}`;
}

/** The token of a shared run's page (/share/<token>), or null for any other page. */
export function shareTokenOf(pathname: string): string | null {
  const match = /^\/share\/([^/]+)\/?$/.exec(pathname);
  return match?.[1] ?? null;
}

const sharedPath = (token: string, file = "") => `/api/shared/${encodeURIComponent(token)}${file}`;

/** The shared run, its simulation's name and the owner's unit system. */
export function getSharedRun(token: string): Promise<ApiResult<SharedRunResponse>> {
  return apiRequest("GET", sharedPath(token), validateSharedRunResponse);
}

/** Where the viewer reads a shared run's topology and files: through the link alone. */
export function sharedSource(token: string): ViewerSource {
  return {
    topology: (): Promise<ApiResult<Topology>> => apiRequest("GET", sharedPath(token, "/topology"), validateTopology),
    runSurface: () => apiBinary(sharedPath(token, "/surface")),
    runFields: () => apiBinary(sharedPath(token, "/fields")),
    runMesh: () => apiBinary(sharedPath(token, "/mesh")),
    runNodeField: (_runId, field) => apiBinary(sharedPath(token, `/nodes?field=${encodeURIComponent(field)}`)),
  };
}
