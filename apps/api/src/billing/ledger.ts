// SPDX-License-Identifier: AGPL-3.0-or-later
// The ledger (docs/ARCHITECTURE.md sections 4 and 6, ADR-033): append-only entries with the
// owner's running balance. Nothing here updates or deletes an entry. Reads are owner-scoped;
// a charge is written for a job the worker holds, in the same batch that completes the job.
// Play-money grants (M8.1, ADR-080) are written by the seed, never by a route.

import type { LedgerReason, LedgerRun, WalletEntry, WalletView } from "@clearfea/spec";

export interface LedgerEntry {
  seq: number;
  /** Micro-credits; a charge is negative. */
  amount: number;
  /** The owner's balance after this entry, in micro-credits. */
  balance: number;
  reason: string;
  jobId: string | null;
  createdAt: string;
}

interface LedgerRow {
  seq: number;
  amount: number;
  balance: number;
  reason: string;
  job_id: string | null;
  created_at: string;
}

/**
 * The statement that charges `cost` micro-credits for a job, written only while `workerId`
 * still holds the job (so it runs once, together with the completion that follows it in the
 * same batch). The balance is the owner's previous balance minus the cost.
 */
export function chargeStatement(
  db: D1Database,
  workerId: string,
  jobId: string,
  cost: number,
  activeStatuses: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO ledger_entries (owner_id, amount, balance, reason, job_id)
       SELECT jobs.owner_id, ?,
              COALESCE((SELECT l.balance FROM ledger_entries l
                         WHERE l.owner_id = jobs.owner_id ORDER BY l.seq DESC LIMIT 1), 0) - ?,
              jobs.type, jobs.id
         FROM jobs WHERE jobs.id = ? AND jobs.claimed_by = ? AND jobs.status IN ${activeStatuses}`,
    )
    .bind(-cost, cost, jobId, workerId);
}

/** The user's ledger entries, oldest first. */
export async function listLedger(db: D1Database, userId: string): Promise<LedgerEntry[]> {
  const { results } = await db
    .prepare("SELECT * FROM ledger_entries WHERE owner_id = ? ORDER BY seq")
    .bind(userId)
    .all<LedgerRow>();
  return results.map((row) => ({
    seq: row.seq,
    amount: row.amount,
    balance: row.balance,
    reason: row.reason,
    jobId: row.job_id,
    createdAt: row.created_at,
  }));
}

/** The user's balance: their last entry's balance, 0 before any entry. */
export async function balanceOf(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare("SELECT balance FROM ledger_entries WHERE owner_id = ? ORDER BY seq DESC LIMIT 1")
    .bind(userId)
    .first<{ balance: number }>();
  return row?.balance ?? 0;
}

interface WalletRow extends LedgerRow {
  machine_size: string | null;
  rate_per_hour: number | null;
  billed_seconds: number | null;
  run_id: string | null;
  run_status: LedgerRun["status"] | null;
  run_created_at: string | null;
  simulation_id: string | null;
  simulation_name: string | null;
  mesh_id: string | null;
  mesh_elements: number | null;
  mesh_nodes: number | null;
  geometry_name: string | null;
}

/**
 * The user's wallet (M8.1, ADR-080): every ledger entry, newest first, with the job, run or mesh
 * it paid for. Every join is on the owner too, so nothing of another user's can be named here.
 */
export async function walletOf(db: D1Database, userId: string): Promise<WalletView> {
  const { results } = await db
    .prepare(
      `SELECT l.seq, l.amount, l.balance, l.reason, l.job_id, l.created_at,
              j.machine_size, j.rate_per_hour, j.billed_seconds,
              r.id AS run_id,
              -- A cancelled run is 'failed' in its table; its job says it was cancelled (ADR-084).
              CASE WHEN r.status = 'failed' AND j.status = 'cancelled' THEN 'cancelled' ELSE r.status END AS run_status, r.created_at AS run_created_at,
              s.id AS simulation_id, s.name AS simulation_name,
              m.id AS mesh_id, m.element_count AS mesh_elements, m.node_count AS mesh_nodes,
              g.name AS geometry_name
         FROM ledger_entries l
         LEFT JOIN jobs j ON j.id = l.job_id AND j.owner_id = l.owner_id
         LEFT JOIN runs r ON j.type = 'solve' AND r.job_id = j.id AND r.owner_id = l.owner_id
         LEFT JOIN simulations s ON s.id = r.simulation_id AND s.owner_id = l.owner_id
         LEFT JOIN meshes m ON j.type = 'mesh' AND m.id = j.target_id AND m.owner_id = l.owner_id
         LEFT JOIN geometries g ON g.id = m.geometry_id AND g.owner_id = l.owner_id
        WHERE l.owner_id = ?
        ORDER BY l.seq DESC`,
    )
    .bind(userId)
    .all<WalletRow>();
  const entries = results.map(walletEntry);
  const granted = entries.filter((e) => e.amount > 0).reduce((sum, e) => sum + e.amount, 0);
  const charged = entries.filter((e) => e.amount < 0).reduce((sum, e) => sum + e.amount, 0);
  return { balance: entries[0]?.balance ?? 0, granted, charged, entries };
}

function walletEntry(row: WalletRow): WalletEntry {
  return {
    seq: row.seq,
    createdAt: row.created_at,
    reason: row.reason as LedgerReason,
    amount: row.amount,
    balance: row.balance,
    job:
      row.job_id === null || row.machine_size === null
        ? null
        : {
            id: row.job_id,
            machineSize: row.machine_size,
            ratePerHour: row.rate_per_hour ?? 0,
            billedSeconds: row.billed_seconds ?? 0,
          },
    run:
      row.run_id === null || row.run_status === null
        ? null
        : {
            id: row.run_id,
            simulationId: row.simulation_id ?? "",
            simulationName: row.simulation_name ?? "",
            startedAt: row.run_created_at ?? "",
            status: row.run_status,
          },
    mesh:
      row.mesh_id === null
        ? null
        : { id: row.mesh_id, geometryName: row.geometry_name ?? "", elements: row.mesh_elements, nodes: row.mesh_nodes },
  };
}
