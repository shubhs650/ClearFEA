// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings panel for the run (M1.8): a button that solves the saved setup on the current mesh,
// the latest run's stage and solver log while it solves, and its result figures when done.
// From M1.9 it also chooses what the viewer draws of a succeeded run: the quantity and shape.
// From M1.10 it shows the run record: when it ran, the mesh and versions it was solved with,
// whether the setup has changed since, and links to view or download the deck and log. From
// M1.11 the record also shows the machine size, its rate and what the run cost (ADR-033).
// Numbers only: no verdict is ever drawn from them (CLAUDE.md).

import type { RunFileName, RunView, SimulationSpec } from "@clearfea/spec";
import { Fragment } from "react";
import { runFileUrl } from "../api/runs";
import { credits } from "../billing/credits";
import type { Deformation } from "../layout/Viewer";
import { fromSi } from "../units/convert";
import { QUANTITIES, type Quantity } from "../viewer/resultFields";
import { Notes } from "./ItemPanels";
import { type ItemStatus, sameSpec } from "./spec";

/** Units the result figures are shown in until M2.1 brings display-unit choice. */
export const STRESS_UNIT = "MPa";
export const FORCE_UNIT = "N";

/** What the viewer draws of the run's results. */
export type ResultChoice = { quantity: Quantity; deformation: Deformation };

const DEFORMATIONS: Record<Deformation, string> = {
  auto: "Deformed, exaggerated to be seen",
  true: "Deformed, true scale",
  undeformed: "Undeformed",
};

function figure(value: number, unit: string, kind: string): string {
  return `${Number(fromSi(value, unit, kind).toPrecision(4))} ${unit}`;
}

function at(position: number[], unit: string): string {
  return `at (${position.map((p) => Number(fromSi(p, unit, "length").toPrecision(4))).join(", ")}) ${unit}`;
}

/** An API timestamp as a fixed, unambiguous UTC time. */
function utc(timestamp: string): string {
  return `${timestamp.slice(0, 19).replace("T", " ")} UTC`;
}

function version(value: string | number | null): string {
  return value === null ? "not recorded" : String(value);
}

const ORDERS = { 1: "linear tetrahedra (4 nodes)", 2: "quadratic tetrahedra (10 nodes)" } as const;

/** What the run cost, or why there is no cost to show. */
function costText(run: RunView): string {
  if (run.machine === null) return "Not metered: the run was made before metering.";
  if (run.cost === null) return "Counted when the run has finished.";
  const time = `${run.cost.billedSeconds.toLocaleString("en-US")} s`;
  if (!run.cost.charged) return `Not charged: the run stopped because of a fault in ClearFEA (${time}).`;
  return `${credits(run.cost.amount)} for ${time}`;
}

const FILE_LABELS: Partial<Record<RunFileName, string>> = { "deck.inp": "Solver input", "solver.log": "Solver log" };

/** The record frozen with a run: when, on what mesh, by which versions, and its deck and log. */
function RunRecord({ run, currentSpec }: { run: RunView; currentSpec: SimulationSpec }) {
  const { mesh, software } = run;
  const finished = run.status !== "solving";
  const count = (n: number | null) => (n === null ? "?" : n.toLocaleString("en-US"));
  return (
    <section aria-label="Run record">
      <h3 className="pane-subtitle">Run record</h3>
      {!sameSpec(run.spec, currentSpec) && (
        <p className="field-hint">
          The setup has changed since this run. Its record and results are for the setup as it was when it started; run
          again for the current setup.
        </p>
      )}
      <dl className="geometry-facts">
        <dt>Started</dt>
        <dd>{utc(run.createdAt)}</dd>
        {run.finishedAt !== null && (
          <>
            <dt>Finished</dt>
            <dd>{utc(run.finishedAt)}</dd>
          </>
        )}
        <dt>Mesh</dt>
        <dd>
          {mesh.size.value} {mesh.size.unit}, {ORDERS[mesh.order]}; {count(mesh.elementCount)} elements,{" "}
          {count(mesh.nodeCount)} nodes
        </dd>
        <dt>ClearFEA</dt>
        <dd>{version(software.clearfea)}</dd>
        <dt>CalculiX</dt>
        <dd>{version(software.calculix)}</dd>
        <dt>Gmsh</dt>
        <dd>
          {version(software.gmsh)}
          {software.occt !== null && <span className="field-hint"> with OpenCASCADE {software.occt}</span>}
        </dd>
        <dt>Deck format</dt>
        <dd>{version(software.deckFormat)}</dd>
        {run.machine !== null && (
          <>
            <dt>Machine</dt>
            <dd>
              {run.machine.size}, {credits(run.machine.ratePerHour)} per hour
            </dd>
          </>
        )}
        <dt>Cost</dt>
        <dd>{costText(run)}</dd>
        {(["deck.inp", "solver.log"] as const).map((name) => (
          <Fragment key={name}>
            <dt>{FILE_LABELS[name]}</dt>
            <dd>
              {run.files.includes(name) ? (
                <>
                  <a href={runFileUrl(run.id, name)} target="_blank" rel="noopener noreferrer">
                    View {name}
                  </a>{" "}
                  ·{" "}
                  <a href={runFileUrl(run.id, name, true)} download>
                    Download
                  </a>
                </>
              ) : finished ? (
                <span className="field-hint">None: the run stopped before the solver started.</span>
              ) : (
                <span className="field-hint">Stored when the run has finished.</span>
              )}
            </dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}

export function RunPanel({
  status,
  run,
  currentSpec,
  log,
  blocked,
  lengthUnit,
  supportNames,
  requesting,
  requestProblem,
  onRun,
  choice,
  onChoiceChange,
}: {
  status: ItemStatus | undefined;
  run: RunView | null;
  /** The simulation's setup as saved now, to tell whether the run's frozen setup differs. */
  currentSpec: SimulationSpec;
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
  choice: ResultChoice;
  onChoiceChange: (next: ResultChoice) => void;
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
        <fieldset className="result-choice">
          <legend>Show on the model</legend>
          <label>
            Quantity
            <select
              value={choice.quantity}
              onChange={(event) => onChoiceChange({ ...choice, quantity: event.target.value as Quantity })}
            >
              {(Object.keys(QUANTITIES) as Quantity[]).map((q) => (
                <option key={q} value={q}>
                  {QUANTITIES[q].label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Shape
            <select
              value={choice.deformation}
              onChange={(event) => onChoiceChange({ ...choice, deformation: event.target.value as Deformation })}
            >
              {(Object.keys(DEFORMATIONS) as Deformation[]).map((d) => (
                <option key={d} value={d}>
                  {DEFORMATIONS[d]}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
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
        </dl>
      )}
      {run !== null && <RunRecord run={run} currentSpec={currentSpec} />}
      {run !== null && (
        <details className="run-log" open={solving}>
          <summary>Solver log</summary>
          <pre>{log === "" ? "No output yet." : log}</pre>
        </details>
      )}
    </section>
  );
}
