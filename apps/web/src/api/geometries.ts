// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for /api/geometries. Shapes: packages/spec/schemas/geometry.schema.json.

import {
  type GeometryView,
  type Topology,
  validateGeometryListResponse,
  validateGeometryResponse,
  validateTopology,
} from "@clearfea/spec";
import { type ApiResult, apiBinary, apiRequest, apiUpload } from "./request";

export async function listGeometries(): Promise<ApiResult<GeometryView[]>> {
  const result = await apiRequest("GET", "/api/geometries", validateGeometryListResponse);
  return result.kind === "ok" ? { kind: "ok", value: result.value.geometries } : result;
}

export async function getGeometry(id: string): Promise<ApiResult<GeometryView>> {
  const path = `/api/geometries/${encodeURIComponent(id)}`;
  const result = await apiRequest("GET", path, validateGeometryResponse);
  return result.kind === "ok" ? { kind: "ok", value: result.value.geometry } : result;
}

export async function uploadGeometry(file: File): Promise<ApiResult<GeometryView>> {
  const path = `/api/geometries?name=${encodeURIComponent(file.name)}`;
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
