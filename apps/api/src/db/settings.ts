// SPDX-License-Identifier: AGPL-3.0-or-later
// Configuration values (docs/ARCHITECTURE.md section 4): rows of `settings`, set by migrations and
// changed with `wrangler d1 execute`, not by any route. Not user data, so not owner-scoped.

/** The storage rules (M8.6, ADR-086). */
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

/**
 * Seconds without a heartbeat after which a claimed or running job's worker counts as lost
 * (M8.4): the job is failed as a fault in ClearFEA.
 */
export async function heartbeatTimeoutSeconds(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT value FROM settings WHERE name = 'heartbeat_timeout_seconds'")
    .first<{ value: number }>();
  if (row === null) throw new Error("The setting heartbeat_timeout_seconds is missing; apply the migrations.");
  return row.value;
}

/** How solver machines are started on AWS (M10.7, ADR-100). */
export interface MachineSettings {
  /** Machine hours per calendar month (UTC) after which nothing more is started; 0 pauses the solver. */
  hoursCap: number;
  /** Seconds a start may take to produce a worker before it counts as failed. */
  startWaitSeconds: number;
  /** Machines running or starting at once, over all sizes. */
  maxRunning: number;
}

const MACHINE_NAMES = {
  hoursCap: "machine_hours_cap",
  startWaitSeconds: "machine_start_wait_seconds",
  maxRunning: "machine_max_running",
} as const satisfies Record<keyof MachineSettings, string>;

export async function machineSettings(db: D1Database): Promise<MachineSettings> {
  const { results } = await db
    .prepare("SELECT name, value FROM settings WHERE name IN (?, ?, ?)")
    .bind(MACHINE_NAMES.hoursCap, MACHINE_NAMES.startWaitSeconds, MACHINE_NAMES.maxRunning)
    .all<{ name: string; value: number }>();
  const value = (name: string) => {
    const row = results.find((r) => r.name === name);
    if (row === undefined) throw new Error(`The setting ${name} is missing; apply the migrations.`);
    return row.value;
  };
  return {
    hoursCap: value(MACHINE_NAMES.hoursCap),
    startWaitSeconds: value(MACHINE_NAMES.startWaitSeconds),
    maxRunning: value(MACHINE_NAMES.maxRunning),
  };
}

/** Sets the monthly machine-hours cap, from the admin page (DEPLOYMENT.md sections 7.4 and 7.6). */
export async function setMachineHoursCap(db: D1Database, hours: number): Promise<void> {
  await db.prepare("UPDATE settings SET value = ? WHERE name = ?").bind(hours, MACHINE_NAMES.hoursCap).run();
}
