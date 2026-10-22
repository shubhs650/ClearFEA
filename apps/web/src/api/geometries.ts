// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for /api/geometries. Shapes: packages/spec/schemas/geometry.schema.json.

import {
  type GeometryView,
  type Topology,
  validateGeometryListResponse,
  validateGeometryResponse,
  validateTopology,
} from "@clearfea/spec";
import { type Followed, readWait } from "./jobs";
import { type ApiResult, apiBinary, apiRequest, apiUpload } from "./request";

/** The user's geometries, newest first; with a project id, those of that project only (M14.3). */
export async function listGeometries(projectId?: string): Promise<ApiResult<GeometryView[]>> {
  const path = projectId === undefined ? "/api/geometries" : `/api/geometries?projectId=${encodeURIComponent(projectId)}`;
  const result = await apiRequest("GET", path, validateGeometryListResponse);
  return result.kind === "ok" ? { kind: "ok", value: result.value.geometries } : result;
}

export async function getGeometry(id: string): Promise<ApiResult<GeometryView>> {
  const path = `/api/geometries/${encodeURIComponent(id)}`;
  const result = await apiRequest("GET", path, validateGeometryResponse);
  return result.kind === "ok" ? { kind: "ok", value: result.value.geometry } : result;
}

/** The geometry and, while it imports, how its import job is getting on (M11.2). */
export async function followGeometry(id: string): Promise<ApiResult<Followed<GeometryView>>> {
  const path = `/api/geometries/${encodeURIComponent(id)}`;
  const result = await apiRequest("GET", path, validateGeometryResponse);
  return result.kind === "ok" ? { kind: "ok", value: { value: result.value.geometry, wait: readWait(result.value.wait) } } : result;
}

/** Uploads a STEP file into the project, or without one into the user's oldest project. */
export async function uploadGeometry(file: File, projectId?: string): Promise<ApiResult<GeometryView>> {
  const into = projectId === undefined ? "" : `&projectId=${encodeURIComponent(projectId)}`;
  const path = `/api/geometries?name=${encodeURIComponent(file.name)}${into}`;
  const result = await apiUpload(path, validateGeometryResponse, file);
  return result.kind === "ok" ? { kind: "ok", value: result.value.geometry } : result;
}

export async function confirmUnit(id: string, unit: string): Promise<ApiResult<GeometryView>> {
  const path = `/api/geometries/${encodeURIComponent(id)}/unit`;
  const result = await apiRequest("POST", path, validateGeometryResponse, { unit });
  return result.kind === "ok" ? { kind: "ok", value: result.value.geometry } : result;
}

/** The display mesh file (packages/spec/display-mesh.md), unparsed. */
export function fetchDisplayMesh(id: string): Promise<ApiResult<ArrayBuffer>> {
  return apiBinary(`/api/geometries/${encodeURIComponent(id)}/display`);
}

export function fetchTopology(id: string): Promise<ApiResult<Topology>> {
  return apiRequest("GET", `/api/geometries/${encodeURIComponent(id)}/topology`, validateTopology);
}
