// SPDX-License-Identifier: AGPL-3.0-or-later
// Solver machine starts on AWS (M10.7, ADR-100): what the launcher asked for and when each
// machine's worker last made contact. Configuration-level records, the same for every user, so
// not owner-scoped; the worker is the only caller that is not the launcher or the admin page.

/** Machines the launcher starts are called `aws-<start id>`, which ties their contact to the start. */
export const WORKER_PREFIX = "aws-";

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** Seconds a worker may be silent and still count as alive: a minute (ADR-095 item 6). */
export const ALIVE_SECONDS = 60;

/** Contact is written at most this often per machine; it polls every 2 s and beats every 5 s. */
const CONTACT_EVERY_SECONDS = 15;

export interface WorkerStart {
  id: string;
  machineSize: string;
  requestedAt: string;
  taskArn: string | null;
  problem: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

interface Row {
  id: string;
  machine_size: string;
  requested_at: string;
  task_arn: string | null;
  problem: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
}

function toStart(row: Row): WorkerStart {
  return {
    id: row.id,
    machineSize: row.machine_size,
    requestedAt: row.requested_at,
    taskArn: row.task_arn,
    problem: row.problem,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

/** ISO 8601 UTC with milliseconds, as the NOW expression writes it, so times compare as text. */
export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Records that the worker made contact (a claim or a heartbeat), when it is one the launcher
 * started. At most one write per machine every 15 s.
 */
export async function recordContact(db: D1Database, workerId: string, now = Date.now()): Promise<void> {
  if (!workerId.startsWith(WORKER_PREFIX)) return;
  await db
    .prepare(
      `UPDATE worker_starts
          SET first_seen_at = COALESCE(first_seen_at, ${NOW}), last_seen_at = ${NOW}
        WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < ?)`,
    )
    .bind(workerId.slice(WORKER_PREFIX.length), iso(now - CONTACT_EVERY_SECONDS * 1000))
    .run();
}

/** Starts requested since the given time, newest first, with every start whose worker is still in contact. */
export async function listStarts(db: D1Database, since: string): Promise<WorkerStart[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM worker_starts WHERE requested_at >= ? OR last_seen_at >= ?
        ORDER BY requested_at DESC, id DESC`,
    )
    .bind(since, since)
    .all<Row>();
  return results.map(toStart);
}

/**
 * Records a start of this size, unless `pendingLimit` or more starts of the size are already
 * pending (requested after `pendingSince`, not refused and not yet seen). One statement, so two
 * launchers running at once never start more than the limit. Returns the start's id, or null.
 */
export async function recordStart(
  db: D1Database,
  machineSize: string,
  pendingSince: string,
  pendingLimit: number,
): Promise<string | null> {
  const id = crypto.randomUUID();
  const inserted = await db
    .prepare(
      `INSERT INTO worker_starts (id, machine_size, requested_at)
       SELECT ?, ?, ${NOW}
        WHERE (SELECT COUNT(*) FROM worker_starts
                WHERE machine_size = ? AND requested_at >= ? AND problem IS NULL AND first_seen_at IS NULL) < ?`,
    )
    .bind(id, machineSize, machineSize, pendingSince, pendingLimit)
    .run();
  return inserted.meta.changes === 1 ? id : null;
}

/** Records what ECS answered: the task's ARN, or why it refused. */
export async function recordStartOutcome(
  db: D1Database,
  id: string,
  outcome: { taskArn: string } | { problem: string },
): Promise<void> {
  await db
    .prepare("UPDATE worker_starts SET task_arn = ?, problem = ? WHERE id = ?")
    .bind("taskArn" in outcome ? outcome.taskArn : null, "problem" in outcome ? outcome.problem.slice(0, 1000) : null, id)
    .run();
}
