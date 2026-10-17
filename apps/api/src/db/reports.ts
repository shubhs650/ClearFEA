// SPDX-License-Identifier: AGPL-3.0-or-later
// A run's reports (M7.3, ADR-077). A report is a report job whose target is the run: its params
// are the frozen input the report job prints and the DOCX and its PDF (M7.4, ADR-078) are stored
// under the job's id, so every report asked for is kept. Every function takes the acting user's id
// and filters on owner_id.

import type { ReportJobParams, ReportStatus, RunReport } from "@clearfea/spec";
import { getJob, type Job, newJob } from "./jobs";

/** The files a report job makes: the Word report and its PDF. */
export type ReportFormat = "docx" | "pdf";

/** Where a report's DOCX or PDF is stored: beside its run's files, one per report job. */
export function reportKey(ownerId: string, runId: string, reportId: string, format: ReportFormat): string {
  return `owners/${ownerId}/runs/${runId}/reports/${reportId}.${format}`;
}

/** The latest report job of one of the user's runs, or null when none was asked for. */
export async function latestReportJob(db: D1Database, userId: string, runId: string): Promise<Job | null> {
  const row = await db
    .prepare(
      `SELECT id FROM jobs WHERE type = 'report' AND target_id = ? AND owner_id = ?
        ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .bind(runId, userId)
    .first<{ id: string }>();
  return row === null ? null : getJob(db, userId, row.id);
}

/** Queues a report job for one of the user's runs, which the caller has checked. */
export async function queueReport(
  db: D1Database,
  userId: string,
  runId: string,
  params: ReportJobParams,
): Promise<Job> {
  const job = newJob(db, userId, "report", runId, params as unknown as Record<string, unknown>);
  await job.statement.run();
  const queued = await getJob(db, userId, job.id);
  if (queued === null) throw new Error("Inserting the report job returned no row.");
  return queued;
}

const STATUS: Record<Job["status"], ReportStatus> = {
  queued: "queued",
  claimed: "queued",
  running: "making",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "failed",
  stopped_at_limit: "failed",
};

const REPORT_FAULT =
  "The report was not made because of a fault in ClearFEA, not in your run ({cause}). Make it again; if it fails again, report it.";

/** A report job as its owner sees it. */
export function reportView(job: Job): RunReport {
  const status = STATUS[job.status];
  const result = job.result as { sizeBytes?: unknown; pdfSizeBytes?: unknown } | null;
  return {
    id: job.id,
    status,
    problem:
      status !== "failed"
        ? null
        : job.status === "failed"
          ? REPORT_FAULT.replace("{cause}", job.failureCause ?? "unknown")
          : "The report was stopped before it was made. Make it again.",
    sizeBytes: status === "succeeded" && typeof result?.sizeBytes === "number" ? result.sizeBytes : null,
    pdfSizeBytes: status === "succeeded" && typeof result?.pdfSizeBytes === "number" ? result.pdfSizeBytes : null,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  };
}
