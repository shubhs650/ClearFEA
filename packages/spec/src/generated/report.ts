// SPDX-License-Identifier: AGPL-3.0-or-later
// Generated from packages/spec/schemas/report.schema.json by packages/spec/scripts/generate.mjs.
// Do not edit by hand; change the schema and run `make spec`.

import schema from "../../schemas/report.schema.json";
import { validator } from "../validate";

/**
 * A section the report can print, from DECISIONS.md's Report row: project and revision, geometry and units, materials, mesh statistics, each load and support with a picture, solver settings and versions, result plots, the reaction (or heat) balance check, minimum and maximum tables, run warnings. The standing statements (M7.5) are always printed and are not a section.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "ReportSection".
 */
export type ReportSection =
  | "project"
  | "geometry"
  | "materials"
  | "mesh"
  | "loadsSupports"
  | "solver"
  | "results"
  | "reactions"
  | "extremes"
  | "warnings";
/**
 * One line of the title block or the company name, printed as typed; may be empty.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "ReportText".
 */
export type ReportText = string;

/**
 * Report options (M7.1, ADR-074): what a simulation's report prints (its sections, the saved views drawn as result plots, the title block) and the user's own company name and logo, which every report of theirs carries. The report job (M7.3) reads them. Text is printed as typed. Each message is a definition under $defs.
 */
export interface Report {
  [k: string]: unknown;
}
/**
 * The title block printed on the cover and in every page header. Empty fields are left out.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "TitleBlock".
 */
export interface TitleBlock {
  title: ReportText;
  documentNumber: ReportText;
  revision: ReportText;
  preparedBy: ReportText;
  checkedBy: ReportText;
  approvedBy: ReportText;
}
/**
 * Body of PUT /api/simulations/:id/report-options. Sections are printed in the order of ReportSection whatever order they are listed in; views (ids of the simulation's saved views, ADR-055) are drawn as result plots in the order listed.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "ReportOptions".
 */
export interface ReportOptions {
  sections: ReportSection[];
  views: string[];
  titleBlock: TitleBlock;
}
/**
 * Answer to GET and PUT /api/simulations/:id/report-options. Until options are saved the answer holds the defaults (every section, no views, the simulation's name as the title) with saved false. Views deleted since are left out.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "ReportOptionsResponse".
 */
export interface ReportOptionsResponse {
  options: ReportOptions;
  saved: boolean;
  updatedAt: string | null;
}
/**
 * The user's logo: a PNG or JPEG image, its size in bytes and in pixels. The image itself is GET /api/report-branding/logo.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "ReportLogo".
 */
export interface ReportLogo {
  contentType: "image/png" | "image/jpeg";
  sizeBytes: number;
  width: number;
  height: number;
  updatedAt: string;
}
/**
 * The company name and logo every report of the user carries, set once per user.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "ReportBranding".
 */
export interface ReportBranding {
  companyName: ReportText;
  logo: ReportLogo | null;
}
/**
 * Body of PUT /api/report-branding. The logo is sent on its own to POST /api/report-branding/logo.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "SaveReportBrandingRequest".
 */
export interface SaveReportBrandingRequest {
  companyName: ReportText;
}
/**
 * Answer to the /api/report-branding routes.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "ReportBrandingResponse".
 */
export interface ReportBrandingResponse {
  branding: ReportBranding;
}

export const ReportSectionValues = ["project", "geometry", "materials", "mesh", "loadsSupports", "solver", "results", "reactions", "extremes", "warnings"] as const satisfies readonly ReportSection[];
export const validateReportSection = validator<ReportSection>(schema, "ReportSection");
export const validateReportText = validator<ReportText>(schema, "ReportText");
export const validateTitleBlock = validator<TitleBlock>(schema, "TitleBlock");
export const validateReportOptions = validator<ReportOptions>(schema, "ReportOptions");
export const validateReportOptionsResponse = validator<ReportOptionsResponse>(schema, "ReportOptionsResponse");
export const validateReportLogo = validator<ReportLogo>(schema, "ReportLogo");
export const validateReportBranding = validator<ReportBranding>(schema, "ReportBranding");
export const validateSaveReportBrandingRequest = validator<SaveReportBrandingRequest>(schema, "SaveReportBrandingRequest");
export const validateReportBrandingResponse = validator<ReportBrandingResponse>(schema, "ReportBrandingResponse");
