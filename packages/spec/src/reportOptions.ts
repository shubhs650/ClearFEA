// SPDX-License-Identifier: AGPL-3.0-or-later
// Report options (M7.1, ADR-074): the sections a report can print, in the order it prints them,
// with their names, and the options a simulation starts with. Pure: the API, the web app and,
// through the same schema, the report job share them.

import { type ReportOptions, type ReportSection, ReportSectionValues } from "./generated/report";

/** What each section is called in the report options and as its heading, in printing order. */
export const reportSectionLabels: Record<ReportSection, string> = {
  project: "Project and revision",
  geometry: "Geometry and units",
  materials: "Materials",
  mesh: "Mesh statistics",
  loadsSupports: "Loads and supports, with a picture of each",
  solver: "Solver settings and versions",
  results: "Result plots",
  reactions: "Reaction and balance check",
  extremes: "Minimum and maximum tables",
  warnings: "Run warnings",
};

/**
 * Every section, no views, the simulation's name as the title, and the project's unit system,
 * which the report prints every value in (M7.6, ADR-076).
 */
export function defaultReportOptions(simulationName: string, unitSystem: string): ReportOptions {
  return {
    sections: [...ReportSectionValues],
    views: [],
    titleBlock: {
      title: simulationName.slice(0, 200),
      documentNumber: "",
      revision: "",
      preparedBy: "",
      checkedBy: "",
      approvedBy: "",
    },
    unitSystem,
  };
}

/** The options with their sections in printing order, as they are stored. */
export function orderedReportOptions(options: ReportOptions): ReportOptions {
  const chosen = new Set(options.sections);
  return { ...options, sections: ReportSectionValues.filter((s) => chosen.has(s)) };
}
