// SPDX-License-Identifier: AGPL-3.0-or-later
// The solver host's check-ins (M12.4, ADR-120): configuration of the site, the same for every
// user, so not owner-scoped. Written by the compute manager through /internal/hosts/check-in.

import type { SolverHost } from "@clearfea/spec";
import { eventStatement } from "./events";

/** Seconds between the manager's check-ins. */
export const HOST_CHECK_IN_SECONDS = 30;

/** Seconds of silence after which the host counts as offline and new jobs are refused (ADR-106 item 3). */
export const HOST_SILENT_SECONDS = 120;

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const SILENT_SINCE = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${HOST_SILENT_SECONDS} seconds')`;

/**
 * Records a check-in. A host heard from again after a silence starts a new run of check-ins, so
 * the admin page can say since when it has been up. That, and a manager that started again while
 * the host stayed online (a new `startedAt`), are events (M13.1, ADR-125).
 */
export async function recordCheckIn(
  db: D1Database,
  host: string,
  managerVersion: string | null,
  startedAt: string | null = null,
): Promise<void> {
  const before = await db
    .prepare(`SELECT last_seen_at, manager_started_at, last_seen_at >= ${SILENT_SINCE} AS online FROM hosts WHERE name = ?`)
    .bind(host)
    .first<{ last_seen_at: string; manager_started_at: string | null; online: number }>();
  const statements = [
    db
      .prepare(
        `INSERT INTO hosts (name, first_seen_at, last_seen_at, manager_version, manager_started_at)
         VALUES (?, ${NOW}, ${NOW}, ?, ?)
         ON CONFLICT (name) DO UPDATE SET
           first_seen_at = CASE WHEN hosts.last_seen_at < ${SILENT_SINCE} THEN ${NOW} ELSE hosts.first_seen_at END,
           last_seen_at = ${NOW},
           manager_version = excluded.manager_version,
           manager_started_at = COALESCE(excluded.manager_started_at, hosts.manager_started_at)`,
      )
      .bind(host, managerVersion, startedAt),
  ];
  const version = managerVersion === null ? "" : ` (manager ${managerVersion})`;
  if (before === null || before.online !== 1) {
    statements.push(
      eventStatement(db, {
        kind: "host_online",
        level: "info",
        host,
        message:
          before === null
            ? `The solver host ${host} checked in for the first time${version}.`
            : `The solver host ${host} is online again${version}; it was last heard from at ${before.last_seen_at}.`,
        detail: { managerVersion, startedAt, lastSeenAt: before?.last_seen_at ?? null },
      }),
    );
  } else if (startedAt !== null && before.manager_started_at !== null && startedAt !== before.manager_started_at) {
    statements.push(
      eventStatement(db, {
        kind: "manager_started",
        level: "info",
        host,
        message: `The compute manager on ${host} restarted at ${startedAt}${version}; running jobs carry on in their containers.`,
        detail: { managerVersion, startedAt, previousStartedAt: before.manager_started_at },
      }),
    );
  }
  await db.batch(statements);
}

/** The host that checked in last, or null when none ever has. */
export async function latestHost(db: D1Database): Promise<SolverHost | null> {
  const row = await db
    .prepare(
      `SELECT name, first_seen_at, last_seen_at, manager_version, last_seen_at >= ${SILENT_SINCE} AS online
         FROM hosts ORDER BY last_seen_at DESC, name LIMIT 1`,
    )
    .first<{ name: string; first_seen_at: string; last_seen_at: string; manager_version: string | null; online: number }>();
  if (row === null) return null;
  return {
    host: row.name,
    online: row.online === 1,
    lastSeenAt: row.last_seen_at,
    firstSeenAt: row.first_seen_at,
    managerVersion: row.manager_version,
  };
}
