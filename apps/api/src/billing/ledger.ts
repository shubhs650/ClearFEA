// SPDX-License-Identifier: AGPL-3.0-or-later
// The ledger (docs/ARCHITECTURE.md sections 4 and 6, ADR-033): append-only entries with the
// owner's running balance. Nothing here updates or deletes an entry. Reads are owner-scoped;
// a charge is written for a job the worker holds, in the same batch that completes the job.

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
