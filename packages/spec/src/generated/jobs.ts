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
 * Wire shapes of the worker's internal job routes (docs/ARCHITECTURE.md sections 6 and 8). Each message is a definition under $defs.
 */
export interface Jobs {
  [k: string]: unknown;
}
/**
 * This interface was referenced by `Jobs`'s JSON-Schema
 * via the `definition` "ClaimedJob".
 */
export interface ClaimedJob {
  id: string;
  type: JobType;
  targetId: string | null;
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
export const validateErrorResponse = validator<ErrorResponse>(schema, "ErrorResponse");
