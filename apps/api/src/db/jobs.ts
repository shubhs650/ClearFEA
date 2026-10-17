// SPDX-License-Identifier: AGPL-3.0-or-later
// Jobs (docs/ARCHITECTURE.md section 6). Functions used on behalf of a user take
// the user id and filter on owner_id. Functions used by the worker take the
// worker id instead: the worker serves every owner, so its scope is the jobs it
// has claimed, never a user's other records.

import type { FailureCategory, HeartbeatAction, JobStatus, JobType, WorkerSoftware } from "@clearfea/spec";
import { chargeStatement } from "../billing/ledger";
import { isMetered, type JobCharge } from "../billing/cost";

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
  failureMessage: string | null;
  params: Record<string, unknown> | null;
  result: unknown;
  /** Versions the claiming worker reported, or null before a claim or when it sent none. */
  software: WorkerSoftware | null;
  /** The machine size and its micro-credit rate per hour, fixed when a metered job is queued. */
  machineSize: string | null;
  ratePerHour: number | null;
  /** What the worker measured and what the job cost, once a metered job has ended (ADR-033). */
  billableMs: number | null;
  billedSeconds: number | null;
  cost: number | null;
  /** How the owner (or M8.3's stop limit) asked a running job to end, until the worker has stopped (M8.2). */
  stopRequested: StopReason | null;
  /** A run's stop limit (M8.3, ADR-087): the multiplier of its estimate and the seconds it gives; null without one. */
  stopMultiplier: number | null;
  stopAfterSeconds: number | null;
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
  failure_message: string | null;
  params: string | null;
  result: string | null;
  software: string | null;
  machine_size: string | null;
  rate_per_hour: number | null;
  billable_ms: number | null;
  billed_seconds: number | null;
  cost: number | null;
  stop_requested: StopReason | null;
  stop_multiplier: number | null;
  stop_after_seconds: number | null;
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
    failureMessage: row.failure_message,
    params: row.params === null ? null : JSON.parse(row.params),
    result: row.result === null ? null : JSON.parse(row.result),
    software: row.software === null ? null : JSON.parse(row.software),
    machineSize: row.machine_size,
    ratePerHour: row.rate_per_hour,
    billableMs: row.billable_ms,
    billedSeconds: row.billed_seconds,
    cost: row.cost,
    stopRequested: row.stop_requested,
    stopMultiplier: row.stop_multiplier,
    stopAfterSeconds: row.stop_after_seconds,
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
    finishedAt: row.finished_at,
  };
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** The status a job ends with when it is asked to stop: by its owner, or at its stop limit (M8.3). */
export type StopReason = "cancelled" | "stopped_at_limit";

/** Statuses in which the claiming worker may still report on a job. */
const ACTIVE = "('claimed', 'running')";

export interface NewJob {
  id: string;
  statement: D1PreparedStatement;
}

/**
 * The statement that queues a job, for callers that must create it in one batch with the
 * record it works on. Run it, then read the job back with getJob. A metered job takes the
 * machine size named, or the default one, and keeps that size's current rate (ADR-033); it is
 * not inserted when no such size exists.
 */
export function newJob(
  db: D1Database,
  userId: string,
  type: JobType,
  targetId: string | null = null,
  params: Record<string, unknown> | null = null,
  machineSize?: string,
): NewJob {
  const id = crypto.randomUUID();
  const values = [id, userId, type, targetId, params === null ? null : JSON.stringify(params)];
  const statement = !isMetered(type)
    ? db.prepare("INSERT INTO jobs (id, owner_id, type, target_id, params) VALUES (?, ?, ?, ?, ?)").bind(...values)
    : machineSize === undefined
      ? db
          .prepare(
            `INSERT INTO jobs (id, owner_id, type, target_id, params, machine_size, rate_per_hour)
             SELECT ?, ?, ?, ?, ?, name, rate_per_hour FROM machine_sizes WHERE is_default = 1`,
          )
          .bind(...values)
      : db
          .prepare(
            `INSERT INTO jobs (id, owner_id, type, target_id, params, machine_size, rate_per_hour)
             SELECT ?, ?, ?, ?, ?, name, rate_per_hour FROM machine_sizes WHERE name = ?`,
          )
          .bind(...values, machineSize);
  return { id, statement };
}

export async function createJob(
  db: D1Database,
  userId: string,
  type: JobType,
  targetId: string | null = null,
  params: Record<string, unknown> | null = null,
): Promise<Job> {
  const { id, statement } = newJob(db, userId, type, targetId, params);
  const inserted = await statement.run();
  if (inserted.meta.changes !== 1) throw new Error("No default machine size is configured (machine_sizes).");
  const job = await getJob(db, userId, id);
  if (job === null) throw new Error("Inserting the job returned no row.");
  return job;
}

export async function getJob(db: D1Database, userId: string, jobId: string): Promise<Job | null> {
  const row = await db
    .prepare("SELECT * FROM jobs WHERE id = ? AND owner_id = ?")
    .bind(jobId, userId)
    .first<JobRow>();
  return row === null ? null : toJob(row);
}

/** The user's most recent jobs, newest first. */
export async function listJobs(db: D1Database, userId: string, limit = 20): Promise<Job[]> {
  const { results } = await db
    .prepare("SELECT * FROM jobs WHERE owner_id = ? ORDER BY created_at DESC, id DESC LIMIT ?")
    .bind(userId, limit)
    .all<JobRow>();
  return results.map(toJob);
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
  software: WorkerSoftware | null = null,
): Promise<Job | null> {
  if (types.length === 0) return null;
  const placeholders = types.map(() => "?").join(", ");
  const row = await db
    .prepare(
      `UPDATE jobs
         SET status = 'claimed', claimed_by = ?, claimed_at = ${NOW}, heartbeat_at = ${NOW},
             software = ?
       WHERE id = (
         SELECT id FROM jobs
          WHERE status = 'queued' AND type IN (${placeholders})
          ORDER BY created_at, id
          LIMIT 1
       )
       RETURNING *`,
    )
    .bind(workerId, software === null ? null : JSON.stringify(software), ...types)
    .first<JobRow>();
  return row === null ? null : toJob(row);
}

/** A job not yet asked to stop whose time since it was claimed has reached its stop limit. */
const AT_LIMIT = `stop_requested IS NULL AND stop_after_seconds IS NOT NULL AND claimed_at IS NOT NULL
                  AND (julianday('now') - julianday(claimed_at)) * 86400 >= stop_after_seconds`;

export type HeartbeatOutcome = { found: false } | { found: true; action: HeartbeatAction };

/**
 * Records that the worker is alive and at the given stage. The first heartbeat
 * moves a claimed job to running. A job that has had the machine for its stop limit since it
 * was claimed is asked to stop there (M8.3, ADR-087), unless its owner has already cancelled it.
 * When the job has been asked to stop (M8.2), or has left the active statuses, tells the worker
 * to give up: `cancel` for its owner's cancel, `stop` at its stop limit.
 */
export async function recordHeartbeat(
  db: D1Database,
  workerId: string,
  jobId: string,
  stage: string | null,
): Promise<HeartbeatOutcome> {
  const updated = await db
    .prepare(
      `UPDATE jobs SET status = 'running', stage = ?, heartbeat_at = ${NOW},
                       stop_requested = CASE WHEN ${AT_LIMIT} THEN 'stopped_at_limit' ELSE stop_requested END,
                       stop_requested_at = CASE WHEN ${AT_LIMIT} THEN ${NOW} ELSE stop_requested_at END
        WHERE id = ? AND claimed_by = ? AND status IN ${ACTIVE}
        RETURNING stop_requested`,
    )
    .bind(stage, jobId, workerId)
    .first<{ stop_requested: StopReason | null }>();
  if (updated !== null) {
    const asked = updated.stop_requested;
    return { found: true, action: asked === null ? "continue" : asked === "stopped_at_limit" ? "stop" : "cancel" };
  }

  const current = await db
    .prepare("SELECT status FROM jobs WHERE id = ? AND claimed_by = ?")
    .bind(jobId, workerId)
    .first<{ status: JobStatus }>();
  if (current === null) return { found: false };
  return { found: true, action: current.status === "stopped_at_limit" ? "stop" : "cancel" };
}

export type Completion =
  | { status: "succeeded"; result: unknown }
  /** The worker stopped as it was asked to (M8.2); the job ends with the reason asked for. */
  | { status: StopReason }
  | {
      status: "failed";
      failureCategory: FailureCategory;
      failureCause: string;
      failureMessage: string | null;
    };

/** A job that the given worker holds and may still report on, or null. */
export async function getClaimedJob(
  db: D1Database,
  workerId: string,
  jobId: string,
): Promise<Job | null> {
  const row = await db
    .prepare(`SELECT * FROM jobs WHERE id = ? AND claimed_by = ? AND status IN ${ACTIVE}`)
    .bind(jobId, workerId)
    .first<JobRow>();
  return row === null ? null : toJob(row);
}

/**
 * Records the final outcome and what the worker measured. For a metered job, `charge` is its
 * cost at the job's own rate; a charged job gets its ledger entry in the same batch, so a job
 * is completed and charged together or not at all. Returns the job, or null if this worker
 * does not hold it.
 */
export async function completeJob(
  db: D1Database,
  workerId: string,
  jobId: string,
  completion: Completion,
  billableMs: number,
  charge: JobCharge | null,
): Promise<Job | null> {
  const succeeded = completion.status === "succeeded";
  const failed = completion.status === "failed" ? completion : null;
  const complete = db
    .prepare(
      `UPDATE jobs
          SET status = ?, result = ?, failure_category = ?, failure_cause = ?,
              failure_message = ?, finished_at = ${NOW}, heartbeat_at = ${NOW},
              billable_ms = ?, billed_seconds = ?, cost = ?
        WHERE id = ? AND claimed_by = ? AND status IN ${ACTIVE}
        RETURNING *`,
    )
    .bind(
      completion.status,
      succeeded ? JSON.stringify(completion.result ?? null) : null,
      failed?.failureCategory ?? null,
      failed?.failureCause ?? null,
      failed?.failureMessage ?? null,
      billableMs,
      charge?.billedSeconds ?? null,
      charge?.cost ?? null,
      jobId,
      workerId,
    );
  const statements = charge?.charged ? [chargeStatement(db, workerId, jobId, charge.cost, ACTIVE), complete] : [complete];
  const results = await db.batch<JobRow>(statements);
  const row = results[results.length - 1]?.results[0];
  return row === undefined ? null : toJob(row);
}

/**
 * Claimed or running jobs whose worker is lost (M8.4): no heartbeat for `timeoutSeconds`, or
 * held by `claimingWorker`, which asks for a job only when it holds none, so a job it still
 * holds was lost when it restarted. Used by the sweep, which goes over every owner.
 */
export async function lostJobs(db: D1Database, timeoutSeconds: number, claimingWorker: string | null): Promise<Job[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM jobs
        WHERE status IN ${ACTIVE}
          AND ((julianday('now') - julianday(heartbeat_at)) * 86400 >= ? OR claimed_by = ?)
        ORDER BY created_at, id`,
    )
    .bind(timeoutSeconds, claimingWorker)
    .all<JobRow>();
  return results.map(toJob);
}

/**
 * Fails a lost job (M8.4) as a fault in ClearFEA, recording the time it is known to have had
 * the machine and no charge. Only while it has had no heartbeat since `job` was read, so a worker
 * that checks in again keeps its job. Returns the failed job, or null when it was not changed.
 */
export async function failLostJob(
  db: D1Database,
  job: Job,
  completion: Extract<Completion, { status: "failed" }>,
  billableMs: number,
  charge: JobCharge | null,
): Promise<Job | null> {
  if (charge?.charged) throw new Error("A lost job is a fault in ClearFEA and is never charged.");
  const row = await db
    .prepare(
      `UPDATE jobs
          SET status = 'failed', failure_category = ?, failure_cause = ?, failure_message = ?,
              finished_at = ${NOW}, billable_ms = ?, billed_seconds = ?, cost = ?
        WHERE id = ? AND status IN ${ACTIVE} AND claimed_by IS ? AND heartbeat_at IS ?
        RETURNING *`,
    )
    .bind(
      completion.failureCategory,
      completion.failureCause,
      completion.failureMessage,
      billableMs,
      charge?.billedSeconds ?? null,
      charge?.cost ?? null,
      job.id,
      job.claimedBy,
      job.heartbeatAt,
    )
    .first<JobRow>();
  return row === null ? null : toJob(row);
}

/**
 * Appends log text the worker sent with a heartbeat as the job's next chunk. The caller has
 * checked that this worker holds the job.
 */
export async function appendJobLog(db: D1Database, jobId: string, text: string): Promise<void> {
  if (text === "") return;
  await db
    .prepare(
      `INSERT INTO job_logs (job_id, seq, text)
       SELECT ?, COALESCE(MAX(seq), 0) + 1, ? FROM job_logs WHERE job_id = ?`,
    )
    .bind(jobId, text, jobId)
    .run();
}

/** Most log chunks one read returns; a client reads on from the `next` it gets back. */
export const LOG_CHUNKS_PER_READ = 100;

/** The user's job's log text after chunk `after`, and the chunk number to read on from. */
export async function readJobLog(
  db: D1Database,
  userId: string,
  jobId: string,
  after: number,
): Promise<{ text: string; next: number }> {
  const { results } = await db
    .prepare(
      `SELECT job_logs.seq, job_logs.text FROM job_logs JOIN jobs ON jobs.id = job_logs.job_id
        WHERE job_logs.job_id = ? AND jobs.owner_id = ? AND job_logs.seq > ?
        ORDER BY job_logs.seq LIMIT ?`,
    )
    .bind(jobId, userId, after, LOG_CHUNKS_PER_READ)
    .all<{ seq: number; text: string }>();
  return {
    text: results.map((r) => r.text).join(""),
    next: results.length === 0 ? after : (results[results.length - 1]?.seq ?? after),
  };
}
