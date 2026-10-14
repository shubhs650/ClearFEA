// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for /api/jobs. Shapes: packages/spec/schemas/jobs.schema.json.

import {
  type JobView,
  validateJobListResponse,
  validateJobResponse,
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
