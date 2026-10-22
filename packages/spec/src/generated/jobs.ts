// SPDX-License-Identifier: AGPL-3.0-or-later
// Generated from packages/spec/schemas/jobs.schema.json by packages/spec/scripts/generate.mjs.
// Do not edit by hand; change the schema and run `make spec`.

import schema from "../../schemas/jobs.schema.json";
import { validator } from "../validate";

/**
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "JobType".
 */
export type JobType = "noop" | "import" | "mesh" | "solve" | "report";
/**
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "JobStatus".
 */
export type JobStatus = "queued" | "claimed" | "running" | "succeeded" | "failed" | "cancelled" | "stopped_at_limit";
/**
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "FailureCategory".
 */
export type FailureCategory = "user_fault" | "platform_fault";
/**
 * What the worker should do next: carry on, or end the job because the user cancelled it or it reached its stop limit.
 *
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "HeartbeatAction".
 */
export type HeartbeatAction = "continue" | "cancel" | "stop";
/**
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "WorkerId".
 */
export type WorkerId = string;
/**
 * Body of POST /internal/jobs/{id}/complete.
 *
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "CompleteRequest".
 */
export type CompleteRequest = CompleteSucceeded | CompleteFailed | CompleteStopped;

/**
 * Wire shapes of the job routes: the worker's internal routes and the signed-in user's public routes (docs/ARCHITECTURE.md sections 6 and 8). Each message is a definition under $defs.
 */
export interface Jobs {
  [k: string]: unknown;
}
/**
 * One file a job reads or writes (ADR-005). Locally the url points at the API's /internal/jobs/{id}/files route and needs the worker token; in the cloud it is a presigned storage URL.
 *
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "Transfer".
 */
export interface Transfer {
  /**
   * The file's name within the job, for example model.step.
   */
  name: string;
  direction: "download" | "upload";
  url: string;
}
/**
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "ClaimedJob".
 */
export interface ClaimedJob {
  id: string;
  type: JobType;
  targetId: string | null;
  /**
   * Job-type specific parameters, for example an ImportParams (geometry.schema.json); null when the type has none.
   */
  params: {} | null;
  transfers: Transfer[];
}
/**
 * Versions of the worker that claims a job (ADR-032), recorded on the job so a run can state what produced it. Null where the worker lacks the program.
 *
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "WorkerSoftware".
 */
export interface WorkerSoftware {
  /**
   * The worker package's version, with the source commit it was built from after a + when known, for example 0.0.0+d9d394b.
   */
  clearfea: string;
  /**
   * The deck generator's DECK_FORMAT.
   */
  deckFormat: number;
  calculix: string | null;
  gmsh: string | null;
}
/**
 * Body of POST /internal/jobs/claim.
 *
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "ClaimRequest".
 */
export interface ClaimRequest {
  workerId: WorkerId;
  jobTypes: JobType[];
  software?: WorkerSoftware;
  /**
   * The machine size the worker runs on (M10.6, ADR-099), from CLEARFEA_MACHINE_SIZE: it is given only that size's jobs, and the default size's also takes the jobs that have no size (import, report). Left out by a local worker, which takes every size's jobs.
   */
  machineSize?: string;
}
/**
 * Answer to a claim when a job was claimed (HTTP 200). No job to claim is HTTP 204 with no body.
 *
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "ClaimResponse".
 */
export interface ClaimResponse {
  job: ClaimedJob;
}
/**
 * Body of POST /internal/jobs/{id}/heartbeat.
 *
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "HeartbeatRequest".
 */
export interface HeartbeatRequest {
  workerId: WorkerId;
  stage?: string | null;
  /**
   * Log text the job wrote since the previous heartbeat, appended to the job's log as one chunk (ADR-030).
   */
  log?: string;
}
/**
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "HeartbeatResponse".
 */
export interface HeartbeatResponse {
  action: HeartbeatAction;
}
/**
 * Body of POST /internal/hosts/check-in (M12.4, ADR-120): the solver host's compute manager says it is up, at start and every intervalSeconds whatever its lanes are doing. With MACHINES=vps the API refuses new jobs while no host has checked in for 120 s.
 *
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "HostCheckIn".
 */
export interface HostCheckIn {
  /**
   * The host's name, as the admin page shows it.
   */
  host: string;
  managerVersion?: string;
}
/**
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "HostCheckInResponse".
 */
export interface HostCheckInResponse {
  /**
   * Seconds until the next check-in is due.
   */
  intervalSeconds: number;
}
/**
 * What the worker measured of a job (ADR-033): billableMs is the wall-clock time from the start to the end of the job's handler on the machine, in whole milliseconds. Queue time and the worker's start-up are outside it. Sent for every job; the API charges only metered job types.
 *
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "Metering".
 */
export interface Metering {
  billableMs: number;
  /**
   * The largest resident memory of the job's solver the worker measured, or the job container's memory limit when the kernel stopped it there (M12.2, ADR-108). Absent where it was not measured.
   */
  peakMemoryBytes?: number;
}
/**
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "CompleteSucceeded".
 */
export interface CompleteSucceeded {
  workerId: WorkerId;
  status: "succeeded";
  metering: Metering;
  /**
   * Job-type specific summary, stored as given.
   */
  result?: {};
}
/**
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "CompleteFailed".
 */
export interface CompleteFailed {
  workerId: WorkerId;
  status: "failed";
  metering: Metering;
  failureCategory: FailureCategory;
  failureCause: string;
  /**
   * What went wrong and what to do about it, in plain language for the job's owner.
   */
  failureMessage?: string;
}
/**
 * The worker ended the job because a heartbeat told it to (cancel or stop, M8.2): it reports the time it used. The API records the job as cancelled or stopped at its limit, as it asked, and charges the time (DECISIONS "Failed runs").
 *
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "CompleteStopped".
 */
export interface CompleteStopped {
  workerId: WorkerId;
  status: "stopped";
  metering: Metering;
}
/**
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "CompletedJob".
 */
export interface CompletedJob {
  id: string;
  type: JobType;
  targetId: string | null;
  status: JobStatus;
}
/**
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "CompleteResponse".
 */
export interface CompleteResponse {
  job: CompletedJob;
}
/**
 * Body of POST /api/jobs. Only a noop job is queued directly; later job types are created by the routes for the records they work on.
 *
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "CreateJobRequest".
 */
export interface CreateJobRequest {
  type: "noop";
}
/**
 * A job as its owner sees it. Timestamps are ISO 8601 UTC strings.
 *
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "JobView".
 */
export interface JobView {
  id: string;
  type: JobType;
  targetId: string | null;
  status: JobStatus;
  stage: string | null;
  failureCategory: FailureCategory | null;
  failureCause: string | null;
  failureMessage: string | null;
  createdAt: string;
  claimedAt: string | null;
  finishedAt: string | null;
}
/**
 * Answer to POST /api/jobs (HTTP 201) and GET /api/jobs/{id}.
 *
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "JobResponse".
 */
export interface JobResponse {
  job: JobView;
  wait?: JobWait;
}
/**
 * How a job that has not finished is getting on (M11.2, ADR-112). Sent as `wait` with the answers the screens poll while a job works on what they show: GET /api/jobs/{id}, /api/geometries/{id}, /api/simulations/{id}/mesh, /api/runs/{id} and /api/runs/{id}/report. Left out once the job has finished.
 *
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "JobWait".
 */
export interface JobWait {
  status: JobStatus;
  /**
   * While the job is queued, its place among the queued jobs of its machine size, counting every user's jobs: 1 is next. Null once a worker has claimed it.
   */
  queuePosition: number | null;
  /**
   * True on the live site while the job is queued and no machine of its size is running, or one is being started (ADR-103). Always false locally, where the worker is always there.
   */
  machineStarting: boolean;
  /**
   * Seconds after which asking again is worth it. The browser waits at least this long, and never more than 30 s.
   */
  retryAfter: number;
}
/**
 * Answer to GET /api/jobs: the signed-in user's most recent jobs, newest first.
 *
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "JobListResponse".
 */
export interface JobListResponse {
  jobs: JobView[];
}
/**
 * Body of any 4xx or 5xx answer: what is wrong and what to do about it.
 *
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "ErrorResponse".
 */
export interface ErrorResponse {
  error: string;
}

export const JobTypeValues = ["noop", "import", "mesh", "solve", "report"] as const satisfies readonly JobType[];
export const validateJobType = validator<JobType>(schema, "JobType");
export const JobStatusValues = ["queued", "claimed", "running", "succeeded", "failed", "cancelled", "stopped_at_limit"] as const satisfies readonly JobStatus[];
export const validateJobStatus = validator<JobStatus>(schema, "JobStatus");
export const FailureCategoryValues = ["user_fault", "platform_fault"] as const satisfies readonly FailureCategory[];
export const validateFailureCategory = validator<FailureCategory>(schema, "FailureCategory");
export const HeartbeatActionValues = ["continue", "cancel", "stop"] as const satisfies readonly HeartbeatAction[];
export const validateHeartbeatAction = validator<HeartbeatAction>(schema, "HeartbeatAction");
export const validateWorkerId = validator<WorkerId>(schema, "WorkerId");
export const validateTransfer = validator<Transfer>(schema, "Transfer");
export const validateClaimedJob = validator<ClaimedJob>(schema, "ClaimedJob");
export const validateWorkerSoftware = validator<WorkerSoftware>(schema, "WorkerSoftware");
export const validateClaimRequest = validator<ClaimRequest>(schema, "ClaimRequest");
export const validateClaimResponse = validator<ClaimResponse>(schema, "ClaimResponse");
export const validateHeartbeatRequest = validator<HeartbeatRequest>(schema, "HeartbeatRequest");
export const validateHeartbeatResponse = validator<HeartbeatResponse>(schema, "HeartbeatResponse");
export const validateHostCheckIn = validator<HostCheckIn>(schema, "HostCheckIn");
export const validateHostCheckInResponse = validator<HostCheckInResponse>(schema, "HostCheckInResponse");
export const validateMetering = validator<Metering>(schema, "Metering");
export const validateCompleteSucceeded = validator<CompleteSucceeded>(schema, "CompleteSucceeded");
export const validateCompleteFailed = validator<CompleteFailed>(schema, "CompleteFailed");
export const validateCompleteStopped = validator<CompleteStopped>(schema, "CompleteStopped");
export const validateCompleteRequest = validator<CompleteRequest>(schema, "CompleteRequest");
export const validateCompletedJob = validator<CompletedJob>(schema, "CompletedJob");
export const validateCompleteResponse = validator<CompleteResponse>(schema, "CompleteResponse");
export const validateCreateJobRequest = validator<CreateJobRequest>(schema, "CreateJobRequest");
export const validateJobView = validator<JobView>(schema, "JobView");
export const validateJobResponse = validator<JobResponse>(schema, "JobResponse");
export const validateJobListResponse = validator<JobListResponse>(schema, "JobListResponse");
export const validateJobWait = validator<JobWait>(schema, "JobWait");
export const validateErrorResponse = validator<ErrorResponse>(schema, "ErrorResponse");
