// SPDX-License-Identifier: AGPL-3.0-or-later
// Generated from packages/spec/schemas/project.schema.json by packages/spec/scripts/generate.mjs.
// Do not edit by hand; change the schema and run `make spec`.

import schema from "../../schemas/project.schema.json";
import { validator } from "../validate";

/**
 * A project or folder name. Spaces at either end are removed; an empty name is refused.
 *
 * This interface was referenced by `Project`'s JSON-Schema
 * via the `definition` "Name".
 */
export type Name = string;

/**
 * Wire shapes of the project and folder routes (docs/ARCHITECTURE.md section 4, ADR-038, ADR-114, ADR-124). Each user has projects, at the top of their home or in folders; a deleted project or folder goes to the trash and is purged after the trash retention period. Times are ISO 8601 UTC. Each message is a definition under $defs.
 */
export interface Project {
  [k: string]: unknown;
}
/**
 * This interface was referenced by `Project`'s JSON-Schema
 * via the `definition` "ProjectView".
 */
export interface ProjectView {
  id: string;
  name: string;
  /**
   * Id of a unit system in packages/spec/units.json: the unit every quantity field offers first and the unit results are shown in.
   */
  unitSystem: string;
  /**
   * The folder holding the project; null at the top of the home.
   */
  folderId: string | null;
  /**
   * When the project went to the trash; null outside it.
   */
  deletedAt: string | null;
  lastOpenedAt: string | null;
  /**
   * When the viewer last stored the project's thumbnail; null for none.
   */
  thumbnailAt: string | null;
  createdAt: string;
  updatedAt: string;
}
/**
 * This interface was referenced by `Project`'s JSON-Schema
 * via the `definition` "FolderView".
 */
export interface FolderView {
  id: string;
  name: string;
  /**
   * The folder holding this one; null at the top of the home.
   */
  parentId: string | null;
  /**
   * When the folder went to the trash; null outside it.
   */
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
/**
 * Answer to GET and PATCH /api/project, and to the routes under /api/projects that act on one project.
 *
 * This interface was referenced by `Project`'s JSON-Schema
 * via the `definition` "ProjectResponse".
 */
export interface ProjectResponse {
  project: ProjectView;
}
/**
 * Answer to the routes under /api/folders that act on one folder.
 *
 * This interface was referenced by `Project`'s JSON-Schema
 * via the `definition` "FolderResponse".
 */
export interface FolderResponse {
  folder: FolderView;
}
/**
 * Answer to GET /api/projects: every folder and project of the user, those in the trash included (deletedAt set). An item in the trash is shown at the top of the trash when its folder is outside the trash or went there at a different time; the rest went with that folder and come back with it. Each is purged trashRetentionDays after its deletedAt.
 *
 * This interface was referenced by `Project`'s JSON-Schema
 * via the `definition` "HomeResponse".
 */
export interface HomeResponse {
  folders: FolderView[];
  projects: ProjectView[];
  trashRetentionDays: number;
}
/**
 * Body of PATCH /api/project. The unit system must be one units.json lists.
 *
 * This interface was referenced by `Project`'s JSON-Schema
 * via the `definition` "ProjectUpdate".
 */
export interface ProjectUpdate {
  unitSystem: string;
}
/**
 * Body of POST /api/projects: a new, empty project, at the top of the home (folderId null or left out) or in a folder outside the trash.
 *
 * This interface was referenced by `Project`'s JSON-Schema
 * via the `definition` "ProjectCreate".
 */
export interface ProjectCreate {
  name: Name;
  folderId?: string | null;
}
/**
 * Body of PATCH /api/projects/{id}: rename it, move it (folderId null for the top of the home), or set its unit system. At least one; a project in the trash is restored first.
 *
 * This interface was referenced by `Project`'s JSON-Schema
 * via the `definition` "ProjectChange".
 */
export interface ProjectChange {
  name?: Name;
  folderId?: string | null;
  unitSystem?: string;
}
/**
 * Body of POST /api/folders: a new folder at the top of the home (parentId null or left out) or inside a folder outside the trash.
 *
 * This interface was referenced by `Project`'s JSON-Schema
 * via the `definition` "FolderCreate".
 */
export interface FolderCreate {
  name: Name;
  parentId?: string | null;
}
/**
 * Body of PATCH /api/folders/{id}: rename it or move it (parentId null for the top of the home, never into itself or a folder inside it). At least one; a folder in the trash is restored first.
 *
 * This interface was referenced by `Project`'s JSON-Schema
 * via the `definition` "FolderChange".
 */
export interface FolderChange {
  name?: Name;
  parentId?: string | null;
}
/**
 * Body of POST /api/projects/{id}/duplicate and POST /api/folders/{id}/duplicate, which may be empty: the copy's name (default: the original's with " (copy)") and where it goes (default: beside the original). The copy holds the geometries and simulation setups, not meshes, runs or reports.
 *
 * This interface was referenced by `Project`'s JSON-Schema
 * via the `definition` "DuplicateRequest".
 */
export interface DuplicateRequest {
  name?: Name;
  folderId?: string | null;
}

export const validateName = validator<Name>(schema, "Name");
export const validateProjectView = validator<ProjectView>(schema, "ProjectView");
export const validateFolderView = validator<FolderView>(schema, "FolderView");
export const validateProjectResponse = validator<ProjectResponse>(schema, "ProjectResponse");
export const validateFolderResponse = validator<FolderResponse>(schema, "FolderResponse");
export const validateHomeResponse = validator<HomeResponse>(schema, "HomeResponse");
export const validateProjectUpdate = validator<ProjectUpdate>(schema, "ProjectUpdate");
export const validateProjectCreate = validator<ProjectCreate>(schema, "ProjectCreate");
export const validateProjectChange = validator<ProjectChange>(schema, "ProjectChange");
export const validateFolderCreate = validator<FolderCreate>(schema, "FolderCreate");
export const validateFolderChange = validator<FolderChange>(schema, "FolderChange");
export const validateDuplicateRequest = validator<DuplicateRequest>(schema, "DuplicateRequest");
