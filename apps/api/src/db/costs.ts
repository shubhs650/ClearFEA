// SPDX-License-Identifier: AGPL-3.0-or-later
// The dashboard's Costs tab (M13.3, ADR-113, ADR-128): one calendar month's (UTC) machine time
// and charges by user and by job type, beside what the beta costs each month used or not. Read by
// the admin only, so not owner-scoped; ids, addresses and totals, never a project's name or model.

import type { CostsResponse, JobType } from "@clearfea/spec";
import { fixedCosts } from "./settings";

/** The first instant of the month `YYYY-MM` and of the month after it, as ISO 8601 UTC times. */
export function monthRange(month: string): { from: string; to: string } {
  const [year, number] = month.split("-").map(Number) as [number, number];
  const from = new Date(Date.UTC(year, number - 1, 1)).toISOString();
  const to = new Date(Date.UTC(year, number, 1)).toISOString();
  return { from, to };
}

/** The current calendar month (UTC) as `YYYY-MM`. */
export function currentMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

interface UserRow {
  id: string;
  name: string;
  email: string | null;
  jobs: number;
  solve_runs: number;
  machine_seconds: number;
  job_micro_credits: number;
  storage_micro_credits: number;
}

interface TypeRow {
  type: JobType;
  jobs: number;
  machine_seconds: number;
  job_micro_credits: number;
}

/**
 * The month's usage. Jobs count in the month they finished (as the Users tab counts them), with
 * their billed machine time; charges count in the month their ledger entry was written. Users
 * with nothing in the month are left out; the largest machine time comes first.
 */
export async function monthCosts(db: D1Database, month: string): Promise<CostsResponse> {
  const { from, to } = monthRange(month);
  const [users, types, fixed] = await Promise.all([
    db
      .prepare(
        `WITH j AS (
           SELECT owner_id, COUNT(*) AS jobs, SUM(type = 'solve') AS solve_runs,
                  COALESCE(SUM(billed_seconds), 0) AS machine_seconds
             FROM jobs WHERE finished_at >= ?1 AND finished_at < ?2 GROUP BY owner_id
         ), l AS (
           SELECT owner_id, -SUM(CASE WHEN job_id IS NOT NULL THEN amount ELSE 0 END) AS job_micro_credits,
                  -SUM(CASE WHEN reason = 'storage' THEN amount ELSE 0 END) AS storage_micro_credits
             FROM ledger_entries WHERE created_at >= ?1 AND created_at < ?2 AND amount < 0 GROUP BY owner_id
         )
         SELECT u.id, u.name, u.email, COALESCE(j.jobs, 0) AS jobs, COALESCE(j.solve_runs, 0) AS solve_runs,
                COALESCE(j.machine_seconds, 0) AS machine_seconds,
                COALESCE(l.job_micro_credits, 0) AS job_micro_credits,
                COALESCE(l.storage_micro_credits, 0) AS storage_micro_credits
           FROM users u LEFT JOIN j ON j.owner_id = u.id LEFT JOIN l ON l.owner_id = u.id
          WHERE j.owner_id IS NOT NULL OR l.owner_id IS NOT NULL
          ORDER BY machine_seconds DESC, jobs DESC, u.id`,
      )
      .bind(from, to)
      .all<UserRow>(),
    db
      .prepare(
        `SELECT j.type, COUNT(*) AS jobs, COALESCE(SUM(j.billed_seconds), 0) AS machine_seconds,
                COALESCE(-SUM(l.amount), 0) AS job_micro_credits
           FROM jobs j LEFT JOIN ledger_entries l ON l.job_id = j.id
          WHERE j.finished_at >= ?1 AND j.finished_at < ?2
          GROUP BY j.type ORDER BY machine_seconds DESC, j.type`,
      )
      .bind(from, to)
      .all<TypeRow>(),
    fixedCosts(db),
  ]);
  const byUser = users.results.map((row) => ({
    userId: row.id,
    name: row.name,
    email: row.email,
    jobs: row.jobs,
    solveRuns: row.solve_runs,
    machineSeconds: row.machine_seconds,
    jobMicroCredits: row.job_micro_credits,
    storageMicroCredits: row.storage_micro_credits,
  }));
  const sum = (key: "jobs" | "solveRuns" | "machineSeconds" | "jobMicroCredits" | "storageMicroCredits") =>
    byUser.reduce((total, user) => total + user[key], 0);
  return {
    month,
    solverHostCents: fixed.solverHostCents,
    platformCents: fixed.platformCents,
    totals: {
      jobs: sum("jobs"),
      solveRuns: sum("solveRuns"),
      machineSeconds: sum("machineSeconds"),
      jobMicroCredits: sum("jobMicroCredits"),
      storageMicroCredits: sum("storageMicroCredits"),
    },
    byUser,
    byType: types.results.map((row) => ({
      type: row.type,
      jobs: row.jobs,
      machineSeconds: row.machine_seconds,
      jobMicroCredits: row.job_micro_credits,
    })),
  };
}
