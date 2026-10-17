// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for a simulation's report options and the user's company name and logo (M7.1, ADR-073).
// Shapes: packages/spec/schemas/report.schema.json.

import {
  type ReportBranding,
  type ReportOptions,
  type ReportOptionsResponse,
  validateReportBrandingResponse,
  validateReportOptionsResponse,
} from "@clearfea/spec";
import { type ApiResult, apiRequest, apiUpload } from "./request";

const optionsPath = (simulationId: string) => `/api/simulations/${encodeURIComponent(simulationId)}/report-options`;

/** Where the user's logo is served; a version query makes the browser fetch a replaced logo. */
export const logoPath = (updatedAt: string) => `/api/report-branding/logo?v=${encodeURIComponent(updatedAt)}`;

export function fetchReportOptions(simulationId: string): Promise<ApiResult<ReportOptionsResponse>> {
  return apiRequest("GET", optionsPath(simulationId), validateReportOptionsResponse);
}

export function saveReportOptions(simulationId: string, options: ReportOptions): Promise<ApiResult<ReportOptionsResponse>> {
  return apiRequest("PUT", optionsPath(simulationId), validateReportOptionsResponse, options);
}

function branding(result: ApiResult<{ branding: ReportBranding }>): ApiResult<ReportBranding> {
  return result.kind === "ok" ? { kind: "ok", value: result.value.branding } : result;
}

export async function fetchBranding(): Promise<ApiResult<ReportBranding>> {
  return branding(await apiRequest("GET", "/api/report-branding", validateReportBrandingResponse));
}

export async function saveCompanyName(companyName: string): Promise<ApiResult<ReportBranding>> {
  return branding(await apiRequest("PUT", "/api/report-branding", validateReportBrandingResponse, { companyName }));
}

export async function uploadLogo(file: Blob): Promise<ApiResult<ReportBranding>> {
  return branding(await apiUpload("/api/report-branding/logo", validateReportBrandingResponse, file));
}

export async function deleteLogo(): Promise<ApiResult<ReportBranding>> {
  return branding(await apiRequest("DELETE", "/api/report-branding/logo", validateReportBrandingResponse));
}
