// SPDX-License-Identifier: AGPL-3.0-or-later
// The event log (M13.1, ADR-113, ADR-125): sign-ins and refusals, jobs that failed or were queued
// again, the solver host and its manager, and the admin's actions. Written wherever these happen,
// for every owner, and read by the admin only, so not owner-scoped. Messages and details carry ids,
// addresses and plain words, never a project's name, model or results.

import type { AdminEvent } from "@clearfea/spec";
import type { Completion, Job } from "./jobs";

export type EventKind = AdminEvent["kind"];
export type EventLevel = AdminEvent["level"];

export interface NewEvent {
  kind: EventKind;
  level: EventLevel;
  message: string;
  userId?: string | null;
  jobId?: string | null;
  host?: string | null;
  detail?: Record<string, unknown> | null;
}

/** The statement that records an event, for a batch with the change it records. */
export function eventStatement(db: D1Database, event: NewEvent): D1PreparedStatement {
  return db
    .prepare("INSERT INTO events (kind, level, user_id, job_id, host, message, detail) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(
      event.kind,
      event.level,
      event.userId ?? null,
      event.jobId ?? null,
      event.host ?? null,
      event.message,
      event.detail == null ? null : JSON.stringify(event.detail),
    );
}

export async function recordEvent(db: D1Database, event: NewEvent): Promise<void> {
  await eventStatement(db, event).run();
}

/** An action of the admin, for the audit trail. */
export async function recordAdminAction(
  db: D1Database,
  adminId: string,
  message: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await recordEvent(db, { kind: "admin_action", level: "info", userId: adminId, message, detail });
}

const JOB_NAME: Record<Job["type"], string> = {
  noop: "A no-op job",
  import: "An import",
  mesh: "A mesh job",
  solve: "A solve",
  report: "A report job",
};

/**
 * A job that ended failed: info when the user's setup or file caused it, an error when ClearFEA
 * did. Other endings (success, cancel, stop limit) are not events.
 */
export async function recordJobFailed(db: D1Database, job: Job, completion: Completion): Promise<void> {
  if (completion.status !== "failed") return;
  const ours = completion.failureCategory === "platform_fault";
  const tries = job.attempt > 1 ? ` on try ${job.attempt}` : "";
  await recordEvent(db, {
    kind: "job_failed",
    level: ours ? "error" : "info",
    userId: job.ownerId,
    jobId: job.id,
    message: `${JOB_NAME[job.type]} failed${tries}: ${ours ? "a fault in ClearFEA" : "the user's setup"} (${completion.failureCause}).`,
    detail: {
      type: job.type,
      targetId: job.targetId,
      attempt: job.attempt,
      worker: job.claimedBy,
      category: completion.failureCategory,
      cause: completion.failureCause,
      failureMessage: completion.failureMessage,
    },
  });
}

/** A try a machine fault ended, after which the job was queued again (ADR-108). */
export async function recordJobRetried(db: D1Database, job: Job, cause: string, maxAttempts: number): Promise<void> {
  await recordEvent(db, {
    kind: "job_retried",
    level: "warning",
    userId: job.ownerId,
    jobId: job.id,
    message: `${JOB_NAME[job.type]} was queued again after try ${job.attempt} of ${maxAttempts} stopped (${cause}).`,
    detail: { type: job.type, targetId: job.targetId, attempt: job.attempt, worker: job.claimedBy, cause },
  });
}

/**
 * Records host_offline once for each host silent for `silentSeconds`, the first time the
 * per-minute cron sees it so. Returns the hosts it recorded.
 */
export async function recordSilentHosts(db: D1Database, silentSeconds: number): Promise<string[]> {
  const { results } = await db
    .prepare(
      `INSERT INTO events (kind, level, host, message, detail)
       SELECT 'host_offline', 'error', name,
              'The solver host ' || name || ' has not checked in since ' || last_seen_at ||
                '. New jobs are refused until it does; restart it by hand.',
              json_object('lastSeenAt', last_seen_at)
         FROM hosts
        WHERE last_seen_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${silentSeconds} seconds')
          AND NOT EXISTS (SELECT 1 FROM events e WHERE e.kind = 'host_offline' AND e.host = hosts.name
                            AND e.at >= hosts.last_seen_at)
       RETURNING host`,
    )
    .all<{ host: string }>();
  return results.map((r) => r.host);
}

export interface EventFilter {
  kind?: string;
  level?: string;
  userId?: string;
  since?: string;
  before?: string;
  limit: number;
}

interface EventRow {
  id: number;
  at: string;
  kind: EventKind;
  level: EventLevel;
  user_id: string | null;
  job_id: string | null;
  host: string | null;
  message: string;
  detail: string | null;
}

/** Events newest first. */
export async function listEvents(db: D1Database, filter: EventFilter): Promise<AdminEvent[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    where.push(clause);
    values.push(value);
  };
  if (filter.kind !== undefined) add("kind = ?", filter.kind);
  if (filter.level !== undefined) add("level = ?", filter.level);
  if (filter.userId !== undefined) add("user_id = ?", filter.userId);
  if (filter.since !== undefined) add("at >= ?", filter.since);
  if (filter.before !== undefined) add("at < ?", filter.before);
  const { results } = await db
    .prepare(
      `SELECT * FROM events ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY at DESC, id DESC LIMIT ?`,
    )
    .bind(...values, filter.limit)
    .all<EventRow>();
  return results.map((row) => ({
    id: row.id,
    at: row.at,
    kind: row.kind,
    level: row.level,
    userId: row.user_id,
    jobId: row.job_id,
    host: row.host,
    message: row.message,
    detail: row.detail === null ? null : (JSON.parse(row.detail) as Record<string, unknown>),
  }));
}
