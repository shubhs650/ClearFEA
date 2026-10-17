// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for a run's report (M7.3, ADR-077): ask for one, check on it, download its Word file or
// its PDF (M7.4, ADR-078).
// Shapes: packages/spec/schemas/report.schema.json.

import { type RunReport, validateRunReportResponse } from "@clearfea/spec";
import { type ApiResult, apiRequest } from "./request";

const reportPath = (runId: string) => `/api/runs/${encodeURIComponent(runId)}/report`;

/** Where the run's latest finished report is downloaded; its id makes the browser fetch a new one. */
export const reportFilePath = (runId: string, report: Pick<RunReport, "id">, format: "docx" | "pdf") =>
  `${reportPath(runId)}/${format}?v=${encodeURIComponent(report.id)}`;

function report(result: ApiResult<{ report: RunReport | null }>): ApiResult<RunReport | null> {
  return result.kind === "ok" ? { kind: "ok", value: result.value.report } : result;
}

/** The run's latest report, or null when none was asked for. */
export async function fetchRunReport(runId: string): Promise<ApiResult<RunReport | null>> {
  return report(await apiRequest("GET", reportPath(runId), validateRunReportResponse));
}

/** Asks for a new report of the run, made from its figures as stored now. */
export async function makeRunReport(runId: string): Promise<ApiResult<RunReport | null>> {
  return report(await apiRequest("POST", reportPath(runId), validateRunReportResponse));
}
