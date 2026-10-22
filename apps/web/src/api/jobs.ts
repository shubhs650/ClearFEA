// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for /api/jobs. Shapes: packages/spec/schemas/jobs.schema.json.

import {
  type JobView,
  type JobWait,
  validateJobListResponse,
  validateJobResponse,
  validateJobWait,
} from "@clearfea/spec";
import { type ApiResult, apiRequest } from "./request";

export async function listJobs(): Promise<ApiResult<JobView[]>> {
  const result = await apiRequest("GET", "/api/jobs", validateJobListResponse);
  return result.kind === "ok" ? { kind: "ok", value: result.value.jobs } : result;
}

export async function queueNoopJob(): Promise<ApiResult<JobView>> {
  const result = await apiRequest("POST", "/api/jobs", validateJobResponse, { type: "noop" });
  return result.kind === "ok" ? { kind: "ok", value: result.value.job } : result;
}

/** A polled answer: what the screen shows, and how its unfinished job is getting on (M11.2). */
export interface Followed<T> {
  value: T;
  /** Null once the job has finished, or when the answer had no valid wait. */
  wait: JobWait | null;
}

/** The `wait` of a polled answer, checked against the JobWait schema (ADR-112). */
export function readWait(value: unknown): JobWait | null {
  if (value === undefined) return null;
  const valid = validateJobWait(value);
  return valid.ok ? valid.value : null;
}
