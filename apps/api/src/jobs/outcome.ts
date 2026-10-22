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
import { recordJobFailed, recordJobRetried } from "../db/events";
import { recordImportOutcome } from "../db/geometries";
import { type Completion, failLostJob, type Job, lostJobs, requeueJob, type StopReason } from "../db/jobs";
import { recordMeshOutcome } from "../db/meshes";
import { recordRunOutcome } from "../db/runs";
import { endTry, modelSize } from "../db/stats";
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

/** The compute manager's cause codes for a job container that ended without reporting (M12.1, ADR-121). */
export const CONTAINER_EXITED = "container_exited";
export const CONTAINER_START_FAILED = "container_start_failed";

/**
 * Faults of the machine rather than of the job, which a new try may not meet (M12.2, ADR-108): the
 * worker went silent or restarted (a manager restart, a VPS reboot), the job's container was
 * killed from outside, or it did not start. Out of memory, the 13-hour container limit and
 * whatever the worker itself reports are not retried.
 */
const RETRIED_CAUSES = [WORKER_LOST, CONTAINER_EXITED, CONTAINER_START_FAILED];

/** Tries a job gets: the first and at most two more (ADR-108). */
export const MAX_ATTEMPTS = 3;

/** What stopped a try, as its owner reads it. */
const MACHINE_FAULT: Record<string, string> = {
  [WORKER_LOST]: "the machine working on it stopped responding",
  [CONTAINER_EXITED]: "the machine working on it stopped unexpectedly",
  [CONTAINER_START_FAILED]: "the machine could not start it",
};

/** Whether a job that ended with this completion is queued again rather than ended (ADR-108). */
export function retries(job: Job, completion: Completion): boolean {
  return (
    completion.status === "failed" &&
    completion.failureCategory === "platform_fault" &&
    RETRIED_CAUSES.includes(completion.failureCause) &&
    job.attempt < MAX_ATTEMPTS &&
    job.stopRequested === null
  );
}

/** The line a job queued again gets in its log, which a run shows as its solver log. */
export function requeueNote(job: Job, cause: string): string {
  return (
    `\n[ClearFEA] Try ${job.attempt} of ${MAX_ATTEMPTS} stopped because ${MACHINE_FAULT[cause] ?? cause} (${cause}), ` +
    `a fault in ClearFEA, not in your setup. Nothing is charged for it, and the job is queued again.\n`
  );
}

/**
 * Queues a job a machine fault ended again (ADR-108), or returns null when it is not retried: the
 * cause is not a machine fault, its tries are used up, it was asked to stop, or it changed meanwhile.
 */
export async function retryJob(env: Env, job: Job, completion: Completion): Promise<Job | null> {
  if (!retries(job, completion) || completion.status !== "failed") return null;
  const requeued = await requeueJob(env.DB, job, requeueNote(job, completion.failureCause));
  // The try that ended keeps its statistics; the next claim starts a new row (M12.3, ADR-109).
  if (requeued !== null && job.claimedBy !== null) {
    await endTry(env.DB, job.claimedBy, job, completion, await modelSize(env.DB, job, completion));
  }
  if (requeued !== null) await recordJobRetried(env.DB, job, completion.failureCause, MAX_ATTEMPTS);
  return requeued;
}

/**
 * A machine fault that ends a job, with what its owner is told: what stopped it, how many tries
 * it had and that nothing is charged. Other completions pass unchanged.
 */
export function finalMachineFault(job: Job, completion: Completion): Completion {
  if (
    completion.status !== "failed" ||
    completion.failureCategory !== "platform_fault" ||
    !RETRIED_CAUSES.includes(completion.failureCause) ||
    completion.failureCause === WORKER_LOST // lostCompletion words its own
  ) {
    return completion;
  }
  const what = MACHINE_FAULT[completion.failureCause];
  return {
    ...completion,
    failureMessage:
      `${WORK[job.type]} stopped because ${what} (${completion.failureCause}). ` +
      `This is a fault in ClearFEA, not in your setup, so nothing is charged.${tries(job)}${AGAIN[job.type]}`,
  };
}

/** How many tries a job had, when it had more than one. */
function tries(job: Job): string {
  return job.attempt > 1 ? ` It stopped this way on all ${job.attempt} tries.` : "";
}

/** Causes the API itself explains, whoever pays: its message replaces the generic fault text. */
const EXPLAINED_BY_API = [OUT_OF_MEMORY, NO_MACHINE, MACHINE_HOURS_CAP, ...RETRIED_CAUSES];

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
      tries(job) +
      AGAIN[job.type],
  };
}

/** The time a lost job is known to have had the machine: from its claim to its last heartbeat. */
export function lostBillableMs(job: Job): number {
  if (job.claimedAt === null || job.heartbeatAt === null) return 0;
  return Math.max(0, Math.round(Date.parse(job.heartbeatAt) - Date.parse(job.claimedAt)));
}

/**
 * Queues again or fails every job whose worker is lost (M8.4, M12.2): silent for the heartbeat
 * timeout (the cron), or, when `claimingWorker` is given, only the jobs held by that worker now
 * asking for a job, which had restarted (a claim). Each is a fault in ClearFEA, not charged. A job
 * with tries left is queued again (ADR-108); the rest fail, and their records say so. Returns how
 * many it queued again or failed.
 */
export async function sweepLostJobs(env: Env, claimingWorker: string | null = null): Promise<number> {
  const timeout = await heartbeatTimeoutSeconds(env.DB);
  let failed = 0;
  for (const lost of await lostJobs(env.DB, timeout, claimingWorker)) {
    const completion = lostCompletion(lost, timeout);
    if (retries(lost, completion)) {
      if ((await retryJob(env, lost, completion)) !== null) failed += 1;
      continue; // else it checked in or completed meanwhile
    }
    const billableMs = lostBillableMs(lost);
    const charge = lost.ratePerHour === null ? null : chargeFor(billableMs, lost.ratePerHour, completion);
    const job = await failLostJob(env.DB, lost, completion, billableMs, charge);
    if (job === null) continue; // it checked in or completed meanwhile
    if (lost.claimedBy !== null) await endTry(env.DB, lost.claimedBy, job, completion, await modelSize(env.DB, job, completion));
    await recordJobFailed(env.DB, lost, completion);
    await recordOutcome(env, job, completion, charge);
    failed += 1;
  }
  return failed;
}
