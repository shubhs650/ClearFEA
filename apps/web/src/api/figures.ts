// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for a run's report figures (M7.2, ADR-011): PNGs drawn in the browser and stored for the
// report. Shapes: packages/spec/schemas/report.schema.json.

import {
  type ReportFigure,
  type ReportFigureKind,
  validateReportFigureListResponse,
  validateReportFigureResponse,
} from "@clearfea/spec";
import { type ApiResult, apiRequest, apiUpload } from "./request";

const figuresPath = (runId: string) => `/api/runs/${encodeURIComponent(runId)}/figures`;

/** Where a figure's image is served; its capture time makes the browser fetch a new one. */
export const figurePath = (runId: string, figure: Pick<ReportFigure, "kind" | "item" | "createdAt">) =>
  `${figuresPath(runId)}/${figure.kind}/${encodeURIComponent(figure.item)}?v=${encodeURIComponent(figure.createdAt)}`;

function figures(result: ApiResult<{ figures: ReportFigure[] }>): ApiResult<ReportFigure[]> {
  return result.kind === "ok" ? { kind: "ok", value: result.value.figures } : result;
}

/** The run's figures, in order. */
export async function listFigures(runId: string): Promise<ApiResult<ReportFigure[]>> {
  return figures(await apiRequest("GET", figuresPath(runId), validateReportFigureListResponse));
}

/** Removes every figure of the run, before a new set is captured. */
export async function clearFigures(runId: string): Promise<ApiResult<ReportFigure[]>> {
  return figures(await apiRequest("DELETE", figuresPath(runId), validateReportFigureListResponse));
}

/** Stores one figure of the run, replacing the one of the same kind and item. */
export async function saveFigure(
  runId: string,
  kind: ReportFigureKind,
  item: string,
  caption: string,
  position: number,
  image: Blob,
): Promise<ApiResult<ReportFigure>> {
  const path = `${figuresPath(runId)}/${kind}/${encodeURIComponent(item)}?caption=${encodeURIComponent(caption)}&position=${position}`;
  const result = await apiUpload(path, validateReportFigureResponse, image, "PUT");
  return result.kind === "ok" ? { kind: "ok", value: result.value.figure } : result;
}
