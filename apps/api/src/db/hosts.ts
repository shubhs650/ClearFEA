// SPDX-License-Identifier: AGPL-3.0-or-later
// The solver host's check-ins (M12.4, ADR-120): configuration of the site, the same for every
// user, so not owner-scoped. Written by the compute manager through /internal/hosts/check-in.

import type { SolverHost } from "@clearfea/spec";

/** Seconds between the manager's check-ins. */
export const HOST_CHECK_IN_SECONDS = 30;

/** Seconds of silence after which the host counts as offline and new jobs are refused (ADR-106 item 3). */
export const HOST_SILENT_SECONDS = 120;

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const SILENT_SINCE = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${HOST_SILENT_SECONDS} seconds')`;

/**
 * Records a check-in. A host heard from again after a silence starts a new run of check-ins, so
 * the admin page can say since when it has been up.
 */
export async function recordCheckIn(db: D1Database, host: string, managerVersion: string | null): Promise<void> {
  await db
    .prepare(
      `INSERT INTO hosts (name, first_seen_at, last_seen_at, manager_version) VALUES (?, ${NOW}, ${NOW}, ?)
       ON CONFLICT (name) DO UPDATE SET
         first_seen_at = CASE WHEN hosts.last_seen_at < ${SILENT_SINCE} THEN ${NOW} ELSE hosts.first_seen_at END,
         last_seen_at = ${NOW},
         manager_version = excluded.manager_version`,
    )
    .bind(host, managerVersion)
    .run();
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
