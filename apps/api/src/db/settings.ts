// SPDX-License-Identifier: AGPL-3.0-or-later
// Configuration values (docs/ARCHITECTURE.md section 4): rows of `settings`, set by migrations and
// changed with `wrangler d1 execute`, not by any route. Not user data, so not owner-scoped.

/** The storage rules (M8.6, ADR-085). */
export interface StorageSettings {
  /** Bytes each user stores free of charge. */
  freeBytes: number;
  /** Days a run's raw solver output is kept after the run ends, unless the run is pinned. */
  retentionDays: number;
  /** Micro-credits per GiB per day stored above the free allowance. */
  ratePerGibDay: number;
}

const NAMES = {
  freeBytes: "storage_free_bytes",
  retentionDays: "raw_output_retention_days",
  ratePerGibDay: "storage_rate_per_gib_day",
} as const satisfies Record<keyof StorageSettings, string>;

export async function storageSettings(db: D1Database): Promise<StorageSettings> {
  const { results } = await db
    .prepare(`SELECT name, value FROM settings WHERE name IN (?, ?, ?)`)
    .bind(NAMES.freeBytes, NAMES.retentionDays, NAMES.ratePerGibDay)
    .all<{ name: string; value: number }>();
  const value = (name: string) => {
    const row = results.find((r) => r.name === name);
    if (row === undefined) throw new Error(`The setting ${name} is missing; apply the migrations.`);
    return row.value;
  };
  return {
    freeBytes: value(NAMES.freeBytes),
    retentionDays: value(NAMES.retentionDays),
    ratePerGibDay: value(NAMES.ratePerGibDay),
  };
}

/** SQL for the retention days, for queries that work out when a run's raw output expires. */
export const RETENTION_DAYS_SQL = `(SELECT value FROM settings WHERE name = '${NAMES.retentionDays}')`;
