// SPDX-License-Identifier: AGPL-3.0-or-later
// How a job that has ended changes the record it worked on (a geometry, a mesh or a run), and
// what its owner is told (docs/ARCHITECTURE.md section 6, failure classification). Used by the
// worker's completion route and by the sweep that fails jobs whose worker is lost (M8.4).

import {
  atStopCeiling,
  type RunFileName,
  validateImportResult,
  validateMeshResult,
  validateSolveResult,
} from "@clearfea/spec";
import { chargeFor, type JobCharge } from "../billing/cost";
import { recordImportOutcome } from "../db/geometries";
import { type Completion, failLostJob, type Job, lostJobs, type StopReason } from "../db/jobs";
import { recordMeshOutcome } from "../db/meshes";
import { recordRunOutcome } from "../db/runs";
import { heartbeatTimeoutSeconds } from "../db/settings";
import type { Env } from "../env";
import { jobFiles } from "./files";

/** The worker's cause code for a solver stopped past its machine size's memory (M8.5, ADR-082). */
export const OUT_OF_MEMORY = "out_of_memory";

/** The API's cause code for a job whose worker stopped checking in (M8.4). */
export const WORKER_LOST = "worker_lost";

function validatedImportResult(result: unknown) {
  const checked = validateImportResult(result);
  if (!checked.ok) throw new Error("checkedCompletion lets only valid import results through.");
  return checked.value;
}

function validatedMeshResult(result: unknown) {
  const checked = validateMeshResult(result);
  if (!checked.ok) throw new Error("checkedCompletion lets only valid mesh results through.");
  return checked.value;
}

function validatedSolveResult(result: unknown) {
  const checked = validateSolveResult(result);
  if (!checked.ok) throw new Error("checkedCompletion lets only valid solve results through.");
  return checked.value;
}

/** The run files a solve job stored, whether it succeeded or not (a failed run may have a deck and log). */
async function storedFiles(env: Env, job: Job): Promise<RunFileName[]> {
  const uploads = jobFiles(job).filter((f) => f.direction === "upload");
  const stored = await Promise.all(uploads.map((f) => env.FILES.head(f.key)));
  return uploads.filter((_, i) => stored[i] !== null).map((f) => f.name as RunFileName);
}

/** The time a job used, as its owner reads it: seconds below two minutes, then minutes and seconds. */
function usedTime(billedSeconds: number): string {
  if (billedSeconds < 120) return `${billedSeconds} s`;
  return `${Math.floor(billedSeconds / 60)} min ${billedSeconds % 60} s`;
}

/** The API's cause code for a queued job no solver machine could be started for (M10.7, ADR-100). */
export const NO_MACHINE = "no_machine";

/** The API's cause code for a queued job left when the monthly machine-hours cap was reached (M10.7). */
export const MACHINE_HOURS_CAP = "machine_hours_cap";

/** Causes the API itself explains, whoever pays: its message replaces the generic fault text. */
const EXPLAINED_BY_API = [OUT_OF_MEMORY, WORKER_LOST, NO_MACHINE, MACHINE_HOURS_CAP];

/**
 * What the owner is told about a failed job: the worker's message when it is their fault, and
 * the API's own when a run ran out of memory, whoever pays, or the worker was lost.
 */
function problem(completion: Exclude<Completion, { status: "succeeded" }>, ours: string): string {
  // Only runs are cancelled (M8.2), but every job type reads the same completion.
  if (completion.status !== "failed") return stoppedProblem(completion.status, null, null);
  const explained =
    completion.failureCategory === "user_fault" || EXPLAINED_BY_API.includes(completion.failureCause);
  if (explained && completion.failureMessage) {
    return completion.failureMessage;
  }
  return ours.replace("{cause}", completion.failureCause);
}

const IMPORT_FAULT =
  "The import stopped because of a fault in ClearFEA, not in your file ({cause}). Upload the file again; if it fails again, report it.";
const RUN_FAULT =
  "The run stopped because of a fault in ClearFEA, not in your setup ({cause}). The solver log shows what happened. Run it again; if it fails again, report it.";
const MESH_FAULT =
  "Meshing stopped because of a fault in ClearFEA, not in your setup ({cause}). Generate the mesh again; if it fails again, report it.";

/** What the owner is told about a run that stopped because it was asked to (M8.2, M8.3). */
function stoppedProblem(reason: StopReason, charge: JobCharge | null, job: Job | null): string {
  const time = charge === null ? "" : ` after ${usedTime(charge.billedSeconds)}`;
  const charged = charge?.charged ? " The time it used is charged." : "";
  if (reason === "cancelled") return `You cancelled the run${time}.${charged} Run it again for results.`;
  const limit =
    job?.stopAfterSeconds == null || job.stopMultiplier === null
      ? ""
      : ` of ${usedTime(job.stopAfterSeconds)} (${atStopCeiling(job.stopAfterSeconds) ? "the 12-hour ceiling" : `${job.stopMultiplier} × the estimated time`})`;
  return (
    `The run reached its stop limit${limit} and was stopped${time}.${charged} ` +
    "If it needs longer, raise the stop limit and run it again; a coarser mesh or a faster solver also shortens it."
  );
}

/** Applies an ended job to the record it worked on. */
export async function recordOutcome(env: Env, job: Job, completion: Completion, charge: JobCharge | null): Promise<void> {
  if (job.type === "import") {
    await recordImportOutcome(
      env.DB,
      job,
      completion.status === "succeeded"
        ? { status: "succeeded", result: validatedImportResult(completion.result) }
        : { status: "failed", problem: problem(completion, IMPORT_FAULT) },
    );
  }
  if (job.type === "mesh") {
    await recordMeshOutcome(
      env.DB,
      job,
      completion.status === "succeeded"
        ? { status: "succeeded", result: validatedMeshResult(completion.result) }
        : { status: "failed", problem: problem(completion, MESH_FAULT) },
    );
  }
  if (job.type === "solve") {
    await recordRunOutcome(
      env.DB,
      job,
      completion.status === "succeeded"
        ? { status: "succeeded", result: validatedSolveResult(completion.result) }
        : completion.status === "failed"
          ? { status: "failed", problem: problem(completion, RUN_FAULT) }
          : { status: completion.status, problem: stoppedProblem(completion.status, charge, job) },
      await storedFiles(env, job),
    );
  }
  // Report jobs are read from the job itself (db/reports.ts); noop jobs change nothing.
}

/** What to do again after a lost worker, per job type. */
const AGAIN: Record<Job["type"], string> = {
  noop: "",
  import: " Upload the file again; if it fails again, report it.",
  mesh: " Generate the mesh again; if it fails again, report it.",
  solve: " Run it again; if it fails again, report it.",
  report: " Make the report again; if it fails again, report it.",
};

const WORK: Record<Job["type"], string> = {
  noop: "The job",
  import: "The import",
  mesh: "Meshing",
  solve: "The run",
  report: "The report",
};

/** The completion of a job whose worker is lost: a fault in ClearFEA, with what the owner is told. */
export function lostCompletion(job: Job, timeoutSeconds: number): Extract<Completion, { status: "failed" }> {
  return {
    status: "failed",
    failureCategory: "platform_fault",
    failureCause: WORKER_LOST,
    failureMessage:
      `${WORK[job.type]} stopped because the machine working on it stopped responding ` +
      `(no check-in for ${timeoutSeconds} s). This is a fault in ClearFEA, not in your setup, so nothing is charged.` +
      AGAIN[job.type],
  };
}

/** The time a lost job is known to have had the machine: from its claim to its last heartbeat. */
export function lostBillableMs(job: Job): number {
  if (job.claimedAt === null || job.heartbeatAt === null) return 0;
  return Math.max(0, Math.round(Date.parse(job.heartbeatAt) - Date.parse(job.claimedAt)));
}

/**
 * Fails every job whose worker is lost (M8.4): silent for the heartbeat timeout (the cron), or,
 * when `claimingWorker` is given, only the jobs held by that worker now asking for a job, which
 * had restarted (a claim). Each is a fault in
 * ClearFEA, not charged, and its record says so. Returns how many it failed.
 */
export async function sweepLostJobs(env: Env, claimingWorker: string | null = null): Promise<number> {
  const timeout = await heartbeatTimeoutSeconds(env.DB);
  let failed = 0;
  for (const lost of await lostJobs(env.DB, timeout, claimingWorker)) {
    const completion = lostCompletion(lost, timeout);
    const billableMs = lostBillableMs(lost);
    const charge = lost.ratePerHour === null ? null : chargeFor(billableMs, lost.ratePerHour, completion);
    const job = await failLostJob(env.DB, lost, completion, billableMs, charge);
    if (job === null) continue; // it checked in or completed meanwhile
    await recordOutcome(env, job, completion, charge);
    failed += 1;
  }
  return failed;
}
