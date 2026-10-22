// SPDX-License-Identifier: AGPL-3.0-or-later
// The standing statements every run's report prints and the notes it prints when its setup calls
// for them (../report-notes.json, PLAN M4.5, M7.5, ADR-062, ADR-073), checked against their schema
// when first imported. Pure: the web app shows the notes with a run's results and the report
// prints both.

import table from "../report-notes.json";
import { ITERATIVE_ACCURACY_NOTE, isIterative, SOLVER_LABELS } from "./estimator";
import { type ReportNote, type ReportNoteCondition, type ReportNotes, validateReportNotes } from "./generated/report-notes";
import type { RunSoftware, SimulationSpec, SolveResult, Solver } from "./generated/simulation";
import { bondIsTied } from "./simulation";

/** The names a statement can hold in braces, filled from the run by `runReportStatements`. */
export const STATEMENT_FIELDS = ["clearfea", "deckFormat", "calculix", "gmsh", "occt", "solver", "verificationUrl"] as const;
export type StatementField = (typeof STATEMENT_FIELDS)[number];

const FIELD = /\{([^{}]*)\}/g;

export function checkReportNotes(raw: unknown, source = "packages/spec/report-notes.json"): ReportNotes {
  const checked = validateReportNotes(raw);
  if (!checked.ok) {
    throw new Error(`${source} does not match its schema: ${checked.errors.join("; ")}`);
  }
  const ids = new Set<string>();
  for (const item of [...checked.value.statements, ...checked.value.notes]) {
    if (ids.has(item.id)) throw new Error(`${source}: ${item.id} is listed twice.`);
    ids.add(item.id);
  }
  for (const statement of checked.value.statements) {
    for (const [, name] of statement.text.matchAll(FIELD)) {
      if (!(STATEMENT_FIELDS as readonly (string | undefined)[]).includes(name)) {
        throw new Error(`${source}: statement ${statement.id} names {${name}}, which no run fills.`);
      }
    }
  }
  for (const note of checked.value.notes) {
    if (/\{[^{}]*\}/.test(note.text)) throw new Error(`${source}: note ${note.id} has a name in braces; only statements are filled.`);
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

/** Whether a run with this frozen setup meets each condition a note can have. */
const CONDITIONS: Record<ReportNoteCondition, (spec: SimulationSpec) => boolean> = {
  tiedBonds: hasTiedBonds,
};

/** The notes a run with this frozen setup carries, in the order a report prints them. */
export function runReportNotes(spec: SimulationSpec, notes: ReportNotes = reportNotes): ReportNote[] {
  return notes.notes.filter((note) => CONDITIONS[note.appliesWhen](spec));
}

/**
 * The equation solver a run with this frozen setup used. Its result names it since M12.2, which
 * differs from the setup's when PaStiX crashed and the run was solved again with SPOOLES
 * (ADR-108). Runs frozen before ADR-063 name none and were solved with SPOOLES, the packaged
 * build's default; specs saved since name theirs.
 */
export function frozenRunSolver(spec: SimulationSpec, result: Pick<SolveResult, "solver"> | null = null): Solver {
  return result?.solver ?? spec.solver ?? "spooles";
}

/** What a report needs of a run to fill its statements: the frozen setup, recorded versions and result. */
export interface StatementRun {
  spec: SimulationSpec;
  software: RunSoftware;
  result?: Pick<SolveResult, "solver"> | null;
}

/** A statement as printed: its names filled from the run. */
export interface FilledStatement {
  id: string;
  title: string;
  text: string;
}

/** Printed where a run did not record a version, for example a run made before M1.10. */
export const NOT_RECORDED = "(not recorded)";

/**
 * The standing statements of a run's report, in the order it prints them, with every name in
 * braces filled from the run. A statement naming the solver also carries the iterative solvers'
 * accuracy note when the run used one (ADR-063 item 8).
 */
export function runReportStatements(run: StatementRun, notes: ReportNotes = reportNotes): FilledStatement[] {
  const solver = frozenRunSolver(run.spec, run.result ?? null);
  const recorded = (value: string | number | null) => (value === null ? NOT_RECORDED : String(value));
  const values: Record<StatementField, string> = {
    clearfea: recorded(run.software.clearfea),
    deckFormat: recorded(run.software.deckFormat),
    calculix: recorded(run.software.calculix),
    gmsh: recorded(run.software.gmsh),
    occt: recorded(run.software.occt),
    solver: SOLVER_LABELS[solver],
    verificationUrl: notes.verificationUrl,
  };
  return notes.statements.map((statement) => {
    let text = statement.text.replace(FIELD, (_, name: StatementField) => values[name]);
    if (statement.text.includes("{solver}") && isIterative(solver)) text = `${text} ${ITERATIVE_ACCURACY_NOTE}`;
    return { id: statement.id, title: statement.title, text };
  });
}
