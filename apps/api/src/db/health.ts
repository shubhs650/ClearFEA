// SPDX-License-Identifier: AGPL-3.0-or-later
// Liveness probes for the database and file storage. These read no user data,
// so they are the only data-access functions that take no user id.

export type ProbeResult = { ok: true } | { ok: false; problem: string };

export async function probeDatabase(db: D1Database): Promise<ProbeResult> {
  try {
    await db.prepare("SELECT 1 FROM projects LIMIT 1").all();
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("no such table")) {
      return {
        ok: false,
        problem:
          "The database has no tables yet. Run `pnpm --filter @clearfea/api db:migrate` and restart the API.",
      };
    }
    return { ok: false, problem: `The database could not be queried: ${message}` };
  }
}

export async function probeStorage(files: R2Bucket): Promise<ProbeResult> {
  try {
    await files.head("health-check");
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, problem: `File storage could not be reached: ${message}` };
  }
}
