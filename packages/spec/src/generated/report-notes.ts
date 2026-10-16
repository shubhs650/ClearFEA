// SPDX-License-Identifier: AGPL-3.0-or-later
// Generated from packages/spec/schemas/report-notes.schema.json by packages/spec/scripts/generate.mjs.
// Do not edit by hand; change the schema and run `make spec`.

import schema from "../../schemas/report-notes.schema.json";
import { validator } from "../validate";

/**
 * When a run's report carries the note. tiedBonds: the run's frozen setup ties at least one bond (a bond the user has not removed, ADR-059, ADR-060).
 *
 * This interface was referenced by `ReportNotes`'s JSON-Schema
 * via the `definition` "ReportNoteCondition".
 */
export type ReportNoteCondition = "tiedBonds";

/**
 * Shape of packages/spec/report-notes.json: the standing notes a run's report prints when its setup calls for them (PLAN M4.5, M7.5; ADR-062). Each note is plain text, written once here and read by the web app and, from M7, the report job. Numbers only: no note may state a verdict (CLAUDE.md).
 */
export interface ReportNotes {
  /**
   * Bumped whenever a note's text changes, so a report can say which wording it printed.
   */
  version: number;
  /**
   * Every note, in the order a report prints them.
   */
  notes: ReportNote[];
}
/**
 * This interface was referenced by `ReportNotes`'s JSON-Schema
 * via the `definition` "ReportNote".
 */
export interface ReportNote {
  /**
   * Stable name of the note.
   */
  id: string;
  appliesWhen: ReportNoteCondition;
  /**
   * Heading of the note in the report.
   */
  title: string;
  /**
   * The note's paragraph, as printed.
   */
  text: string;
  /**
   * Where the note's figures come from, for people; not printed.
   */
  source: string;
}

export const validateReportNotes = validator<ReportNotes>(schema);
export const ReportNoteConditionValues = ["tiedBonds"] as const satisfies readonly ReportNoteCondition[];
export const validateReportNoteCondition = validator<ReportNoteCondition>(schema, "ReportNoteCondition");
export const validateReportNote = validator<ReportNote>(schema, "ReportNote");
