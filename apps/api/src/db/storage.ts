// SPDX-License-Identifier: AGPL-3.0-or-later
// Storage per user (M8.6, ADR-085): what each user keeps in R2, measured from the files
// themselves under owners/<id>/, and the daily sweep that removes raw solver output past its
// retention period and charges storage above the free allowance. Reads are owner-scoped; the
// sweep is the one caller that goes over every user, and it runs only from the scheduled handler.

import type { RunFileName, StorageKind, StoragePart } from "@clearfea/spec";
import { storageDayCost } from "../billing/storage";
import { RAW_OUTPUT, runKey } from "./runs";
import { storageSettings } from "./settings";

/** The kind of a stored file, from its key below owners/<id>/ (see the key functions in db/). */
export function storageKind(relativeKey: string): StorageKind {
  const [area, , name, ...rest] = relativeKey.split("/");
  if (area === "geometries") return "geometry";
  if (area === "meshes") return "mesh";
  if (area === "report") return "report";
  if (area === "runs") {
    if (name === "figures" || name === "reports") return "report";
    if (rest.length === 0 && (RAW_OUTPUT as readonly string[]).includes(name ?? "")) return "rawOutput";
    return "results";
  }
  // Nothing else is written under owners/<id>/; count anything that is as results, so it is
  // still measured and charged.
  return "results";
}

const KINDS: readonly StorageKind[] = ["geometry", "mesh", "results", "rawOutput", "report"];

export interface StorageUse {
  usedBytes: number;
  /** One entry per kind, in the order of StorageKind. */
  parts: StoragePart[];
  /** Bytes of raw solver output per run id. */
  rawBytesByRun: Map<string, number>;
}

/** Every file kept for the user, listed from R2 and added up by kind. */
export async function measureStorage(files: R2Bucket, userId: string): Promise<StorageUse> {
  const prefix = `owners/${userId}/`;
  const parts = new Map<StorageKind, StoragePart>(KINDS.map((kind) => [kind, { kind, bytes: 0, files: 0 }]));
  const rawBytesByRun = new Map<string, number>();
  let usedBytes = 0;
  let cursor: string | undefined;
  do {
    const page = await files.list({ prefix, cursor, limit: 1000 });
    for (const object of page.objects) {
      const relative = object.key.slice(prefix.length);
      const kind = storageKind(relative);
      const part = parts.get(kind);
      if (part === undefined) throw new Error(`No storage part for ${kind}.`);
      part.bytes += object.size;
      part.files += 1;
      usedBytes += object.size;
      if (kind === "rawOutput") {
        const runId = relative.split("/")[1] ?? "";
        rawBytesByRun.set(runId, (rawBytesByRun.get(runId) ?? 0) + object.size);
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  return { usedBytes, parts: [...parts.values()], rawBytesByRun };
}

export interface RawOutputRun {
  id: string;
  simulationId: string;
  simulationName: string;
  startedAt: string;
  pinned: boolean;
  finishedAt: string | null;
  files: RunFileName[];
}

/** The user's runs whose raw solver output has not been removed, newest first. */
export async function runsWithRawOutput(db: D1Database, userId: string): Promise<RawOutputRun[]> {
  const { results } = await db
    .prepare(
      `SELECT runs.id, runs.simulation_id, simulations.name AS simulation_name, runs.created_at,
              runs.pinned, runs.finished_at, runs.files
         FROM runs JOIN simulations ON simulations.id = runs.simulation_id AND simulations.owner_id = runs.owner_id
        WHERE runs.owner_id = ? AND runs.raw_removed_at IS NULL
          AND EXISTS (SELECT 1 FROM json_each(runs.files) f WHERE f.value IN ('results.frd', 'results.dat'))
        ORDER BY runs.created_at DESC, runs.id DESC`,
    )
    .bind(userId)
    .all<{
      id: string;
      simulation_id: string;
      simulation_name: string;
      created_at: string;
      pinned: number;
      finished_at: string | null;
      files: string;
    }>();
  return results.map((row) => ({
    id: row.id,
    simulationId: row.simulation_id,
    simulationName: row.simulation_name,
    startedAt: row.created_at,
    pinned: row.pinned === 1,
    finishedAt: row.finished_at,
    files: JSON.parse(row.files) as RunFileName[],
  }));
}

export interface SweepSummary {
  /** The UTC day the sweep charged for. */
  day: string;
  /** Runs whose raw output the sweep removed. */
  removed: number;
  /** Users charged for storage above the allowance on this day by this sweep. */
  charged: number;
}

/**
 * The daily storage sweep. First removes the raw solver output of every unpinned run that
 * ended at least the retention period before `now`; then measures each user's storage and
 * charges the day's cost of what is above the free allowance, once per user per UTC day, so
 * running the sweep again on the same day changes nothing.
 */
export async function sweepStorage(db: D1Database, files: R2Bucket, now: Date): Promise<SweepSummary> {
  const settings = await storageSettings(db);
  const stamp = now.toISOString();
  const day = stamp.slice(0, 10);
  const cutoff = new Date(now.getTime() - settings.retentionDays * 86_400_000).toISOString();
  const { results: expired } = await db
    .prepare(
      `SELECT id, owner_id FROM runs
        WHERE pinned = 0 AND raw_removed_at IS NULL AND finished_at IS NOT NULL AND finished_at <= ?
          AND EXISTS (SELECT 1 FROM json_each(runs.files) f WHERE f.value IN ('results.frd', 'results.dat'))`,
    )
    .bind(cutoff)
    .all<{ id: string; owner_id: string }>();
  let removed = 0;
  for (const run of expired) {
    // Marked first, and only while still unpinned: a pin that lands meanwhile wins, and a pin
    // after this point is refused, so a pinned run never loses its output.
    const marked = await db
      .prepare(`UPDATE runs SET raw_removed_at = ? WHERE id = ? AND pinned = 0 AND raw_removed_at IS NULL`)
      .bind(stamp, run.id)
      .run();
    if (marked.meta.changes !== 1) continue;
    await files.delete(RAW_OUTPUT.map((name) => runKey(run.owner_id, run.id, name)));
    removed += 1;
  }
  const { results: users } = await db.prepare("SELECT id FROM users ORDER BY id").all<{ id: string }>();
  let charged = 0;
  for (const user of users) {
    const { usedBytes } = await measureStorage(files, user.id);
    const amount = storageDayCost(usedBytes, settings.freeBytes, settings.ratePerGibDay);
    if (amount === 0) continue;
    const notYet = "NOT EXISTS (SELECT 1 FROM storage_charges WHERE owner_id = ? AND day = ?)";
    const [entry] = await db.batch([
      db
        .prepare(
          `INSERT INTO ledger_entries (owner_id, amount, balance, reason)
           SELECT ?, ?, COALESCE((SELECT l.balance FROM ledger_entries l
                                   WHERE l.owner_id = ? ORDER BY l.seq DESC LIMIT 1), 0) - ?, 'storage'
            WHERE ${notYet}`,
        )
        .bind(user.id, -amount, user.id, amount, user.id, day),
      db
        .prepare(
          `INSERT INTO storage_charges (owner_id, day, used_bytes, free_bytes, rate_per_gib_day, amount, ledger_seq)
           SELECT ?, ?, ?, ?, ?, ?, last_insert_rowid() WHERE ${notYet}`,
        )
        .bind(user.id, day, usedBytes, settings.freeBytes, settings.ratePerGibDay, amount, user.id, day),
    ]);
    if (entry?.meta.changes === 1) charged += 1;
  }
  return { day, removed, charged };
}
