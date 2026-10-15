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
export type CompleteRequest = CompleteSucceeded | CompleteFailed;

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
 * Body of POST /internal/jobs/claim.
 *
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "ClaimRequest".
 */
export interface ClaimRequest {
  workerId: WorkerId;
  jobTypes: JobType[];
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
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "CompleteSucceeded".
 */
export interface CompleteSucceeded {
  workerId: WorkerId;
  status: "succeeded";
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
  failureCategory: FailureCategory;
  failureCause: string;
  /**
   * What went wrong and what to do about it, in plain language for the job's owner.
   */
  failureMessage?: string;
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
export const validateClaimRequest = validator<ClaimRequest>(schema, "ClaimRequest");
export const validateClaimResponse = validator<ClaimResponse>(schema, "ClaimResponse");
export const validateHeartbeatRequest = validator<HeartbeatRequest>(schema, "HeartbeatRequest");
export const validateHeartbeatResponse = validator<HeartbeatResponse>(schema, "HeartbeatResponse");
export const validateCompleteSucceeded = validator<CompleteSucceeded>(schema, "CompleteSucceeded");
export const validateCompleteFailed = validator<CompleteFailed>(schema, "CompleteFailed");
export const validateCompleteRequest = validator<CompleteRequest>(schema, "CompleteRequest");
export const validateCompletedJob = validator<CompletedJob>(schema, "CompletedJob");
export const validateCompleteResponse = validator<CompleteResponse>(schema, "CompleteResponse");
export const validateCreateJobRequest = validator<CreateJobRequest>(schema, "CreateJobRequest");
export const validateJobView = validator<JobView>(schema, "JobView");
export const validateJobResponse = validator<JobResponse>(schema, "JobResponse");
export const validateJobListResponse = validator<JobListResponse>(schema, "JobListResponse");
export const validateErrorResponse = validator<ErrorResponse>(schema, "ErrorResponse");
