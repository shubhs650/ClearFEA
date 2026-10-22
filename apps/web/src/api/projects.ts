// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for /api/projects and /api/folders (M14.2, M14.3, ADR-124): the home with every folder
// and project, and the changes made from it. Shapes: packages/spec/schemas/project.schema.json.

import {
  type FolderView,
  type HomeResponse,
  type ProjectView,
  validateFolderResponse,
  validateHomeResponse,
  validateProjectResponse,
} from "@clearfea/spec";
import { type ApiResult, apiRequest, apiUpload } from "./request";

const projectPath = (id: string) => `/api/projects/${encodeURIComponent(id)}`;
const folderPath = (id: string) => `/api/folders/${encodeURIComponent(id)}`;

function project(result: ApiResult<{ project: ProjectView }>): ApiResult<ProjectView> {
  return result.kind === "ok" ? { kind: "ok", value: result.value.project } : result;
}

function folder(result: ApiResult<{ folder: FolderView }>): ApiResult<FolderView> {
  return result.kind === "ok" ? { kind: "ok", value: result.value.folder } : result;
}

/** Every folder and project of the signed-in user, those in the trash included. */
export function fetchHome(): Promise<ApiResult<HomeResponse>> {
  return apiRequest("GET", "/api/projects", validateHomeResponse);
}

export async function fetchProject(id: string): Promise<ApiResult<ProjectView>> {
  return project(await apiRequest("GET", projectPath(id), validateProjectResponse));
}

export async function createProject(name: string, folderId: string | null): Promise<ApiResult<ProjectView>> {
  return project(await apiRequest("POST", "/api/projects", validateProjectResponse, { name, folderId }));
}

/** Renames or moves a project (folderId null for the top of the home), or sets its unit system. */
export async function changeProject(
  id: string,
  change: { name?: string; folderId?: string | null; unitSystem?: string },
): Promise<ApiResult<ProjectView>> {
  return project(await apiRequest("PATCH", projectPath(id), validateProjectResponse, change));
}

/** Records that the user opened the project, for Recent. */
export async function markProjectOpened(id: string): Promise<ApiResult<ProjectView>> {
  return project(await apiRequest("POST", `${projectPath(id)}/opened`, validateProjectResponse));
}

export async function projectAction(id: string, action: "duplicate" | "trash" | "restore"): Promise<ApiResult<ProjectView>> {
  return project(await apiRequest("POST", `${projectPath(id)}/${action}`, validateProjectResponse, action === "duplicate" ? {} : undefined));
}

export async function createFolder(name: string, parentId: string | null): Promise<ApiResult<FolderView>> {
  return folder(await apiRequest("POST", "/api/folders", validateFolderResponse, { name, parentId }));
}

/** Renames or moves a folder (parentId null for the top of the home). */
export async function changeFolder(
  id: string,
  change: { name?: string; parentId?: string | null },
): Promise<ApiResult<FolderView>> {
  return folder(await apiRequest("PATCH", folderPath(id), validateFolderResponse, change));
}

export async function folderAction(id: string, action: "duplicate" | "trash" | "restore"): Promise<ApiResult<FolderView>> {
  return folder(await apiRequest("POST", `${folderPath(id)}/${action}`, validateFolderResponse, action === "duplicate" ? {} : undefined));
}

/** Stores the project's thumbnail, a PNG drawn with the viewer. */
export async function uploadThumbnail(id: string, image: Blob): Promise<ApiResult<ProjectView>> {
  return project(await apiUpload(`${projectPath(id)}/thumbnail`, validateProjectResponse, image, "PUT"));
}

/** The address of the project's thumbnail, new each time the viewer stores one; null for none. */
export function thumbnailUrl(view: ProjectView): string | null {
  return view.thumbnailAt === null ? null : `${projectPath(view.id)}/thumbnail?at=${encodeURIComponent(view.thumbnailAt)}`;
}
