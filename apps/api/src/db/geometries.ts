// SPDX-License-Identifier: AGPL-3.0-or-later
// Geometries (docs/ARCHITECTURE.md section 4). Functions used on behalf of a user take the
// user id and filter on owner_id. recordImportOutcome is called for a job the worker holds,
// and touches only that job's own geometry.

import type { BoundingBox, GeometryStatus, ImportResult } from "@clearfea/spec";
import { getJob, type Job, newJob } from "./jobs";

export interface Geometry {
  id: string;
  ownerId: string;
  name: string;
  sizeBytes: number;
  status: GeometryStatus;
  problem: string | null;
  declaredUnit: string | null;
  detectedUnit: string | null;
  unitProblem: string | null;
  readingFactor: number | null;
  confirmedUnit: string | null;
  /** True once a simulation uses the geometry; its unit can then no longer change (ADR-026). */
  unitLocked: boolean;
  scaling: number | null;
  bodyCount: number | null;
  faceCount: number | null;
  size: number | null;
  bbox: BoundingBox | null;
  importJobId: string | null;
  createdAt: string;
}

interface GeometryRow {
  id: string;
  owner_id: string;
  name: string;
  size_bytes: number;
  status: GeometryStatus;
  problem: string | null;
  declared_unit: string | null;
  detected_unit: string | null;
  unit_problem: string | null;
  reading_factor: number | null;
  confirmed_unit: string | null;
  unit_locked: number;
  scaling: number | null;
  body_count: number | null;
  face_count: number | null;
  size: number | null;
  bbox: string | null;
  import_job_id: string | null;
  created_at: string;
}

function toGeometry(row: GeometryRow): Geometry {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    sizeBytes: row.size_bytes,
    status: row.status,
    problem: row.problem,
    declaredUnit: row.declared_unit,
    detectedUnit: row.detected_unit,
    unitProblem: row.unit_problem,
    readingFactor: row.reading_factor,
    confirmedUnit: row.confirmed_unit,
    unitLocked: row.unit_locked !== 0,
    scaling: row.scaling,
    bodyCount: row.body_count,
    faceCount: row.face_count,
    size: row.size,
    bbox: row.bbox === null ? null : JSON.parse(row.bbox),
    importJobId: row.import_job_id,
    createdAt: row.created_at,
  };
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** True when a simulation uses the geometry in the surrounding statement. */
const USED = "EXISTS (SELECT 1 FROM simulations s WHERE s.geometry_id = geometries.id)";
const SELECT = `SELECT geometries.*, ${USED} AS unit_locked FROM geometries`;

/** The files of a geometry in R2. */
export type GeometryFile = "model.step" | "topology.json" | "display.bin";

export function geometryKey(ownerId: string, geometryId: string, file: GeometryFile): string {
  return `owners/${ownerId}/geometries/${geometryId}/${file}`;
}

/**
 * Records an uploaded file and queues its first import, in one batch so a geometry never
 * exists without its import job. The STEP file must already be stored under geometryKey.
 */
export async function createGeometry(
  db: D1Database,
  userId: string,
  geometry: { id: string; name: string; sizeBytes: number },
): Promise<{ geometry: Geometry; job: Job }> {
  const job = newJob(db, userId, "import", geometry.id, { confirmedUnit: null });
  await db.batch([
    job.statement,
    db
      .prepare(
        "INSERT INTO geometries (id, owner_id, name, size_bytes, import_job_id) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(geometry.id, userId, geometry.name, geometry.sizeBytes, job.id),
  ]);
  const [created, queued] = await Promise.all([
    getGeometry(db, userId, geometry.id),
    getJob(db, userId, job.id),
  ]);
  if (created === null || queued === null) throw new Error("Inserting the geometry returned no row.");
  return { geometry: created, job: queued };
}

export async function getGeometry(
  db: D1Database,
  userId: string,
  geometryId: string,
): Promise<Geometry | null> {
  const row = await db
    .prepare(`${SELECT} WHERE id = ? AND owner_id = ?`)
    .bind(geometryId, userId)
    .first<GeometryRow>();
  return row === null ? null : toGeometry(row);
}

/** The user's most recent geometries, newest first. */
export async function listGeometries(
  db: D1Database,
  userId: string,
  limit = 20,
): Promise<Geometry[]> {
  const { results } = await db
    .prepare(
      `${SELECT} WHERE owner_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(userId, limit)
    .all<GeometryRow>();
  return results.map(toGeometry);
}

export type UnitChange =
  | { kind: "confirmed"; geometry: Geometry }
  | { kind: "reimporting"; geometry: Geometry; job: Job }
  | { kind: "notAllowed"; geometry: Geometry }
  | { kind: "locked"; geometry: Geometry };

/** Statuses in which the user may set the unit: the file has been read and is not busy. */
export const UNIT_SETTABLE: readonly GeometryStatus[] = ["needs_unit", "unconfirmed", "ready"];

/**
 * Whether setting this unit imports the file again: the current topology was not made at it.
 * Only meaningful when the unit may be set (UNIT_SETTABLE, not locked).
 */
export function unitNeedsImport(geometry: Geometry, unit: string): boolean {
  const current =
    geometry.status === "ready"
      ? geometry.confirmedUnit
      : geometry.scaling === 1
        ? geometry.detectedUnit
        : null;
  return current !== unit;
}

/**
 * Sets the unit the user says the file is in. If the current topology was already made at
 * that unit, the geometry becomes ready. Otherwise the file is imported again with the
 * unit applied by OpenCASCADE at import (ADR-023), never by scaling the old result.
 * Once a simulation uses the geometry its face tags and sizes are fixed, so only the unit
 * already confirmed may be confirmed again (ADR-026).
 */
export async function confirmUnit(
  db: D1Database,
  userId: string,
  geometry: Geometry,
  unit: string,
): Promise<UnitChange> {
  if (!UNIT_SETTABLE.includes(geometry.status)) return { kind: "notAllowed", geometry };
  if (geometry.unitLocked) {
    return geometry.confirmedUnit === unit
      ? { kind: "confirmed", geometry }
      : { kind: "locked", geometry };
  }
  if (!unitNeedsImport(geometry, unit)) {
    await db
      .prepare(
        `UPDATE geometries SET status = 'ready', confirmed_unit = ?, updated_at = ${NOW}
          WHERE id = ? AND owner_id = ? AND NOT ${USED}`,
      )
      .bind(unit, geometry.id, userId)
      .run();
  } else {
    // If a simulation is created between the check above and this batch, the guarded update
    // changes nothing and the queued job's answer is ignored, since it is not import_job_id.
    const job = newJob(db, userId, "import", geometry.id, { confirmedUnit: unit });
    await db.batch([
      job.statement,
      db
        .prepare(
          `UPDATE geometries
              SET status = 'importing', confirmed_unit = ?, import_job_id = ?, problem = NULL,
                  updated_at = ${NOW}
            WHERE id = ? AND owner_id = ? AND NOT ${USED}`,
        )
        .bind(unit, job.id, geometry.id, userId),
    ]);
    const [updated, queued] = await Promise.all([
      getGeometry(db, userId, geometry.id),
      getJob(db, userId, job.id),
    ]);
    if (updated === null || queued === null) throw new Error("The geometry disappeared.");
    return { kind: "reimporting", geometry: updated, job: queued };
  }
  const updated = await getGeometry(db, userId, geometry.id);
  if (updated === null) throw new Error("The geometry disappeared.");
  return { kind: "confirmed", geometry: updated };
}

export type ImportOutcome =
  | { status: "succeeded"; result: ImportResult }
  | { status: "failed"; problem: string };

/**
 * Applies a finished import job to its geometry. Only the geometry's latest import job may
 * change it, so a late answer from an older job is ignored. A first import leaves the unit
 * for the user to confirm; a re-import at a confirmed unit makes the geometry ready.
 */
export async function recordImportOutcome(
  db: D1Database,
  job: Job,
  outcome: ImportOutcome,
): Promise<void> {
  if (job.targetId === null) return;
  const scope = "WHERE id = ? AND owner_id = ? AND import_job_id = ?";
  if (outcome.status === "failed") {
    await db
      .prepare(
        `UPDATE geometries SET status = 'failed', problem = ?, updated_at = ${NOW} ${scope}`,
      )
      .bind(outcome.problem, job.targetId, job.ownerId, job.id)
      .run();
    return;
  }
  const { result } = outcome;
  const confirmed = typeof job.params?.confirmedUnit === "string";
  const status: GeometryStatus = confirmed
    ? "ready"
    : result.unit.detectedUnit === null
      ? "needs_unit"
      : "unconfirmed";
  await db
    .prepare(
      `UPDATE geometries
          SET status = ?, problem = NULL, declared_unit = ?, detected_unit = ?, unit_problem = ?,
              reading_factor = ?, scaling = ?, body_count = ?, face_count = ?, size = ?, bbox = ?,
              updated_at = ${NOW}
        ${scope}`,
    )
    .bind(
      status,
      result.unit.declared,
      result.unit.detectedUnit,
      result.unit.problem,
      result.unit.readingFactor,
      result.scaling,
      result.bodies,
      result.faces,
      result.size,
      JSON.stringify(result.bbox),
      job.targetId,
      job.ownerId,
      job.id,
    )
    .run();
}
