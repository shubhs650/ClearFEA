// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for /api/admin (M10.3, ADR-097). Shapes: packages/spec/schemas/admin.schema.json.

import {
  type AdminJobLogResponse,
  type AdminJobResponse,
  type AdminJobsResponse,
  type AdminResponse,
  type EventsResponse,
  type JobTriesResponse,
  type OverviewResponse,
  validateAdminJobLogResponse,
  validateAdminJobResponse,
  validateAdminJobsResponse,
  validateAdminResponse,
  validateEventsResponse,
  validateJobTriesResponse,
  validateOverviewResponse,
} from "@clearfea/spec";
import { type ApiResult, apiRequest } from "./request";

export function fetchAdmin(): Promise<ApiResult<AdminResponse>> {
  return apiRequest("GET", "/api/admin", validateAdminResponse);
}

export function addAllowed(email: string): Promise<ApiResult<AdminResponse>> {
  return apiRequest("POST", "/api/admin/allowed", validateAdminResponse, { email });
}

export function removeAllowed(email: string): Promise<ApiResult<AdminResponse>> {
  return apiRequest("DELETE", `/api/admin/allowed/${encodeURIComponent(email)}`, validateAdminResponse);
}

export function switchCloudSize(name: string, enabled: boolean): Promise<ApiResult<AdminResponse>> {
  return apiRequest("PUT", `/api/admin/machine-sizes/${encodeURIComponent(name)}`, validateAdminResponse, { enabled });
}

export function setMachineHoursCap(hours: number): Promise<ApiResult<AdminResponse>> {
  return apiRequest("PUT", "/api/admin/machine-hours-cap", validateAdminResponse, { hours });
}

// The dashboard (M13.2, ADR-127): the Overview with pause and resume, every user's jobs with their
// tries, logs, cancel and re-queue, and the event log (M13.1).

export function fetchOverview(): Promise<ApiResult<OverviewResponse>> {
  return apiRequest("GET", "/api/admin/overview", validateOverviewResponse);
}

export function setQueuePaused(paused: boolean): Promise<ApiResult<OverviewResponse>> {
  return apiRequest("PUT", "/api/admin/queue-paused", validateOverviewResponse, { paused });
}

/** Query values of a list route, leaving out the ones not set. */
function query(values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) if (value !== undefined && value !== "") params.set(name, value);
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

export function fetchAdminJobs(filter: {
  status?: string;
  type?: string;
  before?: string;
  limit?: number;
}): Promise<ApiResult<AdminJobsResponse>> {
  const { limit, ...rest } = filter;
  return apiRequest(
    "GET",
    `/api/admin/jobs${query({ ...rest, limit: limit === undefined ? undefined : String(limit) })}`,
    validateAdminJobsResponse,
  );
}

export function fetchJobTries(jobId: string): Promise<ApiResult<JobTriesResponse>> {
  return apiRequest("GET", `/api/admin/stats/jobs${query({ job: jobId })}`, validateJobTriesResponse);
}

export function fetchAdminJobLog(jobId: string, after: number): Promise<ApiResult<AdminJobLogResponse>> {
  return apiRequest(
    "GET",
    `/api/admin/jobs/${encodeURIComponent(jobId)}/log?after=${after}`,
    validateAdminJobLogResponse,
  );
}

export function adminJobAction(jobId: string, action: "cancel" | "requeue"): Promise<ApiResult<AdminJobResponse>> {
  return apiRequest("POST", `/api/admin/jobs/${encodeURIComponent(jobId)}/${action}`, validateAdminJobResponse);
}

export function fetchEvents(filter: {
  kind?: string;
  level?: string;
  before?: string;
  limit?: number;
}): Promise<ApiResult<EventsResponse>> {
  const { limit, ...rest } = filter;
  return apiRequest(
    "GET",
    `/api/admin/events${query({ ...rest, limit: limit === undefined ? undefined : String(limit) })}`,
    validateEventsResponse,
  );
}
