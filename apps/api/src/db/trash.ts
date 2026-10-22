// SPDX-License-Identifier: AGPL-3.0-or-later
// Purging the trash (M14.2, ADR-114, ADR-124): projects and folders in the trash past the
// retention period are removed for good, with their geometries, simulations, meshes and runs and
// every file of theirs in R2. Called only from the storage sweep, the one caller that goes over
// every user. Jobs and ledger entries stay: they are the record of what was charged.

import { projectFolderKey, trashCutoff } from "./projects";
import { trashRetentionDays } from "./settings";

/** Deletes every R2 object under the prefix, a page of at most 1,000 at a time. */
export async function deletePrefix(files: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await files.list({ prefix, cursor, limit: 1000 });
    if (page.objects.length > 0) await files.delete(page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
}

export interface PurgeSummary {
  projects: number;
  folders: number;
}

/** True for a job that has not ended yet. */
const ACTIVE = "status IN ('queued', 'claimed', 'running')";

/**
 * Purges one project of its owner: the files first, then the rows, children before what they
 * point at (runs, simulations, meshes, geometries, the project). A project whose job has not
 * ended yet is left for the next sweep, so no worker writes into a removed record. The rows
 * are removed only while the project is still in the trash past the cutoff.
 */
async function purgeProject(
  db: D1Database,
  files: R2Bucket,
  ownerId: string,
  projectId: string,
  cutoff: string,
): Promise<boolean> {
  const [geometries, meshes, runs] = await db.batch<{ id: string }>([
    db.prepare("SELECT id FROM geometries WHERE project_id = ? AND owner_id = ?").bind(projectId, ownerId),
    db
      .prepare(
        `SELECT m.id FROM meshes m JOIN geometries g ON g.id = m.geometry_id
          WHERE g.project_id = ? AND m.owner_id = ?`,
      )
      .bind(projectId, ownerId),
    db
      .prepare(
        `SELECT r.id FROM runs r JOIN simulations s ON s.id = r.simulation_id
          WHERE s.project_id = ? AND r.owner_id = ?`,
      )
      .bind(projectId, ownerId),
  ]);
  const ids = (result: D1Result<{ id: string }> | undefined) => (result?.results ?? []).map((row) => row.id);
  const targets = [...ids(geometries), ...ids(meshes), ...ids(runs)];
  if (targets.length > 0) {
    const busy = await db
      .prepare(
        `SELECT 1 FROM jobs WHERE owner_id = ? AND ${ACTIVE}
            AND target_id IN (SELECT value FROM json_each(?)) LIMIT 1`,
      )
      .bind(ownerId, JSON.stringify(targets))
      .first();
    if (busy !== null) return false;
  }
  const owner = `owners/${ownerId}`;
  for (const id of ids(geometries)) await deletePrefix(files, `${owner}/geometries/${id}/`);
  for (const id of ids(meshes)) await deletePrefix(files, `${owner}/meshes/${id}/`);
  for (const id of ids(runs)) await deletePrefix(files, `${owner}/runs/${id}/`);
  await deletePrefix(files, projectFolderKey(ownerId, projectId));
  const inProject = "project_id IN (SELECT id FROM projects WHERE id = ?1 AND owner_id = ?2 AND deleted_at <= ?3)";
  const [, , , , project] = await db.batch([
    // Share links and report figures go with their runs, views and report options with their
    // simulations (ON DELETE CASCADE).
    db
      .prepare(`DELETE FROM runs WHERE simulation_id IN (SELECT id FROM simulations WHERE ${inProject})`)
      .bind(projectId, ownerId, cutoff),
    db.prepare(`DELETE FROM simulations WHERE ${inProject}`).bind(projectId, ownerId, cutoff),
    db
      .prepare(`DELETE FROM meshes WHERE geometry_id IN (SELECT id FROM geometries WHERE ${inProject})`)
      .bind(projectId, ownerId, cutoff),
    db.prepare(`DELETE FROM geometries WHERE ${inProject}`).bind(projectId, ownerId, cutoff),
    db
      .prepare("DELETE FROM projects WHERE id = ?1 AND owner_id = ?2 AND deleted_at <= ?3")
      .bind(projectId, ownerId, cutoff),
  ]);
  return project?.meta.changes === 1;
}

/**
 * Purges every project and folder that went to the trash at least the retention period before
 * `now`. Folders go once they are empty, innermost first; everything in a folder went to the
 * trash with it or before it, so it is purged first.
 */
export async function purgeTrash(db: D1Database, files: R2Bucket, now: Date): Promise<PurgeSummary> {
  const cutoff = trashCutoff(now, await trashRetentionDays(db));
  const { results: expired } = await db
    .prepare("SELECT id, owner_id FROM projects WHERE deleted_at IS NOT NULL AND deleted_at <= ? ORDER BY deleted_at")
    .bind(cutoff)
    .all<{ id: string; owner_id: string }>();
  let projects = 0;
  for (const project of expired) {
    if (await purgeProject(db, files, project.owner_id, project.id, cutoff)) projects += 1;
  }
  let folders = 0;
  for (;;) {
    const removed = await db
      .prepare(
        `DELETE FROM folders
          WHERE deleted_at IS NOT NULL AND deleted_at <= ?
            AND NOT EXISTS (SELECT 1 FROM folders c WHERE c.parent_id = folders.id)
            AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.folder_id = folders.id)`,
      )
      .bind(cutoff)
      .run();
    if (removed.meta.changes === 0) break;
    folders += removed.meta.changes;
  }
  return { projects, folders };
}
