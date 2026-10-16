// SPDX-License-Identifier: AGPL-3.0-or-later
// The standing notes a run's report prints when its setup calls for them (../report-notes.json,
// PLAN M4.5, ADR-062), checked against their schema when first imported. Pure: the web app shows
// them with a run's results and, from M7, the report prints them.

import table from "../report-notes.json";
import { type ReportNote, type ReportNotes, validateReportNotes } from "./generated/report-notes";
import type { SimulationSpec } from "./generated/simulation";
import { bondIsTied } from "./simulation";

export function checkReportNotes(raw: unknown, source = "packages/spec/report-notes.json"): ReportNotes {
  const checked = validateReportNotes(raw);
  if (!checked.ok) {
    throw new Error(`${source} does not match its schema: ${checked.errors.join("; ")}`);
  }
  const ids = new Set<string>();
  for (const note of checked.value.notes) {
    if (ids.has(note.id)) throw new Error(`${source}: note ${note.id} is listed twice.`);
    ids.add(note.id);
  }
  return checked.value;
}

export const reportNotes: ReportNotes = checkReportNotes(table);

/**
 * True when a run's frozen setup ties at least one bond. Runs freeze their bond list (ADR-060
 * item 7); a run without one was made before M4.3 and tied nothing.
 */
export function hasTiedBonds(spec: SimulationSpec): boolean {
  return (spec.bonds ?? []).some((bond) => bondIsTied(bond.status));
}

/** The notes a run with this frozen setup carries, in the order a report prints them. */
export function runReportNotes(spec: SimulationSpec, notes: ReportNotes = reportNotes): ReportNote[] {
  return notes.notes.filter((note) => {
    switch (note.appliesWhen) {
      case "tiedBonds":
        return hasTiedBonds(spec);
    }
  });
}
