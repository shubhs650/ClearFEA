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
 * The lane a job type runs in (M11.3, ADR-107, ADR-112): solve jobs in the solve lane, the rest
 * in the light lane. As SQL over a column holding the type, for queries that compare lanes.
 */
export type Lane = "solve" | "light";

export function laneOf(type: JobType): Lane {
  return type === "solve" ? "solve" : "light";
}

const laneSql = (column: string) => `CASE WHEN ${column} = 'solve' THEN 'solve' ELSE 'light' END`;

/** What the queue holds, for the limits a new job is checked against (M11.3, ADR-112). */
export interface QueueCounts {
  /** The user's jobs waiting in the lane. */
  userWaiting: number;
  /** Every user's waiting jobs, over both lanes. Only counted: nothing of other users' records is read. */
  allWaiting: number;
  /** The user's solve jobs queued since midnight UTC. */
  runsToday: number;
}

export async function queueCounts(db: D1Database, userId: string, lane: Lane): Promise<QueueCounts> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM jobs WHERE owner_id = ? AND status = 'queued' AND ${laneSql("type")} = ?) AS user_waiting,
         (SELECT COUNT(*) FROM jobs WHERE status = 'queued') AS all_waiting,
         (SELECT COUNT(*) FROM jobs WHERE owner_id = ? AND type = 'solve'
            AND created_at >= strftime('%Y-%m-%dT00:00:00Z', 'now')) AS runs_today`,
    )
    .bind(userId, lane, userId)
    .first<{ user_waiting: number; all_waiting: number; runs_today: number }>();
  if (row === null) throw new Error("Counting the queue returned no row.");
  return { userWaiting: row.user_waiting, allWaiting: row.all_waiting, runsToday: row.runs_today };
}

/**
 * Marks the oldest queued job of one of the given types as claimed by this
 * worker and returns it, or null when nothing is queued. A single UPDATE
 * statement, so two workers can never claim the same job. A worker that names
 * its machine size (M10.6, ADR-099) gets only jobs queued for that size, and the
 * default size's worker also gets the jobs that have no size (import, report).
 * A job whose owner already has `queue_running_per_user` jobs claimed or running in its lane is
 * passed over, so it waits behind other users' jobs (M11.3, ADR-107 item 4, ADR-112). Among the
 * rest, users with nothing running come first and users take turns, oldest job first within a
 * user (M12.1, ADR-121).
 */
export async function claimJob(
  db: D1Database,
  workerId: string,
  types: readonly JobType[],
  software: WorkerSoftware | null = null,
  machineSize: string | null = null,
): Promise<Job | null> {
  if (types.length === 0) return null;
  const placeholders = types.map(() => "?").join(", ");
  const forSize =
    machineSize === null
      ? { sql: "", values: [] }
      : {
          sql: `AND (machine_size = ? OR (machine_size IS NULL
                     AND ? = (SELECT name FROM machine_sizes WHERE is_default = 1)))`,
          values: [machineSize, machineSize],
        };
  const row = await db
    .prepare(
      `UPDATE jobs
         SET status = 'claimed', claimed_by = ?, claimed_at = ${NOW}, heartbeat_at = ${NOW},
             software = ?
       WHERE id = (
         SELECT id FROM jobs candidate
          WHERE status = 'queued' AND type IN (${placeholders}) ${forSize.sql}
            AND (SELECT COUNT(*) FROM jobs held
                  WHERE held.owner_id = candidate.owner_id AND held.status IN ${ACTIVE}
                    AND ${laneSql("held.type")} = ${laneSql("candidate.type")})
                < (SELECT value FROM settings WHERE name = 'queue_running_per_user')
          ORDER BY
            -- A user with a job active in either lane goes behind the others (ADR-107 item 4),
            EXISTS (SELECT 1 FROM jobs busy
                     WHERE busy.owner_id = candidate.owner_id AND busy.status IN ${ACTIVE}),
            -- then the user this lane served least recently goes first, so one user's queued
            -- jobs take turns with other users' (M12.1, ADR-121); a user never served is first,
            (SELECT MAX(served.claimed_at) FROM jobs served
              WHERE served.owner_id = candidate.owner_id AND served.claimed_at IS NOT NULL
                AND ${laneSql("served.type")} = ${laneSql("candidate.type")}),
            -- then first in, first out.
            created_at, id
          LIMIT 1
       )
       RETURNING *`,
    )
    .bind(workerId, software === null ? null : JSON.stringify(software), ...types, ...forSize.values)
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
 * Claimed or running jobs whose worker is lost (M8.4). Without `claimingWorker`: those with no
 * heartbeat for `timeoutSeconds`, from the per-minute cron. With it: only those held by that
 * worker, which asks for a job only when it holds none, so a job it still holds was lost when
 * it restarted (M11.3, ADR-112: a claim no longer looks over every worker's jobs). Used by the
 * sweep, which goes over every owner.
 */
export async function lostJobs(db: D1Database, timeoutSeconds: number, claimingWorker: string | null): Promise<Job[]> {
  const query =
    claimingWorker === null
      ? db
          .prepare(
            `SELECT * FROM jobs
              WHERE status IN ${ACTIVE} AND (julianday('now') - julianday(heartbeat_at)) * 86400 >= ?
              ORDER BY created_at, id`,
          )
          .bind(timeoutSeconds)
      : db
          .prepare(`SELECT * FROM jobs WHERE status IN ${ACTIVE} AND claimed_by = ? ORDER BY created_at, id`)
          .bind(claimingWorker);
  const { results } = await query.all<JobRow>();
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

/**
 * The user's job's log text after chunk `after`, the chunk number to read on from, and whether more
 * chunks were already written than one read returns (so a client asks again only then).
 */
export async function readJobLog(
  db: D1Database,
  userId: string,
  jobId: string,
  after: number,
): Promise<{ text: string; next: number; more: boolean }> {
  const { results } = await db
    .prepare(
      `SELECT job_logs.seq, job_logs.text FROM job_logs JOIN jobs ON jobs.id = job_logs.job_id
        WHERE job_logs.job_id = ? AND jobs.owner_id = ? AND job_logs.seq > ?
        ORDER BY job_logs.seq LIMIT ?`,
    )
    .bind(jobId, userId, after, LOG_CHUNKS_PER_READ + 1)
    .all<{ seq: number; text: string }>();
  const read = results.slice(0, LOG_CHUNKS_PER_READ);
  return {
    text: read.map((r) => r.text).join(""),
    next: read.length === 0 ? after : (read[read.length - 1]?.seq ?? after),
    more: results.length > LOG_CHUNKS_PER_READ,
  };
}

/** A queued job as the launcher sees it (M10.7): the machine size it needs and when it was queued. */
export interface QueuedJob {
  id: string;
  /** Its machine size, or the default size for a job that has none (import, report). */
  machineSize: string;
  createdAt: string;
}

/**
 * Every queued job, oldest first, for the launcher, which starts machines for all owners alike
 * (ADR-100). Only ids, sizes and times: nothing of a user's records leaves this query.
 */
export async function queuedJobs(db: D1Database): Promise<QueuedJob[]> {
  const { results } = await db
    .prepare(
      `SELECT id, created_at,
              COALESCE(machine_size, (SELECT name FROM machine_sizes WHERE is_default = 1)) AS size
         FROM jobs WHERE status = 'queued' ORDER BY created_at, id`,
    )
    .all<{ id: string; created_at: string; size: string | null }>();
  return results
    .filter((row) => row.size !== null)
    .map((row) => ({ id: row.id, machineSize: row.size as string, createdAt: row.created_at }));
}

/**
 * Where one of the user's queued jobs stands (M11.2, ADR-112): its place among the queued jobs of
 * its machine size, oldest first as `claimJob` takes them, and that size (the default size for a
 * job that has none, as in `queuedJobs`). On the solver host (`byLane`, M12.4, ADR-120) every job
 * of a lane waits for that lane whatever its size, so the place is among the queued jobs of its
 * lane. Other users' jobs are only counted. Null when the job is not the user's or no longer queued.
 */
export async function queuePlace(
  db: D1Database,
  userId: string,
  jobId: string,
  byLane = false,
): Promise<{ position: number; machineSize: string | null } | null> {
  const sameQueue = byLane
    ? `${laneSql("ahead.type")} = ${laneSql("jobs.type")}`
    : `COALESCE(ahead.machine_size, (SELECT name FROM lane))
                      IS COALESCE(jobs.machine_size, (SELECT name FROM lane))`;
  const row = await db
    .prepare(
      `WITH lane AS (SELECT name FROM machine_sizes WHERE is_default = 1)
       SELECT COALESCE(jobs.machine_size, (SELECT name FROM lane)) AS size,
              (SELECT COUNT(*) FROM jobs ahead
                WHERE ahead.status = 'queued'
                  AND ${sameQueue}
                  AND (ahead.created_at < jobs.created_at
                       OR (ahead.created_at = jobs.created_at AND ahead.id <= jobs.id))) AS position
         FROM jobs WHERE jobs.id = ? AND jobs.owner_id = ? AND jobs.status = 'queued'`,
    )
    .bind(jobId, userId)
    .first<{ size: string | null; position: number }>();
  return row === null ? null : { position: row.position, machineSize: row.size };
}

/**
 * Fails a job that is still queued, because no machine can run it (M10.7): a fault in ClearFEA,
 * never charged, since it never had a machine. Returns the failed job, or null when a worker
 * claimed it meanwhile.
 */
export async function failQueuedJob(
  db: D1Database,
  jobId: string,
  completion: Extract<Completion, { status: "failed" }>,
): Promise<Job | null> {
  const row = await db
    .prepare(
      `UPDATE jobs
          SET status = 'failed', failure_category = ?, failure_cause = ?, failure_message = ?,
              finished_at = ${NOW}, billable_ms = 0
        WHERE id = ? AND status = 'queued'
        RETURNING *`,
    )
    .bind(completion.failureCategory, completion.failureCause, completion.failureMessage, jobId)
    .first<JobRow>();
  return row === null ? null : toJob(row);
}
