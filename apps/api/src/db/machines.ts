// SPDX-License-Identifier: AGPL-3.0-or-later
// Machine sizes (ADR-033, ADR-049): configuration, the same for every user, so not owner-scoped.

import type { MachineSize } from "../billing/estimate";

interface MachineSizeRow {
  name: string;
  cores: number;
  memory_bytes: number;
  rate_per_hour: number;
}

/** Every machine size a run may go on. */
export async function listMachineSizes(db: D1Database): Promise<MachineSize[]> {
  const { results } = await db
    .prepare("SELECT name, cores, memory_bytes, rate_per_hour FROM machine_sizes ORDER BY rate_per_hour, name")
    .all<MachineSizeRow>();
  return results.map((row) => ({
    name: row.name,
    cores: row.cores,
    memoryBytes: row.memory_bytes,
    ratePerHour: row.rate_per_hour,
  }));
}
