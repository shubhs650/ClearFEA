// SPDX-License-Identifier: AGPL-3.0-or-later
// Jobs (docs/ARCHITECTURE.md section 6). Functions used on behalf of a user take
// the user id and filter on owner_id. Functions used by the worker take the
// worker id instead: the worker serves every owner, so its scope is the jobs it
// has claimed, never a user's other records.

export const JOB_TYPES = ["noop", "import", "mesh", "solve", "report"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const FAILURE_CATEGORIES = ["user_fault", "platform_fault"] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

export type JobStatus =
  | "queued"
  | "claimed"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "stopped_at_limit";

export interface Job {
  id: string;
  ownerId: string;
  type: JobType;
  targetId: string | null;
  status: JobStatus;
  stage: string | null;
  claimedBy: string | null;
  heartbeatAt: string | null;
  failureCategory: FailureCategory | null;
  failureCause: string | null;
  result: unknown;
  createdAt: string;
  claimedAt: string | null;
  finishedAt: string | null;
}

interface JobRow {
  id: string;
  owner_id: string;
  type: JobType;
  target_id: string | null;
  status: JobStatus;
  stage: string | null;
  claimed_by: string | null;
  heartbeat_at: string | null;
  failure_category: FailureCategory | null;
  failure_cause: string | null;
  result: string | null;
  created_at: string;
  claimed_at: string | null;
  finished_at: string | null;
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    ownerId: row.owner_id,
    type: row.type,
    targetId: row.target_id,
    status: row.status,
    stage: row.stage,
    claimedBy: row.claimed_by,
    heartbeatAt: row.heartbeat_at,
    failureCategory: row.failure_category,
    failureCause: row.failure_cause,
    result: row.result === null ? null : JSON.parse(row.result),
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
    finishedAt: row.finished_at,
  };
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** Statuses in which the claiming worker may still report on a job. */
const ACTIVE = "('claimed', 'running')";

export async function createJob(
  db: D1Database,
  userId: string,
  type: JobType,
  targetId: string | null = null,
): Promise<Job> {
  const row = await db
    .prepare(
      "INSERT INTO jobs (id, owner_id, type, target_id) VALUES (?, ?, ?, ?) RETURNING *",
    )
    .bind(crypto.randomUUID(), userId, type, targetId)
    .first<JobRow>();
  if (row === null) throw new Error("Inserting the job returned no row.");
  return toJob(row);
}

export async function getJob(db: D1Database, userId: string, jobId: string): Promise<Job | null> {
  const row = await db
    .prepare("SELECT * FROM jobs WHERE id = ? AND owner_id = ?")
    .bind(jobId, userId)
    .first<JobRow>();
  return row === null ? null : toJob(row);
}

/**
 * Marks the oldest queued job of one of the given types as claimed by this
 * worker and returns it, or null when nothing is queued. A single UPDATE
 * statement, so two workers can never claim the same job.
 */
export async function claimJob(
  db: D1Database,
  workerId: string,
  types: readonly JobType[],
): Promise<Job | null> {
  if (types.length === 0) return null;
  const placeholders = types.map(() => "?").join(", ");
  const row = await db
    .prepare(
      `UPDATE jobs
         SET status = 'claimed', claimed_by = ?, claimed_at = ${NOW}, heartbeat_at = ${NOW}
       WHERE id = (
         SELECT id FROM jobs
          WHERE status = 'queued' AND type IN (${placeholders})
          ORDER BY created_at, id
          LIMIT 1
       )
       RETURNING *`,
    )
    .bind(workerId, ...types)
    .first<JobRow>();
  return row === null ? null : toJob(row);
}

export type HeartbeatOutcome =
  | { found: false }
  | { found: true; action: "continue" | "cancel" | "stop" };

/**
 * Records that the worker is alive and at the given stage. The first heartbeat
 * moves a claimed job to running. If the job has left the active statuses
 * (cancelled or stopped by the API), tells the worker to give up.
 */
export async function recordHeartbeat(
  db: D1Database,
  workerId: string,
  jobId: string,
  stage: string | null,
): Promise<HeartbeatOutcome> {
  const updated = await db
    .prepare(
      `UPDATE jobs SET status = 'running', stage = ?, heartbeat_at = ${NOW}
        WHERE id = ? AND claimed_by = ? AND status IN ${ACTIVE}
        RETURNING id`,
    )
    .bind(stage, jobId, workerId)
    .first<{ id: string }>();
  if (updated !== null) return { found: true, action: "continue" };

  const current = await db
    .prepare("SELECT status FROM jobs WHERE id = ? AND claimed_by = ?")
    .bind(jobId, workerId)
    .first<{ status: JobStatus }>();
  if (current === null) return { found: false };
  return { found: true, action: current.status === "stopped_at_limit" ? "stop" : "cancel" };
}

export type Completion =
  | { status: "succeeded"; result: unknown }
  | { status: "failed"; failureCategory: FailureCategory; failureCause: string };

/** Records the final outcome. Returns the job, or null if this worker does not hold it. */
export async function completeJob(
  db: D1Database,
  workerId: string,
  jobId: string,
  completion: Completion,
): Promise<Job | null> {
  const succeeded = completion.status === "succeeded";
  const row = await db
    .prepare(
      `UPDATE jobs
          SET status = ?, result = ?, failure_category = ?, failure_cause = ?,
              finished_at = ${NOW}, heartbeat_at = ${NOW}
        WHERE id = ? AND claimed_by = ? AND status IN ${ACTIVE}
        RETURNING *`,
    )
    .bind(
      completion.status,
      succeeded ? JSON.stringify(completion.result ?? null) : null,
      succeeded ? null : completion.failureCategory,
      succeeded ? null : completion.failureCause,
      jobId,
      workerId,
    )
    .first<JobRow>();
  return row === null ? null : toJob(row);
}
