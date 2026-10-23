// SPDX-License-Identifier: AGPL-3.0-or-later
// Configuration values (docs/ARCHITECTURE.md section 4): rows of `settings`, set by migrations and
// changed by the admin on the dashboard's Settings tab (M13.3, ADR-128) or with `wrangler d1 execute`.
// Not user data, so not owner-scoped.

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

/** What one user, and everyone together, may queue (M11.3, ADR-112). */
export interface QueueLimits {
  /** Jobs one user may have waiting in each lane. */
  waitingPerUser: number;
  /** Runs one user may start per calendar day (UTC). */
  runsPerDay: number;
  /** Jobs waiting over all users and lanes. */
  totalCap: number;
}

const QUEUE_NAMES = {
  waitingPerUser: "queue_waiting_per_user",
  runsPerDay: "runs_per_user_per_day",
  totalCap: "queue_total_cap",
} as const satisfies Record<keyof QueueLimits, string>;

export async function queueLimits(db: D1Database): Promise<QueueLimits> {
  const { results } = await db
    .prepare("SELECT name, value FROM settings WHERE name IN (?, ?, ?)")
    .bind(QUEUE_NAMES.waitingPerUser, QUEUE_NAMES.runsPerDay, QUEUE_NAMES.totalCap)
    .all<{ name: string; value: number }>();
  const value = (name: string) => {
    const row = results.find((r) => r.name === name);
    if (row === undefined) throw new Error(`The setting ${name} is missing; apply the migrations.`);
    return row.value;
  };
  return {
    waitingPerUser: value(QUEUE_NAMES.waitingPerUser),
    runsPerDay: value(QUEUE_NAMES.runsPerDay),
    totalCap: value(QUEUE_NAMES.totalCap),
  };
}

/** Days a project or folder stays in the trash before the storage sweep purges it (M14.2, ADR-124). */
export async function trashRetentionDays(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT value FROM settings WHERE name = 'trash_retention_days'")
    .first<{ value: number }>();
  if (row === null) throw new Error("The setting trash_retention_days is missing; apply the migrations.");
  return row.value;
}

/**
 * Whether the admin has paused the queue (M13.2, ADR-127): no worker claims a job while it is, so
 * nothing new starts; running jobs finish and new jobs still queue. As SQL for the claim.
 */
export const QUEUE_PAUSED_SQL = "(SELECT value FROM settings WHERE name = 'queue_paused')";

export async function queuePaused(db: D1Database): Promise<boolean> {
  const row = await db.prepare(`SELECT ${QUEUE_PAUSED_SQL} AS value`).first<{ value: number | null }>();
  if (row === null || row.value === null) throw new Error("The setting queue_paused is missing; apply the migrations.");
  return row.value !== 0;
}

/** Pauses or resumes the queue, from the dashboard. Returns false when it already was so. */
export async function setQueuePaused(db: D1Database, paused: boolean): Promise<boolean> {
  const result = await db
    .prepare("UPDATE settings SET value = ? WHERE name = 'queue_paused' AND value != ?")
    .bind(paused ? 1 : 0, paused ? 1 : 0)
    .run();
  return result.meta.changes === 1;
}

/** The groups the dashboard's Settings tab shows the settings in (M13.3, ADR-128). */
export type SettingGroup = "accounts" | "queue" | "storage" | "machines" | "costs" | "alerts";

/**
 * A setting the admin may change on the dashboard: its row name, where and how it is shown, and
 * the stored values allowed. The stored value is a whole number (bytes, seconds, days,
 * micro-credits, cents); it is shown divided by `scale` in `unit`.
 */
export interface SettingDefinition {
  name: string;
  group: SettingGroup;
  label: string;
  description: string;
  unit: string;
  scale: number;
  min: number;
  max: number;
}

const MICRO = 1_000_000;
const GIB = 2 ** 30;

/**
 * Every row of `settings` the dashboard edits, in the order it shows them. `queue_paused` is left
 * out: the Overview's Pause and Resume set it (ADR-127). A new setting goes here with its
 * migration; a test checks that every row is listed.
 */
export const SETTINGS: readonly SettingDefinition[] = [
  {
    name: "signup_grant_micro_credits",
    group: "accounts",
    label: "Credits for a new user",
    description:
      "Play-money credits each user gets at their first sign-in. During the closed beta the wallet shows usage only and refuses nothing.",
    unit: "credits",
    scale: MICRO,
    min: 0,
    max: 1_000_000 * MICRO,
  },
  {
    name: "queue_waiting_per_user",
    group: "queue",
    label: "Jobs waiting per user and lane",
    description: "One more is refused until one of them starts.",
    unit: "jobs",
    scale: 1,
    min: 1,
    max: 100,
  },
  {
    name: "queue_running_per_user",
    group: "queue",
    label: "Jobs running per user and lane",
    description: "The user's next job waits behind other users' jobs.",
    unit: "jobs",
    scale: 1,
    min: 1,
    max: 10,
  },
  {
    name: "runs_per_user_per_day",
    group: "queue",
    label: "Runs per user per day",
    description: "New runs and runs again alike, per calendar day (UTC).",
    unit: "runs",
    scale: 1,
    min: 1,
    max: 10_000,
  },
  {
    name: "queue_total_cap",
    group: "queue",
    label: "Jobs waiting in all",
    description: "Over all users and lanes; one more is refused until the queue drains.",
    unit: "jobs",
    scale: 1,
    min: 1,
    max: 10_000,
  },
  {
    name: "heartbeat_timeout_seconds",
    group: "queue",
    label: "Silence before a worker counts as lost",
    description:
      "A held job whose worker sends no heartbeat for this long is ended as a fault in ClearFEA, or queued again (ADR-122). Workers send one every 5 s.",
    unit: "s",
    scale: 1,
    min: 30,
    max: 3600,
  },
  {
    name: "storage_free_bytes",
    group: "storage",
    label: "Free storage per user",
    description: "Stored files above this are charged once a day.",
    unit: "GiB",
    scale: GIB,
    min: 0,
    max: 1024 * GIB,
  },
  {
    name: "storage_rate_per_gib_day",
    group: "storage",
    label: "Storage rate above the free amount",
    description: "Charged by the daily storage sweep.",
    unit: "credits per GiB per day",
    scale: MICRO,
    min: 0,
    max: 100 * MICRO,
  },
  {
    name: "raw_output_retention_days",
    group: "storage",
    label: "Days raw solver output is kept",
    description:
      "After a run ends, unless its owner pins it. Lowering it removes older output at the next daily sweep, and it cannot be brought back.",
    unit: "days",
    scale: 1,
    min: 1,
    max: 3650,
  },
  {
    name: "trash_retention_days",
    group: "storage",
    label: "Days in the trash",
    description:
      "Projects and folders in the trash longer than this are deleted for good, with their files, at the next daily sweep.",
    unit: "days",
    scale: 1,
    min: 1,
    max: 3650,
  },
  {
    name: "machine_hours_cap",
    group: "machines",
    label: "Monthly limit of machine hours",
    description:
      "Cloud machines only (MACHINES=cloud): once reached, no machine is started and new runs and meshes are refused until the 1st. 0 pauses the solver.",
    unit: "h",
    scale: 1,
    min: 0,
    max: 744,
  },
  {
    name: "machine_start_wait_seconds",
    group: "machines",
    label: "Time a machine may take to start",
    description: "Cloud machines only: a start that produces no worker in this time counts as failed.",
    unit: "s",
    scale: 1,
    min: 60,
    max: 3600,
  },
  {
    name: "machine_max_running",
    group: "machines",
    label: "Machines at once",
    description: "Cloud machines only: running or starting, over all sizes.",
    unit: "machines",
    scale: 1,
    min: 1,
    max: 20,
  },
  {
    name: "solver_host_monthly_cents",
    group: "costs",
    label: "Solver host per month",
    description: "What the VPS costs each month, used or not. Shown on the Costs tab only.",
    unit: "USD",
    scale: 100,
    min: 0,
    max: 10_000_000,
  },
  {
    name: "platform_monthly_cents",
    group: "costs",
    label: "Cloudflare per month",
    description: "Workers Paid, with D1 and R2 inside the included amounts. Shown on the Costs tab only.",
    unit: "USD",
    scale: 100,
    min: 0,
    max: 10_000_000,
  },
  {
    name: "alert_disk_free_bytes",
    group: "alerts",
    label: "Disk low below",
    description:
      "Free space on the solver host's scratch disk below which the Overview alerts. The lanes stop taking jobs at the host's CLEARFEA_SCRATCH_MIN_FREE (20 GiB by default).",
    unit: "GiB",
    scale: GIB,
    min: 0,
    max: 10_240 * GIB,
  },
  {
    name: "alert_window_hours",
    group: "alerts",
    label: "Hours the failure alerts look back",
    description: "Tries that ran out of memory or ended by a fault in ClearFEA count while they are this recent.",
    unit: "h",
    scale: 1,
    min: 1,
    max: 720,
  },
  {
    name: "alert_platform_failures",
    group: "alerts",
    label: "Platform failures that alert",
    description:
      "Tries ended by a fault in ClearFEA (a lost worker, a crashed container, an internal error) within the hours above that raise an alert. The admin's cancels and re-queues do not count.",
    unit: "tries",
    scale: 1,
    min: 1,
    max: 1000,
  },
];

/** The thresholds of the dashboard's alerts (M13.5, ADR-130). */
export interface AlertSettings {
  /** Free bytes on the solver host's disk below which the disk counts as low. */
  diskFreeBytes: number;
  /** Hours back that tries out of memory and platform faults are counted over. */
  windowHours: number;
  /** Platform faults within the window that alert. */
  platformFailures: number;
}

const ALERT_NAMES = {
  diskFreeBytes: "alert_disk_free_bytes",
  windowHours: "alert_window_hours",
  platformFailures: "alert_platform_failures",
} as const satisfies Record<keyof AlertSettings, string>;

export async function alertSettings(db: D1Database): Promise<AlertSettings> {
  const { results } = await db
    .prepare("SELECT name, value FROM settings WHERE name IN (?, ?, ?)")
    .bind(ALERT_NAMES.diskFreeBytes, ALERT_NAMES.windowHours, ALERT_NAMES.platformFailures)
    .all<{ name: string; value: number }>();
  const value = (name: string) => {
    const row = results.find((r) => r.name === name);
    if (row === undefined) throw new Error(`The setting ${name} is missing; apply the migrations.`);
    return row.value;
  };
  return {
    diskFreeBytes: value(ALERT_NAMES.diskFreeBytes),
    windowHours: value(ALERT_NAMES.windowHours),
    platformFailures: value(ALERT_NAMES.platformFailures),
  };
}

/** The dashboard's settings with their stored values, in the order of SETTINGS. */
export async function listSettings(db: D1Database): Promise<(SettingDefinition & { value: number })[]> {
  const { results } = await db.prepare("SELECT name, value FROM settings").all<{ name: string; value: number }>();
  const values = new Map(results.map((row) => [row.name, row.value]));
  return SETTINGS.map((definition) => {
    const value = values.get(definition.name);
    if (value === undefined) throw new Error(`The setting ${definition.name} is missing; apply the migrations.`);
    return { ...definition, value };
  });
}

/**
 * Sets one of the dashboard's settings, from the Settings tab. Returns the value it had, or null
 * when it already had this one (so an unchanged value is not recorded as a change).
 */
export async function setSetting(db: D1Database, name: string, value: number): Promise<number | null> {
  const row = await db.prepare("SELECT value FROM settings WHERE name = ?").bind(name).first<{ value: number }>();
  if (row === null) throw new Error(`The setting ${name} is missing; apply the migrations.`);
  if (row.value === value) return null;
  await db.prepare("UPDATE settings SET value = ? WHERE name = ?").bind(value, name).run();
  return row.value;
}

/** The solver host's and Cloudflare's monthly costs in US cents, for the Costs tab (M13.3). */
export async function fixedCosts(db: D1Database): Promise<{ solverHostCents: number; platformCents: number }> {
  const { results } = await db
    .prepare("SELECT name, value FROM settings WHERE name IN ('solver_host_monthly_cents', 'platform_monthly_cents')")
    .all<{ name: string; value: number }>();
  const value = (name: string) => {
    const row = results.find((r) => r.name === name);
    if (row === undefined) throw new Error(`The setting ${name} is missing; apply the migrations.`);
    return row.value;
  };
  return { solverHostCents: value("solver_host_monthly_cents"), platformCents: value("platform_monthly_cents") };
}
