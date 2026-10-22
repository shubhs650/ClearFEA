// SPDX-License-Identifier: AGPL-3.0-or-later
// Machine sizes (ADR-033, ADR-049): configuration, the same for every user, so not owner-scoped.
// The cloud size list (M10.6, ADR-099) says which of them the live site runs on AWS.

import type { CloudMachineSize } from "@clearfea/spec";
import type { MachineSize } from "../billing/estimate";
import type { Env } from "../env";

interface MachineSizeRow {
  name: string;
  cores: number;
  memory_bytes: number;
  rate_per_hour: number;
}

/**
 * Where jobs run: `cloud`, machines the launcher starts on AWS (M10.7, parked until production,
 * ADR-106); `vps`, the always-on solver host whose compute manager checks in (M12.4, ADR-120);
 * `local`, the local worker of `make dev`, which simulates every size. Unset or anything else is
 * local.
 */
export type MachineMode = "cloud" | "vps" | "local";

export function machineMode(env: Pick<Env, "MACHINES">): MachineMode {
  const value = env.MACHINES?.trim().toLowerCase();
  return value === "cloud" || value === "vps" ? value : "local";
}

/** True when the launcher starts cloud machines (`MACHINES=cloud`). */
export function cloudMachines(env: Pick<Env, "MACHINES">): boolean {
  return machineMode(env) === "cloud";
}

/** True when jobs run on the always-on solver host (`MACHINES=vps`). */
export function vpsMachines(env: Pick<Env, "MACHINES">): boolean {
  return machineMode(env) === "vps";
}

/**
 * True when runs are offered only the cloud sizes switched on: on cloud machines and on the
 * solver host, where a size sets a run's estimate and rate (ADR-107 item 5). Locally every size.
 */
export function switchedSizesOnly(env: Pick<Env, "MACHINES">): boolean {
  return machineMode(env) !== "local";
}

/** Every machine size a run may go on: on cloud machines, only the cloud sizes switched on. */
export async function listMachineSizes(db: D1Database, cloud = false): Promise<MachineSize[]> {
  const { results } = await db
    .prepare(
      `SELECT name, cores, memory_bytes, rate_per_hour FROM machine_sizes
        ${cloud ? "WHERE cloud = 'on'" : ""}
        ORDER BY rate_per_hour, name`,
    )
    .all<MachineSizeRow>();
  return results.map((row) => ({
    name: row.name,
    cores: row.cores,
    memoryBytes: row.memory_bytes,
    ratePerHour: row.rate_per_hour,
  }));
}

/** True when a machine size of this name exists. */
export async function machineSizeExists(db: D1Database, name: string): Promise<boolean> {
  return (await db.prepare("SELECT 1 FROM machine_sizes WHERE name = ?").bind(name).first()) !== null;
}

/** The cloud size list, smallest first, for the admin page. */
export async function listCloudSizes(db: D1Database): Promise<CloudMachineSize[]> {
  const { results } = await db
    .prepare(
      `SELECT name, cores, memory_bytes, cloud, is_default FROM machine_sizes
        WHERE cloud IS NOT NULL ORDER BY rate_per_hour, name`,
    )
    .all<{ name: string; cores: number; memory_bytes: number; cloud: "on" | "off"; is_default: number }>();
  return results.map((row) => ({
    name: row.name,
    cores: row.cores,
    memoryBytes: row.memory_bytes,
    enabled: row.cloud === "on",
    default: row.is_default === 1,
  }));
}

export type SwitchOutcome = "switched" | "not_cloud" | "default";

/**
 * Switches a cloud size on or off. The default size cannot be switched off: it runs every
 * import, mesh and report job (ADR-095 item 6).
 */
export async function switchCloudSize(db: D1Database, name: string, enabled: boolean): Promise<SwitchOutcome> {
  const row = await db
    .prepare("SELECT cloud, is_default FROM machine_sizes WHERE name = ?")
    .bind(name)
    .first<{ cloud: string | null; is_default: number }>();
  if (row === null || row.cloud === null) return "not_cloud";
  if (!enabled && row.is_default === 1) return "default";
  await db
    .prepare("UPDATE machine_sizes SET cloud = ? WHERE name = ?")
    .bind(enabled ? "on" : "off", name)
    .run();
  return "switched";
}
