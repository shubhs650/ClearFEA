// SPDX-License-Identifier: AGPL-3.0-or-later
// The launcher (M10.7, ADR-095 items 6 and 8, ADR-100): starts a solver machine on AWS Fargate
// when a job is queued and no machine of its size can take it, fails a queued job that no machine
// could be started for, and keeps the monthly machine-hours cap. Called after every request that
// may have queued a job and by the scheduled handler each minute. Only on cloud machines
// (MACHINES=cloud); the local worker needs none of it.
//
// `planMachines` decides and is pure; `ensureMachines` reads the state, applies the plan and
// talks to AWS.

import type { MachineStart, SolverMachines } from "@clearfea/spec";
import type { Completion } from "../db/jobs";
import { failQueuedJob, type QueuedJob, queuedJobs } from "../db/jobs";
import { cloudMachines } from "../db/machines";
import { type MachineSettings, machineSettings } from "../db/settings";
import {
  ALIVE_SECONDS,
  iso,
  listStarts,
  recordStart,
  recordStartOutcome,
  WORKER_PREFIX,
  type WorkerStart,
} from "../db/workerStarts";
import type { Env } from "../env";
import { MACHINE_HOURS_CAP, NO_MACHINE, recordOutcome } from "../jobs/outcome";
import { type AwsAccess, awsAccess, type Fetch, type LaunchSettings, readLaunchSettings, runTask } from "./aws";

export { MACHINE_HOURS_CAP, NO_MACHINE };


/** Starts in a row without a worker after which a queued job fails (ADR-095 item 6). */
export const FAILED_STARTS = 3;

/** Seconds a job may wait behind busy machines of its size before another is started. */
export const BUSY_WAIT_SECONDS = 180;

/** Seconds after AWS refused a start before the same size is tried again. */
export const RETRY_SECONDS = 60;

export interface CloudSize {
  name: string;
  enabled: boolean;
}

export interface MachineState {
  sizes: CloudSize[];
  queued: QueuedJob[];
  starts: WorkerStart[];
  settings: MachineSettings;
  now: number;
  /** Why the API cannot start machines at all, or null when it can. */
  launcherProblem: string | null;
}

export interface JobToFail {
  jobId: string;
  cause: typeof NO_MACHINE | typeof MACHINE_HOURS_CAP;
  message: string;
}

export interface MachinePlan {
  /** Machine sizes to start one machine of, now. */
  start: string[];
  fail: JobToFail[];
}

const ms = (seconds: number) => seconds * 1000;

/** The first instant of the calendar month (UTC) the time falls in. */
export function monthStart(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function seen(start: WorkerStart): boolean {
  return start.firstSeenAt !== null;
}

function alive(start: WorkerStart, now: number): boolean {
  return start.lastSeenAt !== null && Date.parse(start.lastSeenAt) >= now - ms(ALIVE_SECONDS);
}

function pending(start: WorkerStart, state: Pick<MachineState, "now" | "settings">): boolean {
  return (
    start.problem === null &&
    !seen(start) &&
    Date.parse(start.requestedAt) >= state.now - ms(state.settings.startWaitSeconds)
  );
}

/** A start that produced no worker: AWS refused it, or its worker never made contact in time. */
function failed(start: WorkerStart, state: Pick<MachineState, "now" | "settings">): boolean {
  return start.problem !== null || (!seen(start) && !pending(start, state));
}

/**
 * Machine hours used this calendar month: each start from its request to its worker's last
 * contact, or for a start never seen, to when it would have counted as failed. A machine bills
 * from its start, image pull included, so the time before first contact counts.
 */
export function machineHours(starts: WorkerStart[], settings: MachineSettings, now: number): number {
  const from = monthStart(now);
  let total = 0;
  for (const start of starts) {
    const begin = Date.parse(start.requestedAt);
    const end =
      start.lastSeenAt !== null
        ? Date.parse(start.lastSeenAt)
        : start.problem !== null
          ? begin
          : Math.min(now, begin + ms(settings.startWaitSeconds));
    total += Math.max(0, Math.min(end, now) - Math.max(begin, from));
  }
  return total / ms(3600);
}

function hoursText(hours: number): string {
  return `${hours} machine hour${hours === 1 ? "" : "s"}`;
}

/** Why no run or mesh can be queued now, in plain words, or null when one can. */
export function refusal(state: Pick<MachineState, "launcherProblem" | "starts" | "settings" | "now">): string | null {
  if (state.launcherProblem !== null) {
    return "This site cannot start solver machines yet, so nothing can be solved or meshed. Tell the admin; the details are on the admin page.";
  }
  if (machineHours(state.starts, state.settings, state.now) >= state.settings.hoursCap) {
    return `This site has used its ${hoursText(state.settings.hoursCap)} for this month, so no new runs or meshes can start until the 1st (UTC) or until the admin raises the limit.`;
  }
  return null;
}

/** What to start and what to fail, from the state the launcher read. */
export function planMachines(state: MachineState): MachinePlan {
  const plan: MachinePlan = { start: [], fail: [] };
  const fail = (jobs: QueuedJob[], cause: JobToFail["cause"], message: string) =>
    plan.fail.push(...jobs.map((job) => ({ jobId: job.id, cause, message })));
  const overCap = machineHours(state.starts, state.settings, state.now) >= state.settings.hoursCap;
  let running = state.starts.filter((s) => alive(s, state.now) || pending(s, state)).length;

  for (const size of state.sizes) {
    const queued = state.queued.filter((job) => job.machineSize === size.name);
    if (queued.length === 0) continue;
    const starts = state.starts.filter((s) => s.machineSize === size.name);
    const anyAlive = starts.some((s) => alive(s, state.now));
    if (state.launcherProblem !== null) {
      fail(queued, NO_MACHINE, "the solver machines of this site are not set up yet");
      continue;
    }
    if (!size.enabled && !anyAlive) {
      fail(queued, NO_MACHINE, `the ${size.name} machine size has been switched off on this site`);
      continue;
    }
    if (overCap) {
      // A machine still running takes the queue when it is free; otherwise nothing will.
      if (!anyAlive) {
        fail(
          queued,
          MACHINE_HOURS_CAP,
          `this site has used its ${hoursText(state.settings.hoursCap)} for this month, so no machine was started`,
        );
      }
      continue;
    }
    const waiting: QueuedJob[] = [];
    for (const job of queued) {
      const since = starts.filter((s) => Date.parse(s.requestedAt) >= Date.parse(job.createdAt));
      if (since.filter((s) => failed(s, state)).length >= FAILED_STARTS && !since.some(seen)) {
        fail([job], NO_MACHINE, `${FAILED_STARTS} solver machines were started for it and none came up`);
      } else {
        waiting.push(job);
      }
    }
    const oldest = waiting[0];
    if (oldest === undefined) continue;
    if (starts.some((s) => pending(s, state))) continue;
    if (starts.some((s) => s.problem !== null && Date.parse(s.requestedAt) >= state.now - ms(RETRY_SECONDS))) continue;
    // Start when no machine of the size is alive, or when the ones alive are busy and the job
    // has waited behind them a while.
    const behindBusy = Date.parse(oldest.createdAt) <= state.now - ms(BUSY_WAIT_SECONDS);
    if (anyAlive && !behindBusy) continue;
    if (running >= state.settings.maxRunning) continue;
    plan.start.push(size.name);
    running += 1;
  }
  return plan;
}

/** The job's completion when no machine could run it: a fault in ClearFEA, not charged. */
export function noMachineCompletion(job: JobToFail): Extract<Completion, { status: "failed" }> {
  return {
    status: "failed",
    failureCategory: "platform_fault",
    failureCause: job.cause,
    failureMessage:
      `This could not start because ${job.message}. This is not a fault in your setup, so nothing is charged. ` +
      "Try again later; if it happens again, tell the admin.",
  };
}

/** Everything the launcher needs to read, with the time it was read. */
export async function readMachineState(env: Env, fetcher: Fetch = fetch): Promise<MachineState> {
  const now = Date.now();
  // The month so far, and every start a machine of which may still be alive (ADR-099: at most
  // 12 hours up, then the job it holds).
  const since = iso(Math.min(monthStart(now), now - ms(24 * 3600)));
  const [sizes, queued, starts, settings] = await Promise.all([
    env.DB.prepare("SELECT name, cloud FROM machine_sizes WHERE cloud IS NOT NULL ORDER BY rate_per_hour, name").all<{
      name: string;
      cloud: string;
    }>(),
    queuedJobs(env.DB),
    listStarts(env.DB, since),
    machineSettings(env.DB),
  ]);
  return {
    sizes: sizes.results.map((row) => ({ name: row.name, enabled: row.cloud === "on" })),
    queued,
    starts,
    settings,
    now,
    launcherProblem: launcherProblem(env, fetcher),
  };
}

function launcherProblem(env: Env, fetcher: Fetch): string | null {
  const access = awsAccess(env, fetcher);
  if ("problem" in access) return access.problem;
  if (!env.WORKER_TOKEN) return "The API has no WORKER_TOKEN for the machines (docs/DEPLOYMENT.md section 3).";
  return null;
}

/**
 * Why a run or mesh cannot be queued now on this site, or null. Locally, always null: the local
 * worker is always there and has no cap.
 */
export async function machineRefusal(env: Env): Promise<string | null> {
  if (!cloudMachines(env)) return null;
  return refusal(await readMachineState(env));
}

/**
 * Starts the machines the queue needs and fails the jobs none can run (ADR-100). Returns the
 * plan it applied. Does nothing locally.
 */
export async function ensureMachines(env: Env, fetcher: Fetch = fetch): Promise<MachinePlan> {
  if (!cloudMachines(env)) return { start: [], fail: [] };
  const state = await readMachineState(env, fetcher);
  const plan = planMachines(state);

  for (const job of plan.fail) {
    const completion = noMachineCompletion(job);
    const failedJob = await failQueuedJob(env.DB, job.jobId, completion);
    if (failedJob !== null) await recordOutcome(env, failedJob, completion, null);
  }

  if (plan.start.length === 0) return plan;
  const access = awsAccess(env, fetcher) as AwsAccess;
  let launch: LaunchSettings | null = null;
  for (const size of plan.start) {
    const id = await recordStart(env.DB, size, iso(state.now - ms(state.settings.startWaitSeconds)), 1);
    if (id === null) continue; // another launcher started one meanwhile
    try {
      launch ??= await readLaunchSettings(access);
      const family = launch.taskDefinitions[size];
      if (family === undefined) {
        throw new Error(
          `The stack defines no machine for the ${size} size. Set LargeSizeEnabled to true in the clearfea stack (docs/DEPLOYMENT.md section 7.3).`,
        );
      }
      const taskArn = await runTask(access, launch, {
        family,
        environment: { CLEARFEA_WORKER_ID: `${WORKER_PREFIX}${id}`, CLEARFEA_WORKER_TOKEN: env.WORKER_TOKEN ?? "" },
      });
      await recordStartOutcome(env.DB, id, { taskArn });
      console.log(`Started a ${size} machine for queued work: ${taskArn}`);
    } catch (error) {
      const problem = error instanceof Error ? error.message : String(error);
      await recordStartOutcome(env.DB, id, { problem });
      console.error(`Could not start a ${size} machine: ${problem}`);
    }
  }
  return plan;
}

/** A start as the admin page shows it. */
export function startState(start: WorkerStart, state: Pick<MachineState, "now" | "settings">): MachineStart["state"] {
  if (alive(start, state.now)) return "running";
  if (seen(start)) return "ended";
  return pending(start, state) ? "starting" : "failed";
}

/** The admin page's view of the solver machines (DEPLOYMENT.md sections 7.4 to 7.6). */
export async function solverMachines(env: Env): Promise<SolverMachines> {
  const state = await readMachineState(env);
  const cloud = cloudMachines(env);
  return {
    launcher: !cloud ? "local" : state.launcherProblem === null ? "ready" : "not_set_up",
    problem: cloud ? state.launcherProblem : null,
    hoursThisMonth: Math.round(machineHours(state.starts, state.settings, state.now) * 100) / 100,
    hoursCap: state.settings.hoursCap,
    starts: state.starts.slice(0, 10).map((start) => ({
      size: start.machineSize,
      requestedAt: start.requestedAt,
      state: startState(start, state),
      problem: start.problem,
    })),
  };
}
