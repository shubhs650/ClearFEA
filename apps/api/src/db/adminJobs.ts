// SPDX-License-Identifier: AGPL-3.0-or-later
// Every user's jobs as the admin dashboard shows them (M13.2, ADR-113, ADR-127): the lanes and
// their queues on the Overview, and the Jobs and runs tab. Read by the admin only, so not
// owner-scoped; each job carries ids, its owner's address, its state and its failure for support,
// never a project's name, model or results.

import type { AdminJob, JobStatus, JobType } from "@clearfea/spec";
import { type Lane, laneSql } from "./jobs";

export interface AdminJobFilter {
  id?: string;
  statuses?: readonly JobStatus[];
  type?: JobType;
  userId?: string;
  /** Only jobs created at or after this ISO 8601 time (M13.4's export). */
  since?: string;
  /** Only jobs created before this ISO 8601 time, to page on. */
  before?: string;
  /** Oldest first rather than newest first, for the queues. */
  oldestFirst?: boolean;
  limit: number;
}

interface AdminJobRow {
  id: string;
  type: JobType;
  status: JobStatus;
  stage: string | null;
  owner_id: string;
  owner_email: string | null;
  target_id: string | null;
  attempt: number;
  machine_size: string | null;
  claimed_by: string | null;
  stop_requested: AdminJob["stopRequested"];
  created_at: string;
  claimed_at: string | null;
  heartbeat_at: string | null;
  finished_at: string | null;
  failure_category: AdminJob["failureCategory"];
  failure_cause: string | null;
  failure_message: string | null;
  peak_memory_bytes: number | null;
  billed_seconds: number | null;
  queue_position: number | null;
}

/** Jobs newest first (or oldest first), with each queued job's place in its lane. */
export async function listAdminJobs(db: D1Database, filter: AdminJobFilter): Promise<AdminJob[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  if (filter.id !== undefined) {
    where.push("jobs.id = ?");
    values.push(filter.id);
  }
  if (filter.statuses !== undefined && filter.statuses.length > 0) {
    where.push(`jobs.status IN (${filter.statuses.map(() => "?").join(", ")})`);
    values.push(...filter.statuses);
  }
  if (filter.type !== undefined) {
    where.push("jobs.type = ?");
    values.push(filter.type);
  }
  if (filter.userId !== undefined) {
    where.push("jobs.owner_id = ?");
    values.push(filter.userId);
  }
  if (filter.since !== undefined) {
    where.push("jobs.created_at >= ?");
    values.push(filter.since);
  }
  if (filter.before !== undefined) {
    where.push("jobs.created_at < ?");
    values.push(filter.before);
  }
  const order = filter.oldestFirst ? "ASC" : "DESC";
  const { results } = await db
    .prepare(
      `SELECT jobs.id, jobs.type, jobs.status, jobs.stage, jobs.owner_id, users.email AS owner_email,
              jobs.target_id, jobs.attempt, jobs.machine_size, jobs.claimed_by,
              CASE WHEN jobs.status IN ('claimed', 'running') THEN jobs.stop_requested END AS stop_requested,
              jobs.created_at, jobs.claimed_at, jobs.heartbeat_at, jobs.finished_at,
              jobs.failure_category, jobs.failure_cause, jobs.failure_message,
              jobs.peak_memory_bytes, jobs.billed_seconds,
              CASE WHEN jobs.status = 'queued' THEN
                (SELECT COUNT(*) FROM jobs ahead
                  WHERE ahead.status = 'queued' AND ${laneSql("ahead.type")} = ${laneSql("jobs.type")}
                    AND (ahead.created_at < jobs.created_at
                         OR (ahead.created_at = jobs.created_at AND ahead.id <= jobs.id)))
              END AS queue_position
         FROM jobs LEFT JOIN users ON users.id = jobs.owner_id
        ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY jobs.created_at ${order}, jobs.id ${order} LIMIT ?`,
    )
    .bind(...values, filter.limit)
    .all<AdminJobRow>();
  return results.map(toAdminJob);
}

function toAdminJob(row: AdminJobRow): AdminJob {
  return {
    id: row.id,
    type: row.type,
    lane: row.type === "solve" ? "solve" : "light",
    status: row.status,
    stage: row.stage,
    ownerId: row.owner_id,
    ownerEmail: row.owner_email,
    targetId: row.target_id,
    attempt: row.attempt,
    machineSize: row.machine_size,
    claimedBy: row.claimed_by,
    stopRequested: row.stop_requested,
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
    heartbeatAt: row.heartbeat_at,
    finishedAt: row.finished_at,
    failureCategory: row.failure_category,
    failureCause: row.failure_cause,
    failureMessage: row.failure_message,
    peakMemoryBytes: row.peak_memory_bytes,
    billedSeconds: row.billed_seconds,
    queuePosition: row.queue_position,
  };
}

/** One job as the dashboard shows it, or null. */
export async function adminJob(db: D1Database, jobId: string): Promise<AdminJob | null> {
  const [job] = await listAdminJobs(db, { id: jobId, limit: 1 });
  return job ?? null;
}

/** Most jobs each lane's queue shows on the Overview; the Jobs and runs tab lists the rest. */
export const QUEUE_SHOWN = 50;

/** The jobs running in each lane and the jobs waiting for it, oldest first. */
export async function laneJobs(db: D1Database): Promise<{ lane: Lane; running: AdminJob[]; queued: AdminJob[] }[]> {
  const [running, queued] = await Promise.all([
    listAdminJobs(db, { statuses: ["claimed", "running"], oldestFirst: true, limit: 100 }),
    listAdminJobs(db, { statuses: ["queued"], oldestFirst: true, limit: 2 * QUEUE_SHOWN }),
  ]);
  return (["solve", "light"] as const).map((lane) => ({
    lane,
    running: running.filter((job) => job.lane === lane),
    queued: queued.filter((job) => job.lane === lane).slice(0, QUEUE_SHOWN),
  }));
}
