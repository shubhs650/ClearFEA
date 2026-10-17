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
 * Shape of packages/spec/report-notes.json: the standing statements every run's report prints and the notes it prints when its setup calls for them (PLAN M4.5, M7.5; ADR-062, ADR-073). Each is plain text, written once here and read by the web app and the report. Numbers only: no statement or note may state a verdict (CLAUDE.md).
 */
export interface ReportNotes {
  /**
   * Bumped whenever a statement's or note's text changes, so a report can say which wording it printed.
   */
  version: number;
  /**
   * Where a report's reader finds ClearFEA's verification cases, their references and tolerances (DECISIONS Positioning). Filled into statements as {verificationUrl}.
   */
  verificationUrl: string;
  /**
   * What every report prints, whatever the run, in the order a report prints them (PLAN M7.5).
   */
  statements: ReportStatement[];
  /**
   * Every note, in the order a report prints them.
   */
  notes: ReportNote[];
}
/**
 * This interface was referenced by `ReportNotes`'s JSON-Schema
 * via the `definition` "ReportStatement".
 */
export interface ReportStatement {
  /**
   * Stable name of the statement.
   */
  id: string;
  /**
   * Heading of the statement in the report.
   */
  title: string;
  /**
   * The statement's paragraph. A name in braces is filled from the run when the report is made: {clearfea}, {deckFormat}, {calculix}, {gmsh} and {occt} from its recorded versions, {solver} from its frozen setup, and {verificationUrl} from this file.
   */
  text: string;
  /**
   * Where the statement comes from, for people; not printed.
   */
  source: string;
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
export const validateReportStatement = validator<ReportStatement>(schema, "ReportStatement");
export const ReportNoteConditionValues = ["tiedBonds"] as const satisfies readonly ReportNoteCondition[];
export const validateReportNoteCondition = validator<ReportNoteCondition>(schema, "ReportNoteCondition");
export const validateReportNote = validator<ReportNote>(schema, "ReportNote");
