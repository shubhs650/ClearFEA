// SPDX-License-Identifier: AGPL-3.0-or-later
// Meshes (docs/ARCHITECTURE.md section 4, ADR-028). Functions used on behalf of a user take the
// user id and filter on owner_id. recordMeshOutcome is called for a job the worker holds, and
// touches only that job's own mesh.

import type { ElementOrder, LocalSizeParams, MeshQuality, MeshResult, MeshStatus, Quantity } from "@clearfea/spec";
import { getJob, type Job, newJob } from "./jobs";

export interface Mesh {
  id: string;
  ownerId: string;
  geometryId: string;
  size: Quantity;
  order: ElementOrder;
  local: LocalSizeParams[];
  status: MeshStatus;
  problem: string | null;
  nodeCount: number | null;
  elementCount: number | null;
  quality: MeshQuality | null;
  jobId: string | null;
  createdAt: string;
}

interface MeshRow {
  id: string;
  owner_id: string;
  geometry_id: string;
  size: string;
  element_order: ElementOrder;
  local_sizes: string;
  status: MeshStatus;
  problem: string | null;
  node_count: number | null;
  element_count: number | null;
  quality: string | null;
  job_id: string | null;
  created_at: string;
}

function toMesh(row: MeshRow): Mesh {
  return {
    id: row.id,
    ownerId: row.owner_id,
    geometryId: row.geometry_id,
    size: JSON.parse(row.size),
    order: row.element_order,
    local: JSON.parse(row.local_sizes),
    status: row.status,
    problem: row.problem,
    nodeCount: row.node_count,
    elementCount: row.element_count,
    quality: row.quality === null ? null : JSON.parse(row.quality),
    jobId: row.job_id,
    createdAt: row.created_at,
  };
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** The files of a mesh in R2. */
export type MeshFile = "mesh.bin" | "display.bin";

export function meshKey(ownerId: string, meshId: string, file: MeshFile): string {
  return `owners/${ownerId}/meshes/${meshId}/${file}`;
}

/**
 * Records a mesh, queues its mesh job and makes it the simulation's mesh, in one batch so a
 * mesh never exists without its job. The caller has checked that the simulation is the
 * user's and is on this geometry.
 */
export async function createMesh(
  db: D1Database,
  userId: string,
  request: {
    simulationId: string;
    geometryId: string;
    scaling: number;
    size: Quantity;
    order: ElementOrder;
    local: LocalSizeParams[];
  },
): Promise<{ mesh: Mesh; job: Job }> {
  const id = crypto.randomUUID();
  const job = newJob(db, userId, "mesh", id, {
    geometryId: request.geometryId,
    scaling: request.scaling,
    size: request.size,
    order: request.order,
    local: request.local,
  });
  const [, , linked] = await db.batch([
    job.statement,
    db
      .prepare(
        `INSERT INTO meshes (id, owner_id, geometry_id, size, element_order, local_sizes, job_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        userId,
        request.geometryId,
        JSON.stringify(request.size),
        request.order,
        JSON.stringify(request.local),
        job.id,
      ),
    db
      .prepare(
        `UPDATE simulations SET mesh_id = ?, updated_at = ${NOW}
          WHERE id = ? AND owner_id = ? AND geometry_id = ?`,
      )
      .bind(id, request.simulationId, userId, request.geometryId),
  ]);
  if (linked?.meta.changes !== 1) throw new Error("The simulation of a new mesh disappeared.");
  const [mesh, queued] = await Promise.all([getMesh(db, userId, id), getJob(db, userId, job.id)]);
  if (mesh === null || queued === null) throw new Error("Inserting the mesh returned no row.");
  return { mesh, job: queued };
}

export async function getMesh(db: D1Database, userId: string, meshId: string): Promise<Mesh | null> {
  const row = await db
    .prepare("SELECT * FROM meshes WHERE id = ? AND owner_id = ?")
    .bind(meshId, userId)
    .first<MeshRow>();
  return row === null ? null : toMesh(row);
}

/** The simulation's latest mesh, or null when it has none or is not the user's. */
export async function simulationMesh(
  db: D1Database,
  userId: string,
  simulationId: string,
): Promise<Mesh | null> {
  const row = await db
    .prepare(
      `SELECT meshes.* FROM meshes JOIN simulations s ON s.mesh_id = meshes.id
        WHERE s.id = ? AND s.owner_id = ? AND meshes.owner_id = ?`,
    )
    .bind(simulationId, userId, userId)
    .first<MeshRow>();
  return row === null ? null : toMesh(row);
}

export type MeshOutcome =
  | { status: "succeeded"; result: MeshResult }
  | { status: "failed"; problem: string };

/** Applies a finished mesh job to its mesh. Only the mesh's own job may change it. */
export async function recordMeshOutcome(db: D1Database, job: Job, outcome: MeshOutcome): Promise<void> {
  if (job.targetId === null) return;
  const scope = "WHERE id = ? AND owner_id = ? AND job_id = ? AND status = 'meshing'";
  if (outcome.status === "failed") {
    await db
      .prepare(`UPDATE meshes SET status = 'failed', problem = ?, updated_at = ${NOW} ${scope}`)
      .bind(outcome.problem, job.targetId, job.ownerId, job.id)
      .run();
    return;
  }
  await db
    .prepare(
      `UPDATE meshes
          SET status = 'ready', problem = NULL, node_count = ?, element_count = ?, quality = ?,
              updated_at = ${NOW}
        ${scope}`,
    )
    .bind(
      outcome.result.nodes,
      outcome.result.elements,
      JSON.stringify(outcome.result.quality),
      job.targetId,
      job.ownerId,
      job.id,
    )
    .run();
}
