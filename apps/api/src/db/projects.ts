// SPDX-License-Identifier: AGPL-3.0-or-later
// Projects and the folders that hold them (docs/ARCHITECTURE.md section 4, ADR-038, ADR-114).
// A project holds the default unit system, its geometries and their simulations. Every
// function takes the acting user's id and filters on owner_id; migration 0029's triggers also
// refuse a folder, project, geometry or simulation placed in another user's folder or project.

export interface Project {
  id: string;
  name: string;
  /** Unit system id from packages/spec/units.json, or null for the table's default. */
  unitSystem: string | null;
  /** Null for a project at the top of the home. */
  folderId: string | null;
  /** Set while the project is in the trash. */
  deletedAt: string | null;
  lastOpenedAt: string | null;
  /** When the viewer last stored the thumbnail; null for none. */
  thumbnailAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProjectRow {
  id: string;
  name: string;
  default_unit_system: string | null;
  folder_id: string | null;
  deleted_at: string | null;
  last_opened_at: string | null;
  thumbnail_at: string | null;
  created_at: string;
  updated_at: string;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    unitSystem: row.default_unit_system,
    folderId: row.folder_id,
    deletedAt: row.deleted_at,
    lastOpenedAt: row.last_opened_at,
    thumbnailAt: row.thumbnail_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface Folder {
  id: string;
  name: string;
  /** Null for a folder at the top of the home. */
  parentId: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

function toFolder(row: FolderRow): Folder {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const PROJECT_COLUMNS =
  "id, name, default_unit_system, folder_id, deleted_at, last_opened_at, thumbnail_at, created_at, updated_at";
const FOLDER_COLUMNS = "id, name, parent_id, deleted_at, created_at, updated_at";

/** The name of the project made for a user who has none. */
export const FIRST_PROJECT_NAME = "My first project";

/**
 * The user's oldest project outside the trash, created if they have none. The insert runs only
 * when no such project exists, in the same statement, so two first requests cannot make two
 * projects. Until the home page lets the user pick one (M14.3), new geometries go here.
 */
export async function userProject(db: D1Database, userId: string): Promise<Project> {
  await db
    .prepare(
      `INSERT INTO projects (id, owner_id, name)
       SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM projects WHERE owner_id = ? AND deleted_at IS NULL)`,
    )
    .bind(crypto.randomUUID(), userId, FIRST_PROJECT_NAME, userId)
    .run();
  const row = await db
    .prepare(
      `SELECT ${PROJECT_COLUMNS} FROM projects
        WHERE owner_id = ? AND deleted_at IS NULL ORDER BY created_at, id LIMIT 1`,
    )
    .bind(userId)
    .first<ProjectRow>();
  if (row === null) throw new Error("The project was not created.");
  return toProject(row);
}

/** One of the user's projects, in the trash or not; null if they own no project of that id. */
export async function getProject(db: D1Database, userId: string, projectId: string): Promise<Project | null> {
  const row = await db
    .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ? AND owner_id = ?`)
    .bind(projectId, userId)
    .first<ProjectRow>();
  return row === null ? null : toProject(row);
}

/** The user's projects outside the trash, oldest first. */
export async function listProjects(db: D1Database, userId: string): Promise<Project[]> {
  const { results } = await db
    .prepare(
      `SELECT ${PROJECT_COLUMNS} FROM projects
        WHERE owner_id = ? AND deleted_at IS NULL ORDER BY created_at, id`,
    )
    .bind(userId)
    .all<ProjectRow>();
  return results.map(toProject);
}

/**
 * Makes a project, at the top of the home or in one of the user's folders outside the trash.
 * Returns null when the folder is not such a folder.
 */
export async function createProject(
  db: D1Database,
  userId: string,
  project: { id: string; name: string; folderId: string | null },
): Promise<Project | null> {
  const result = await db
    .prepare(
      `INSERT INTO projects (id, owner_id, name, folder_id)
       SELECT ?, ?, ?, ? WHERE ? IS NULL
          OR EXISTS (SELECT 1 FROM folders WHERE id = ? AND owner_id = ? AND deleted_at IS NULL)`,
    )
    .bind(project.id, userId, project.name, project.folderId, project.folderId, project.folderId, userId)
    .run();
  if (result.meta.changes !== 1) return null;
  return getProject(db, userId, project.id);
}

/** Records that the user opened the project, for Recent. False if they own no such project. */
export async function markProjectOpened(db: D1Database, userId: string, projectId: string): Promise<boolean> {
  const result = await db
    .prepare(`UPDATE projects SET last_opened_at = ${NOW} WHERE id = ? AND owner_id = ?`)
    .bind(projectId, userId)
    .run();
  return result.meta.changes === 1;
}

/**
 * Records that the viewer stored the project's thumbnail now (M14.3). Refused for a project in
 * the trash, which changes nothing until it is restored.
 */
export async function markProjectThumbnail(
  db: D1Database,
  userId: string,
  projectId: string,
): Promise<Project | "notFound" | "inTrash"> {
  const project = await getProject(db, userId, projectId);
  if (project === null) return "notFound";
  if (project.deletedAt !== null) return "inTrash";
  await db
    .prepare(`UPDATE projects SET thumbnail_at = ${NOW} WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`)
    .bind(projectId, userId)
    .run();
  return (await getProject(db, userId, projectId)) ?? "notFound";
}

/** The R2 key of the project's thumbnail, in its own folder. */
export function projectThumbnailKey(ownerId: string, projectId: string): string {
  return `${projectFolderKey(ownerId, projectId)}thumbnail.png`;
}

/** Sets the default unit system of the user's project. The caller checks the id against units.json. */
export async function setProjectUnitSystem(db: D1Database, userId: string, unitSystem: string): Promise<Project> {
  const project = await userProject(db, userId);
  await db
    .prepare(
      `UPDATE projects SET default_unit_system = ?, updated_at = ${NOW}
        WHERE id = ? AND owner_id = ?`,
    )
    .bind(unitSystem, project.id, userId)
    .run();
  return { ...project, unitSystem };
}

/** One of the user's folders, in the trash or not; null if they own no folder of that id. */
export async function getFolder(db: D1Database, userId: string, folderId: string): Promise<Folder | null> {
  const row = await db
    .prepare(`SELECT ${FOLDER_COLUMNS} FROM folders WHERE id = ? AND owner_id = ?`)
    .bind(folderId, userId)
    .first<FolderRow>();
  return row === null ? null : toFolder(row);
}

/** The user's folders outside the trash, oldest first. */
export async function listFolders(db: D1Database, userId: string): Promise<Folder[]> {
  const { results } = await db
    .prepare(
      `SELECT ${FOLDER_COLUMNS} FROM folders
        WHERE owner_id = ? AND deleted_at IS NULL ORDER BY created_at, id`,
    )
    .bind(userId)
    .all<FolderRow>();
  return results.map(toFolder);
}

/**
 * Makes a folder, at the top of the home or inside another of the user's folders outside the
 * trash. Returns null when the parent is not such a folder.
 */
export async function createFolder(
  db: D1Database,
  userId: string,
  folder: { id: string; name: string; parentId: string | null },
): Promise<Folder | null> {
  const result = await db
    .prepare(
      `INSERT INTO folders (id, owner_id, name, parent_id)
       SELECT ?, ?, ?, ? WHERE ? IS NULL
          OR EXISTS (SELECT 1 FROM folders WHERE id = ? AND owner_id = ? AND deleted_at IS NULL)`,
    )
    .bind(folder.id, userId, folder.name, folder.parentId, folder.parentId, folder.parentId, userId)
    .run();
  if (result.meta.changes !== 1) return null;
  return getFolder(db, userId, folder.id);
}

/** Every folder and project of the user, those in the trash included, oldest first. */
export async function listHome(db: D1Database, userId: string): Promise<{ folders: Folder[]; projects: Project[] }> {
  const [folders, projects] = await db.batch([
    db.prepare(`SELECT ${FOLDER_COLUMNS} FROM folders WHERE owner_id = ? ORDER BY created_at, id`).bind(userId),
    db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE owner_id = ? ORDER BY created_at, id`).bind(userId),
  ]);
  return {
    folders: ((folders?.results ?? []) as FolderRow[]).map(toFolder),
    projects: ((projects?.results ?? []) as ProjectRow[]).map(toProject),
  };
}

/** Why a change to a project or folder was not made. */
export type Refusal = "notFound" | "inTrash" | "folderNotFound" | "cycle" | "expired";

/** True when a change was refused, so the result names why. */
export function isRefusal<T extends object, R extends string>(result: T | R): result is R {
  return typeof result === "string";
}

/** SQL true when ?<n> is null or one of the user's (?<owner>) folders outside the trash. */
function liveFolderOrTop(folder: string, owner: string): string {
  return `(${folder} IS NULL OR EXISTS (SELECT 1 FROM folders lf WHERE lf.id = ${folder} AND lf.owner_id = ${owner} AND lf.deleted_at IS NULL))`;
}

/**
 * Renames the user's project, moves it (`folderId` null for the top of the home; undefined
 * leaves it where it is) and sets its unit system, in one statement. The caller checks the unit
 * system against units.json. A project in the trash is not changed.
 */
export async function changeProject(
  db: D1Database,
  userId: string,
  projectId: string,
  change: { name?: string; folderId?: string | null; unitSystem?: string },
): Promise<Project | Refusal> {
  const move = change.folderId !== undefined;
  const result = await db
    .prepare(
      `UPDATE projects
          SET name = COALESCE(?1, name), default_unit_system = COALESCE(?2, default_unit_system),
              folder_id = CASE WHEN ?3 = 1 THEN ?4 ELSE folder_id END, updated_at = ${NOW}
        WHERE id = ?5 AND owner_id = ?6 AND deleted_at IS NULL AND (?3 = 0 OR ${liveFolderOrTop("?4", "?6")})`,
    )
    .bind(change.name ?? null, change.unitSystem ?? null, move ? 1 : 0, change.folderId ?? null, projectId, userId)
    .run();
  const project = await getProject(db, userId, projectId);
  if (result.meta.changes === 1 && project !== null) return project;
  if (project === null) return "notFound";
  return project.deletedAt !== null ? "inTrash" : "folderNotFound";
}

/**
 * Renames the user's folder and moves it (`parentId` null for the top of the home; undefined
 * leaves it where it is), in one statement. The new parent must be a folder outside the trash
 * and neither the folder itself nor one inside it. A folder in the trash is not changed.
 */
export async function changeFolder(
  db: D1Database,
  userId: string,
  folderId: string,
  change: { name?: string; parentId?: string | null },
): Promise<Folder | Refusal> {
  const move = change.parentId !== undefined;
  // The parent and the folders above it: the folder may be none of them.
  const above = `WITH RECURSIVE up(id) AS (
      SELECT ?3 UNION SELECT f.parent_id FROM folders f JOIN up ON f.id = up.id WHERE f.parent_id IS NOT NULL
    ) SELECT id FROM up`;
  const result = await db
    .prepare(
      `UPDATE folders
          SET name = COALESCE(?1, name), parent_id = CASE WHEN ?2 = 1 THEN ?3 ELSE parent_id END, updated_at = ${NOW}
        WHERE id = ?4 AND owner_id = ?5 AND deleted_at IS NULL
          AND (?2 = 0 OR ?3 IS NULL OR (${liveFolderOrTop("?3", "?5")} AND ?4 NOT IN (${above})))`,
    )
    .bind(change.name ?? null, move ? 1 : 0, change.parentId ?? null, folderId, userId)
    .run();
  const folder = await getFolder(db, userId, folderId);
  if (result.meta.changes === 1 && folder !== null) return folder;
  if (folder === null) return "notFound";
  if (folder.deletedAt !== null) return "inTrash";
  const parent = change.parentId == null ? null : await getFolder(db, userId, change.parentId);
  return parent === null || parent.deletedAt !== null ? "folderNotFound" : "cycle";
}

/** Puts the user's project in the trash. */
export async function trashProject(db: D1Database, userId: string, projectId: string): Promise<Project | Refusal> {
  await db
    .prepare(
      `UPDATE projects SET deleted_at = ?, updated_at = ${NOW} WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
    )
    .bind(new Date().toISOString(), projectId, userId)
    .run();
  return (await getProject(db, userId, projectId)) ?? "notFound";
}

/** SQL for the ids of the folder ?1 of the user ?2 and every folder inside it whose deleted_at matches `trashed`. */
function subtree(trashed: string): string {
  return `WITH RECURSIVE tree(id) AS (
      SELECT id FROM folders WHERE id = ?1 AND owner_id = ?2 AND ${trashed}
      UNION SELECT f.id FROM folders f JOIN tree ON f.parent_id = tree.id WHERE f.owner_id = ?2 AND ${trashed.replaceAll("deleted_at", "f.deleted_at")}
    ) SELECT id FROM tree`;
}

/**
 * Puts the user's folder in the trash with everything in it that is not there already, all
 * with the same time, so that restoring the folder brings back exactly what went with it.
 */
export async function trashFolder(db: D1Database, userId: string, folderId: string): Promise<Folder | Refusal> {
  const tree = subtree("deleted_at IS NULL");
  const stamp = new Date().toISOString();
  // Projects first: the folders' statement changes the tree the projects' statement reads.
  await db.batch([
    db
      .prepare(
        `UPDATE projects SET deleted_at = ?3, updated_at = ${NOW}
          WHERE owner_id = ?2 AND deleted_at IS NULL AND folder_id IN (${tree})`,
      )
      .bind(folderId, userId, stamp),
    db
      .prepare(`UPDATE folders SET deleted_at = ?3, updated_at = ${NOW} WHERE id IN (${tree})`)
      .bind(folderId, userId, stamp),
  ]);
  return (await getFolder(db, userId, folderId)) ?? "notFound";
}

/** The trash time before which an item is past the retention period and can no longer be restored. */
export function trashCutoff(now: Date, retentionDays: number): string {
  return new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
}

/**
 * Takes the user's project out of the trash. It goes back to its folder, or to the top of the
 * home when that folder is in the trash. A project past the retention period is not restored:
 * the storage sweep is about to purge it, or has started.
 */
export async function restoreProject(
  db: D1Database,
  userId: string,
  projectId: string,
  cutoff: string,
): Promise<Project | Refusal> {
  const result = await db
    .prepare(
      `UPDATE projects
          SET deleted_at = NULL, updated_at = ${NOW},
              folder_id = CASE WHEN ${liveFolderOrTop("projects.folder_id", "projects.owner_id")} THEN folder_id ELSE NULL END
        WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL AND deleted_at > ?`,
    )
    .bind(projectId, userId, cutoff)
    .run();
  const project = await getProject(db, userId, projectId);
  if (project === null) return "notFound";
  if (result.meta.changes === 0 && project.deletedAt !== null) return "expired";
  return project;
}

/**
 * Takes the user's folder out of the trash with everything that went there with it (the same
 * trash time); what was put in the trash on its own before stays there. The folder goes back
 * to its parent, or to the top of the home when that parent is in the trash.
 */
export async function restoreFolder(
  db: D1Database,
  userId: string,
  folderId: string,
  cutoff: string,
): Promise<Folder | Refusal> {
  const folder = await getFolder(db, userId, folderId);
  if (folder === null) return "notFound";
  if (folder.deletedAt === null) return folder;
  if (folder.deletedAt <= cutoff) return "expired";
  const tree = subtree("deleted_at = ?3");
  await db.batch([
    db
      .prepare(
        `UPDATE projects SET deleted_at = NULL, updated_at = ${NOW}
          WHERE owner_id = ?2 AND deleted_at = ?3 AND folder_id IN (${tree})`,
      )
      .bind(folderId, userId, folder.deletedAt),
    db
      .prepare(
        `UPDATE folders SET parent_id = NULL
          WHERE id = ?1 AND owner_id = ?2 AND deleted_at = ?3 AND NOT ${liveFolderOrTop("folders.parent_id", "folders.owner_id")}`,
      )
      .bind(folderId, userId, folder.deletedAt),
    db
      .prepare(`UPDATE folders SET deleted_at = NULL, updated_at = ${NOW} WHERE id IN (${tree})`)
      .bind(folderId, userId, folder.deletedAt),
  ]);
  return (await getFolder(db, userId, folderId)) ?? "notFound";
}

/** Where the viewer stores the project's thumbnail (M14.3); the folder holds nothing else. */
export function projectFolderKey(ownerId: string, projectId: string): string {
  return `owners/${ownerId}/projects/${projectId}/`;
}
