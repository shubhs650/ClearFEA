// SPDX-License-Identifier: AGPL-3.0-or-later
// Duplicating a project or a folder (M14.2, ADR-124). The copy holds the setup: each geometry
// with its files (STEP file, topology, display mesh) and each simulation with its spec, saved
// views and report options. Meshes, runs and reports are not copied, since a run is a frozen
// record of what was solved; the copy is meshed and run again. Every function takes the acting
// user's id and reads only that user's rows.

import { deletePrefix } from "./trash";
import { getFolder, getProject, type Folder, type Project, type Refusal } from "./projects";

/** Geometries one duplicate may copy, which bounds the R2 calls of one request. */
export const MAX_DUPLICATED_GEOMETRIES = 50;

/** Why a duplicate was not made, beyond the refusals of a change. */
export type DuplicateRefusal = Refusal | "busy" | "tooLarge";

/** The name a copy gets when the user gives none. */
export function copyName(name: string): string {
  return `${name.slice(0, 113)} (copy)`;
}

/** Everything one duplicate writes: R2 folders to copy, then rows in one batch. */
interface Plan {
  copies: Array<{ from: string; to: string }>;
  statements: D1PreparedStatement[];
  geometries: number;
}

const GEOMETRY_COLUMNS =
  "name, size_bytes, status, problem, declared_unit, detected_unit, unit_problem, reading_factor, confirmed_unit, scaling, body_count, face_count, size, bbox";

/** Adds the copy of one of the user's projects to the plan; "busy" while one of its geometries imports. */
async function planProject(
  db: D1Database,
  userId: string,
  sourceId: string,
  copy: { id: string; name: string; folderId: string | null },
  plan: Plan,
): Promise<"busy" | null> {
  const owner = `owners/${userId}`;
  const [geometries, simulations, views, options] = await db.batch([
    db
      .prepare("SELECT id, status FROM geometries WHERE project_id = ? AND owner_id = ? ORDER BY created_at, id")
      .bind(sourceId, userId),
    db
      .prepare(
        "SELECT id, geometry_id, spec FROM simulations WHERE project_id = ? AND owner_id = ? ORDER BY created_at, id",
      )
      .bind(sourceId, userId),
    db
      .prepare(
        `SELECT v.id, v.simulation_id FROM views v JOIN simulations s ON s.id = v.simulation_id
          WHERE s.project_id = ? AND v.owner_id = ? ORDER BY v.created_at, v.id`,
      )
      .bind(sourceId, userId),
    db
      .prepare(
        `SELECT o.simulation_id, o.options FROM report_options o JOIN simulations s ON s.id = o.simulation_id
          WHERE s.project_id = ? AND o.owner_id = ?`,
      )
      .bind(sourceId, userId),
  ]);
  const geometryRows = (geometries?.results ?? []) as Array<{ id: string; status: string }>;
  if (geometryRows.some((g) => g.status === "importing")) return "busy";
  plan.geometries += geometryRows.length;
  plan.statements.push(
    db
      .prepare(
        `INSERT INTO projects (id, owner_id, name, default_unit_system, folder_id, thumbnail_at)
         SELECT ?, owner_id, ?, default_unit_system, ?, thumbnail_at FROM projects WHERE id = ? AND owner_id = ?`,
      )
      .bind(copy.id, copy.name, copy.folderId, sourceId, userId),
  );
  plan.copies.push({ from: `${owner}/projects/${sourceId}/`, to: `${owner}/projects/${copy.id}/` });
  const geometryIds = new Map<string, string>();
  for (const geometry of geometryRows) {
    const id = crypto.randomUUID();
    geometryIds.set(geometry.id, id);
    plan.copies.push({ from: `${owner}/geometries/${geometry.id}/`, to: `${owner}/geometries/${id}/` });
    plan.statements.push(
      db
        .prepare(
          `INSERT INTO geometries (id, owner_id, project_id, ${GEOMETRY_COLUMNS})
           SELECT ?, owner_id, ?, ${GEOMETRY_COLUMNS} FROM geometries WHERE id = ? AND owner_id = ?`,
        )
        .bind(id, copy.id, geometry.id, userId),
    );
  }
  const simulationIds = new Map<string, string>();
  for (const simulation of (simulations?.results ?? []) as Array<{ id: string; geometry_id: string; spec: string }>) {
    const id = crypto.randomUUID();
    const geometryId = geometryIds.get(simulation.geometry_id);
    if (geometryId === undefined) throw new Error(`Simulation ${simulation.id} is outside its geometry's project.`);
    simulationIds.set(simulation.id, id);
    // The spec names its geometry, whose face and body tags the copy keeps.
    const spec = { ...(JSON.parse(simulation.spec) as Record<string, unknown>), geometryId };
    plan.statements.push(
      db
        .prepare(
          `INSERT INTO simulations (id, owner_id, project_id, geometry_id, name, analysis_type, spec_version, spec)
           SELECT ?, owner_id, ?, ?, name, analysis_type, spec_version, ? FROM simulations WHERE id = ? AND owner_id = ?`,
        )
        .bind(id, copy.id, geometryId, JSON.stringify(spec), simulation.id, userId),
    );
  }
  const viewIds = new Map<string, string>();
  for (const view of (views?.results ?? []) as Array<{ id: string; simulation_id: string }>) {
    const id = crypto.randomUUID();
    viewIds.set(view.id, id);
    plan.statements.push(
      db
        .prepare(
          `INSERT INTO views (id, owner_id, simulation_id, name, settings)
           SELECT ?, owner_id, ?, name, settings FROM views WHERE id = ? AND owner_id = ?`,
        )
        .bind(id, simulationIds.get(view.simulation_id), view.id, userId),
    );
  }
  for (const saved of (options?.results ?? []) as Array<{ simulation_id: string; options: string }>) {
    const parsed = JSON.parse(saved.options) as { views?: string[] };
    const mapped = { ...parsed, views: (parsed.views ?? []).flatMap((id) => viewIds.get(id) ?? []) };
    plan.statements.push(
      db
        .prepare("INSERT INTO report_options (simulation_id, owner_id, options) VALUES (?, ?, ?)")
        .bind(simulationIds.get(saved.simulation_id), userId, JSON.stringify(mapped)),
    );
  }
  return null;
}

/** Copies every R2 object under one prefix to another. */
async function copyPrefix(files: R2Bucket, from: string, to: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await files.list({ prefix: from, cursor, limit: 1000 });
    for (const listed of page.objects) {
      const object = await files.get(listed.key);
      if (object === null) continue;
      await files.put(`${to}${listed.key.slice(from.length)}`, object.body, {
        httpMetadata: object.httpMetadata,
        customMetadata: object.customMetadata,
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
}

/** Copies the files, then writes the rows in one batch; on a failure removes the copied files. */
async function carryOut(db: D1Database, files: R2Bucket, plan: Plan): Promise<void> {
  try {
    for (const { from, to } of plan.copies) await copyPrefix(files, from, to);
    await db.batch(plan.statements);
  } catch (error) {
    for (const { to } of plan.copies) await deletePrefix(files, to);
    throw error;
  }
}

/** Where a copy goes: the given folder, else the original's; it must be a folder outside the trash. */
async function targetFolder(
  db: D1Database,
  userId: string,
  given: string | null | undefined,
  original: string | null,
): Promise<string | null | "folderNotFound"> {
  const folderId = given === undefined ? original : given;
  if (folderId === null) return null;
  const folder = await getFolder(db, userId, folderId);
  return folder === null || folder.deletedAt !== null ? "folderNotFound" : folderId;
}

/** Duplicates one of the user's projects outside the trash. */
export async function duplicateProject(
  db: D1Database,
  files: R2Bucket,
  userId: string,
  projectId: string,
  options: { name?: string; folderId?: string | null },
): Promise<Project | DuplicateRefusal> {
  const source = await getProject(db, userId, projectId);
  if (source === null) return "notFound";
  if (source.deletedAt !== null) return "inTrash";
  const folderId = await targetFolder(db, userId, options.folderId, source.folderId);
  if (folderId === "folderNotFound") return folderId;
  const plan: Plan = { copies: [], statements: [], geometries: 0 };
  const id = crypto.randomUUID();
  const busy = await planProject(db, userId, source.id, { id, name: options.name ?? copyName(source.name), folderId }, plan);
  if (busy !== null) return busy;
  if (plan.geometries > MAX_DUPLICATED_GEOMETRIES) return "tooLarge";
  await carryOut(db, files, plan);
  return (await getProject(db, userId, id)) ?? "notFound";
}

/** Duplicates one of the user's folders outside the trash, with its folders and projects outside the trash. */
export async function duplicateFolder(
  db: D1Database,
  files: R2Bucket,
  userId: string,
  folderId: string,
  options: { name?: string; folderId?: string | null },
): Promise<Folder | DuplicateRefusal> {
  const source = await getFolder(db, userId, folderId);
  if (source === null) return "notFound";
  if (source.deletedAt !== null) return "inTrash";
  const parentId = await targetFolder(db, userId, options.folderId, source.parentId);
  if (parentId === "folderNotFound") return parentId;
  const { results: tree } = await db
    .prepare(
      `WITH RECURSIVE tree(id, depth) AS (
         SELECT id, 0 FROM folders WHERE id = ?1 AND owner_id = ?2 AND deleted_at IS NULL
         UNION ALL SELECT f.id, tree.depth + 1 FROM folders f JOIN tree ON f.parent_id = tree.id
          WHERE f.owner_id = ?2 AND f.deleted_at IS NULL
       ) SELECT folders.id, folders.parent_id, folders.name FROM tree JOIN folders ON folders.id = tree.id
          ORDER BY tree.depth, folders.created_at, folders.id`,
    )
    .bind(source.id, userId)
    .all<{ id: string; parent_id: string | null; name: string }>();
  const plan: Plan = { copies: [], statements: [], geometries: 0 };
  const folderIds = new Map<string, string>();
  for (const folder of tree) {
    const id = crypto.randomUUID();
    const root = folder.id === source.id;
    folderIds.set(folder.id, id);
    plan.statements.push(
      db
        .prepare("INSERT INTO folders (id, owner_id, parent_id, name) VALUES (?, ?, ?, ?)")
        .bind(
          id,
          userId,
          root ? parentId : (folderIds.get(folder.parent_id ?? "") ?? null),
          root ? (options.name ?? copyName(folder.name)) : folder.name,
        ),
    );
  }
  const { results: projects } = await db
    .prepare(
      `SELECT id, name, folder_id FROM projects
        WHERE owner_id = ? AND deleted_at IS NULL AND folder_id IN (SELECT value FROM json_each(?))
        ORDER BY created_at, id`,
    )
    .bind(userId, JSON.stringify([...folderIds.keys()]))
    .all<{ id: string; name: string; folder_id: string }>();
  for (const project of projects) {
    const copy = { id: crypto.randomUUID(), name: project.name, folderId: folderIds.get(project.folder_id) ?? null };
    if ((await planProject(db, userId, project.id, copy, plan)) !== null) return "busy";
  }
  if (plan.geometries > MAX_DUPLICATED_GEOMETRIES) return "tooLarge";
  await carryOut(db, files, plan);
  return (await getFolder(db, userId, folderIds.get(source.id) ?? "")) ?? "notFound";
}
