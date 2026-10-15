// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings panel for the run (M1.8): a button that solves the saved setup on the current mesh,
// the latest run's stage and solver log while it solves, and its result figures when done.
// Numbers only: no verdict is ever drawn from them (CLAUDE.md).

import type { RunView } from "@clearfea/spec";
import { Fragment } from "react";
import { fromSi } from "../units/convert";
import { Notes } from "./ItemPanels";
import type { ItemStatus } from "./spec";

/** Units the result figures are shown in until M2.1 brings display-unit choice. */
export const STRESS_UNIT = "MPa";
export const FORCE_UNIT = "N";

function figure(value: number, unit: string, kind: string): string {
  return `${Number(fromSi(value, unit, kind).toPrecision(4))} ${unit}`;
}

function at(position: number[], unit: string): string {
  return `at (${position.map((p) => Number(fromSi(p, unit, "length").toPrecision(4))).join(", ")}) ${unit}`;
}

export function RunPanel({
  status,
  run,
  log,
  blocked,
  lengthUnit,
  supportNames,
  requesting,
  requestProblem,
  onRun,
}: {
  status: ItemStatus | undefined;
  run: RunView | null;
  log: string;
  /** Why the simulation cannot be run now, or null when it can. */
  blocked: string | null;
  /** The unit lengths are shown in: the geometry's own length unit. */
  lengthUnit: string;
  /** Names of the setup's supports by id, for the reaction lines. */
  supportNames: ReadonlyMap<string, string>;
  requesting: boolean;
  requestProblem?: string;
  onRun: () => void;
}) {
  const solving = run?.status === "solving";
  const result = run?.status === "succeeded" ? run.result : null;
  return (
    <section className="setup-panel" aria-label="Run">
      <h2 className="pane-title">Run</h2>
      <Notes status={status} />
      <button type="button" onClick={onRun} disabled={blocked !== null || requesting || solving}>
        {run === null ? "Run" : "Run again"}
      </button>
      {blocked !== null && !solving && <p className="field-hint">{blocked}</p>}
      {requestProblem && (
        <p className="form-problem" role="alert">
          {requestProblem}
        </p>
      )}
      {solving && (
        <p role="status" aria-label="Run stage">
          {run.stage === "queued" || run.stage === null ? "Waiting for the solver…" : `Solver: ${run.stage}…`}
        </p>
      )}
      {result && (
        <dl className="geometry-facts" aria-label="Run results">
          <dt>Largest displacement</dt>
          <dd>
            {figure(result.displacement.max.value, lengthUnit, "length")}{" "}
            <span className="field-hint">{at(result.displacement.max.position, lengthUnit)}</span>
          </dd>
          <dt>Largest von Mises stress</dt>
          <dd>
            {figure(result.vonMises.max.value, STRESS_UNIT, "pressure")}{" "}
            <span className="field-hint">{at(result.vonMises.max.position, lengthUnit)}</span>
          </dd>
          <dt>Smallest von Mises stress</dt>
          <dd>{figure(result.vonMises.min.value, STRESS_UNIT, "pressure")}</dd>
          {result.reactions.map((reaction) => (
            <Fragment key={reaction.supportId}>
              <dt>Reaction, {supportNames.get(reaction.supportId) ?? reaction.supportId}</dt>
              <dd>
                ({reaction.force.map((f) => Number(fromSi(f, FORCE_UNIT, "force").toPrecision(4))).join(", ")}){" "}
                {FORCE_UNIT}
              </dd>
            </Fragment>
          ))}
          <dt>Nodes</dt>
          <dd>{result.nodes.toLocaleString("en-US")}</dd>
          <dt>Solver</dt>
          <dd>CalculiX {result.software.calculix}</dd>
        </dl>
      )}
      {run !== null && (
        <details className="run-log" open={solving}>
          <summary>Solver log</summary>
          <pre>{log === "" ? "No output yet." : log}</pre>
        </details>
      )}
    </section>
  );
}
