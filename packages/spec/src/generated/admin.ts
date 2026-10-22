// SPDX-License-Identifier: AGPL-3.0-or-later
// Generated from packages/spec/schemas/admin.schema.json by packages/spec/scripts/generate.mjs.
// Do not edit by hand; change the schema and run `make spec`.

import schema from "../../schemas/admin.schema.json";
import { validator } from "../validate";

/**
 * Wire shapes of the admin routes (M10.3, ADR-097): the allowlist of addresses that may sign in with Google, the users, the cloud machine sizes (M10.6) the solver machines started on AWS (M10.7), the statistics (M12.3) the event log (M13.1) and the dashboard's overview and jobs (M13.2). Only the admin reaches them. Each message is a definition under $defs.
 */
export interface Admin {
  [k: string]: unknown;
}
/**
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "AllowedEmail".
 */
export interface AllowedEmail {
  /**
   * Lower case.
   */
  email: string;
  /**
   * ISO 8601 UTC.
   */
  addedAt: string;
}
/**
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "AdminUser".
 */
export interface AdminUser {
  id: string;
  name: string;
  /**
   * Null for a seeded local test user without one.
   */
  email: string | null;
  createdAt: string;
  /**
   * When their latest Google session started, or null.
   */
  lastSignIn: string | null;
  /**
   * Billed machine seconds of their jobs that finished this calendar month (UTC).
   */
  machineSecondsThisMonth: number;
  /**
   * True when their address may sign in now: the admin's, or on the allowlist.
   */
  allowed: boolean;
}
/**
 * A machine size the live site can run on AWS (M10.6, ADR-099).
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "CloudMachineSize".
 */
export interface CloudMachineSize {
  name: string;
  cores: number;
  memoryBytes: number;
  /**
   * Switched on: runs on the live site may choose it.
   */
  enabled: boolean;
  /**
   * The default size, which runs every import, mesh and report job and cannot be switched off.
   */
  default: boolean;
}
/**
 * One solver machine the API asked AWS to start (M10.7, ADR-100).
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "MachineStart".
 */
export interface MachineStart {
  /**
   * A machine_sizes name: medium (standard) or large.
   */
  size: string;
  /**
   * ISO 8601 UTC.
   */
  requestedAt: string;
  /**
   * starting: asked for, its worker not seen yet; running: its worker made contact in the last minute; ended: its worker was seen and has stopped; failed: AWS refused it or its worker never made contact.
   */
  state: "starting" | "running" | "ended" | "failed";
  /**
   * Why AWS refused the start, in AWS's words; null otherwise.
   */
  problem: string | null;
}
/**
 * The always-on solver host (M12.4, ADR-120), from its compute manager's check-ins.
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "SolverHost".
 */
export interface SolverHost {
  host: string;
  /**
   * True when it checked in within the last 120 s; while no host is online, new jobs are refused.
   */
  online: boolean;
  /**
   * ISO 8601 UTC.
   */
  lastSeenAt: string;
  /**
   * ISO 8601 UTC: when this run of check-ins began, after a silence of more than 120 s or the first ever.
   */
  firstSeenAt: string;
  managerVersion: string | null;
}
/**
 * The live site's solver machines and their monthly cap (M10.7, ADR-100).
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "SolverMachines".
 */
export interface SolverMachines {
  /**
   * ready: the API can start machines on AWS; not_set_up: it runs on cloud machines but lacks what starting one needs, which problem names; local: jobs run on the local worker and nothing is started.
   */
  launcher: "ready" | "not_set_up" | "local";
  problem: string | null;
  /**
   * Machine hours used this calendar month (UTC), from each start to its worker's last contact.
   */
  hoursThisMonth: number;
  /**
   * The monthly machine-hours cap; 0 pauses the solver.
   */
  hoursCap: number;
  /**
   * The latest starts, newest first, at most 10.
   */
  starts: MachineStart[];
}
/**
 * Answer to GET /api/admin and to adding or removing an address.
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "AdminResponse".
 */
export interface AdminResponse {
  /**
   * The admin's address from the API's configuration (ADMIN_EMAIL), lower case.
   */
  adminEmail: string;
  allowed: AllowedEmail[];
  users: AdminUser[];
  /**
   * Where jobs run: cloud machines started on AWS (MACHINES=cloud), the always-on solver host (MACHINES=vps, M12.4, ADR-120) or the local worker, which simulates every size and ignores the cloud size list.
   */
  machines: "cloud" | "vps" | "local";
  cloudSizes: CloudMachineSize[];
  solverMachines: SolverMachines;
  /**
   * The solver host that checked in last; null when none ever has.
   */
  solverHost: SolverHost | null;
}
/**
 * One try of a job (M12.3, ADR-109, ADR-123), for support: queue wait, stage times, model size, solver and what its container used. Admin only.
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "JobTry".
 */
export interface JobTry {
  jobId: string;
  jobType: "noop" | "import" | "mesh" | "solve" | "report";
  /**
   * The user the job is for; nothing else of their records is shown.
   */
  ownerId: string;
  /**
   * The geometry, mesh or run the job works on: a run id for a solve job.
   */
  targetId: string | null;
  /**
   * 1 for the first try; a job re-queued after a platform fault (M12.2) is tried again under the same id.
   */
  attempt: number;
  workerId: string;
  /**
   * The solver host, from the compute manager's statistics; null from any other worker.
   */
  host: string | null;
  lane: string | null;
  /**
   * The worker image id the container ran.
   */
  image: string | null;
  /**
   * ISO 8601 UTC: when this try began to wait: the job's creation, or the end of its previous try.
   */
  queuedAt: string;
  claimedAt: string;
  /**
   * Null while the try runs.
   */
  endedAt: string | null;
  queueWaitMs: number;
  /**
   * Milliseconds in each stage the worker reported, as seen by its heartbeats every 5 s; "starting" is from the claim to the first heartbeat.
   */
  stageMs: {
    [k: string]: number;
  };
  /**
   * The stage the try was in when it ended, or is in now.
   */
  lastStage: string | null;
  /**
   * How the try ended; null while it runs.
   */
  status: "succeeded" | "failed" | "cancelled" | "stopped_at_limit" | null;
  failureCategory: "user_fault" | "platform_fault" | null;
  failureCause: string | null;
  /**
   * Of the mesh made (mesh job) or solved on (solve job).
   */
  nodes: number | null;
  elements: number | null;
  /**
   * Unknowns of the solve: three per node for a structural run, one for a thermal one.
   */
  dofs: number | null;
  solver: string | null;
  analysis: string | null;
  exitCode: number | null;
  /**
   * exitCode - 128 when the container was ended by a signal (9: killed).
   */
  signal: number | null;
  outOfMemory: boolean | null;
  /**
   * The container's run time.
   */
  runMs: number | null;
  peakMemoryBytes: number | null;
  cpuSeconds: number | null;
  /**
   * cpuSeconds over runMs, in CPUs.
   */
  cpuAverage: number | null;
  cpuPeak: number | null;
  diskWrittenBytes: number | null;
}
/**
 * Answer of GET /api/admin/stats/jobs: tries newest first, of one job (?job=), of the jobs of one record such as a run (?target=), or of all jobs (?before= pages on).
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "JobTriesResponse".
 */
export interface JobTriesResponse {
  tries: JobTry[];
}
/**
 * The solver host's load at one check-in (M12.3, ADR-109): shares from 0 to 1, bytes.
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "HostLoadSample".
 */
export interface HostLoadSample {
  host: string;
  /**
   * ISO 8601 UTC.
   */
  at: string;
  cpu: number | null;
  steal: number | null;
  load1: number;
  load5: number;
  load15: number;
  memoryTotalBytes: number;
  memoryAvailableBytes: number;
  diskTotalBytes: number;
  diskFreeBytes: number;
  containers: number;
}
/**
 * Answer of GET /api/admin/stats/host: the host's load samples since ?since= (default the last hour), oldest first, kept 14 days.
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "HostLoadResponse".
 */
export interface HostLoadResponse {
  samples: HostLoadSample[];
}
/**
 * One entry of the event log (M13.1, ADR-113, ADR-125): what happened, to whom and how serious it is. For support: ids and plain words, never a project's name, model or results.
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "AdminEvent".
 */
export interface AdminEvent {
  id: number;
  /**
   * ISO 8601 UTC.
   */
  at: string;
  /**
   * sign_in and sign_in_refused: a sign-in, or one refused (Google, a local password or the verification token); job_failed: a job ended failed, through the user's setup (info) or a fault in ClearFEA (error); job_retried: a machine fault ended a try and the job was queued again; host_online and host_offline: the solver host checked in after a silence (or for the first time), or has been silent for 120 s; manager_started: its compute manager restarted while the host stayed online; admin_action: the admin changed something.
   */
  kind:
    | "sign_in"
    | "sign_in_refused"
    | "job_failed"
    | "job_retried"
    | "host_online"
    | "host_offline"
    | "manager_started"
    | "admin_action";
  level: "info" | "warning" | "error";
  /**
   * The user it is about: who signed in, whose job it was, the admin who acted.
   */
  userId: string | null;
  jobId: string | null;
  host: string | null;
  /**
   * One line in plain words.
   */
  message: string;
  /**
   * The particulars as named values, such as the failure cause, the try, or the address refused.
   */
  detail: {} | null;
}
/**
 * Answer of GET /api/admin/events: events newest first, filtered by ?kind=, ?level=, ?user=, ?since= and ?before= (times), at most ?limit= (up to 500).
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "EventsResponse".
 */
export interface EventsResponse {
  events: AdminEvent[];
}
/**
 * A job of any user as the dashboard's Overview and Jobs and runs tabs show it (M13.2, ADR-113, ADR-127): its state, tries and failure, for support. Ids and an address, never a project's name, model or results.
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "AdminJob".
 */
export interface AdminJob {
  id: string;
  type: "noop" | "import" | "mesh" | "solve" | "report";
  /**
   * Solve jobs run in the solve lane, the rest in the light lane (ADR-107).
   */
  lane: "solve" | "light";
  status: "queued" | "claimed" | "running" | "succeeded" | "failed" | "cancelled" | "stopped_at_limit";
  /**
   * The stage its worker reported last.
   */
  stage: string | null;
  ownerId: string;
  /**
   * The owner's address; null for a local test user without one.
   */
  ownerEmail: string | null;
  /**
   * The geometry, mesh or run the job works on: a run id for a solve job.
   */
  targetId: string | null;
  attempt: number;
  machineSize: string | null;
  /**
   * The worker id holding it, or that last held it.
   */
  claimedBy: string | null;
  /**
   * How its owner or its stop limit asked it to end, while it still runs.
   */
  stopRequested: "cancelled" | "stopped_at_limit" | null;
  /**
   * ISO 8601 UTC.
   */
  createdAt: string;
  claimedAt: string | null;
  heartbeatAt: string | null;
  finishedAt: string | null;
  failureCategory: "user_fault" | "platform_fault" | null;
  failureCause: string | null;
  /**
   * What its owner was told, for support.
   */
  failureMessage: string | null;
  peakMemoryBytes: number | null;
  billedSeconds: number | null;
  /**
   * Its place among the queued jobs of its lane, oldest first; null unless queued.
   */
  queuePosition: number | null;
}
/**
 * Answer of GET /api/admin/jobs: jobs newest first, filtered by ?status=, ?type=, ?user= and ?before= (a creation time, to page on), at most ?limit= (up to 500).
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "AdminJobsResponse".
 */
export interface AdminJobsResponse {
  jobs: AdminJob[];
}
/**
 * Answer of POST /api/admin/jobs/{id}/cancel and /requeue: the job as it is now.
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "AdminJobResponse".
 */
export interface AdminJobResponse {
  job: AdminJob;
}
/**
 * Answer of GET /api/admin/jobs/{id}/log?after={n}: the job's log written after chunk n, the n to ask with next time, and whether more chunks are already written.
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "AdminJobLogResponse".
 */
export interface AdminJobLogResponse {
  text: string;
  next: number;
  more: boolean;
}
/**
 * One lane of the solver host (ADR-107): the jobs running in it and the jobs waiting for it, oldest first.
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "AdminLane".
 */
export interface AdminLane {
  lane: "solve" | "light";
  /**
   * Claimed or running.
   */
  running: AdminJob[];
  queued: AdminJob[];
}
/**
 * Something the admin should act on, shown on the dashboard only (Shubham, 2026-10-22).
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "AdminAlert".
 */
export interface AdminAlert {
  kind: "no_host" | "host_offline" | "queue_paused";
  level: "warning" | "error";
  /**
   * What is wrong and what to do, in plain words.
   */
  message: string;
}
/**
 * Answer of GET /api/admin/overview and PUT /api/admin/queue-paused: the solver host and its latest load, the lanes and their queues, whether the queue is paused, and the alerts.
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "OverviewResponse".
 */
export interface OverviewResponse {
  machines: "cloud" | "vps" | "local";
  /**
   * True while the admin has paused the queue: no job starts, running jobs finish, new jobs still queue.
   */
  paused: boolean;
  /**
   * When the admin paused it, ISO 8601 UTC; null while it runs.
   */
  pausedAt: string | null;
  /**
   * The solver host that checked in last; null when none ever has.
   */
  host: SolverHost | null;
  /**
   * That host's latest load sample in the last 10 minutes, or null.
   */
  load: HostLoadSample | null;
  /**
   * The solve lane, then the light lane.
   */
  lanes: AdminLane[];
  alerts: AdminAlert[];
}
/**
 * Body of PUT /api/admin/queue-paused.
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "SetQueuePausedRequest".
 */
export interface SetQueuePausedRequest {
  paused: boolean;
}
/**
 * Body of PUT /api/admin/machine-sizes/{name}.
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "SwitchCloudSizeRequest".
 */
export interface SwitchCloudSizeRequest {
  enabled: boolean;
}
/**
 * Body of PUT /api/admin/machine-hours-cap.
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "SetMachineHoursCapRequest".
 */
export interface SetMachineHoursCapRequest {
  /**
   * Machine hours per calendar month (UTC); 744 is one machine for a whole month.
   */
  hours: number;
}
/**
 * Body of POST /api/admin/allowed.
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "AddAllowedRequest".
 */
export interface AddAllowedRequest {
  email: string;
}

export const validateAllowedEmail = validator<AllowedEmail>(schema, "AllowedEmail");
export const validateAdminUser = validator<AdminUser>(schema, "AdminUser");
export const validateCloudMachineSize = validator<CloudMachineSize>(schema, "CloudMachineSize");
export const validateMachineStart = validator<MachineStart>(schema, "MachineStart");
export const validateSolverHost = validator<SolverHost>(schema, "SolverHost");
export const validateSolverMachines = validator<SolverMachines>(schema, "SolverMachines");
export const validateAdminResponse = validator<AdminResponse>(schema, "AdminResponse");
export const validateJobTry = validator<JobTry>(schema, "JobTry");
export const validateJobTriesResponse = validator<JobTriesResponse>(schema, "JobTriesResponse");
export const validateHostLoadSample = validator<HostLoadSample>(schema, "HostLoadSample");
export const validateHostLoadResponse = validator<HostLoadResponse>(schema, "HostLoadResponse");
export const validateAdminEvent = validator<AdminEvent>(schema, "AdminEvent");
export const validateEventsResponse = validator<EventsResponse>(schema, "EventsResponse");
export const validateAdminJob = validator<AdminJob>(schema, "AdminJob");
export const validateAdminJobsResponse = validator<AdminJobsResponse>(schema, "AdminJobsResponse");
export const validateAdminJobResponse = validator<AdminJobResponse>(schema, "AdminJobResponse");
export const validateAdminJobLogResponse = validator<AdminJobLogResponse>(schema, "AdminJobLogResponse");
export const validateAdminLane = validator<AdminLane>(schema, "AdminLane");
export const validateAdminAlert = validator<AdminAlert>(schema, "AdminAlert");
export const validateOverviewResponse = validator<OverviewResponse>(schema, "OverviewResponse");
export const validateSetQueuePausedRequest = validator<SetQueuePausedRequest>(schema, "SetQueuePausedRequest");
export const validateSwitchCloudSizeRequest = validator<SwitchCloudSizeRequest>(schema, "SwitchCloudSizeRequest");
export const validateSetMachineHoursCapRequest = validator<SetMachineHoursCapRequest>(schema, "SetMachineHoursCapRequest");
export const validateAddAllowedRequest = validator<AddAllowedRequest>(schema, "AddAllowedRequest");
