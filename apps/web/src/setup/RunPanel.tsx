// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings panel for the run (M1.8): a button that solves the saved setup on the current mesh,
// the latest run's stage and solver log while it solves, and its result figures when done.
// From M1.9 it also chooses what the viewer draws of a succeeded run: the quantity and shape.
// From M1.10 it shows the run record: when it ran, the mesh and versions it was solved with,
// whether the setup has changed since, and links to view or download the deck and log. From
// M1.11 the record also shows the machine size, its rate and what the run cost (ADR-033).
// From M1.12 the button sits above the plain-language list of what stops the setup from being
// run (ADR-034); each line opens the tree item it is about. From M2.1 figures are shown in the
// project's unit system (ADR-038). From M2.12 the panel shows the estimate for the current mesh
// before a run, with a machine size to run on (the recommended one first), and the record shows
// the estimate the run started with (ADR-049). From M3.2 the result figures give each support's
// reaction force and moment, each load's total and the balance of loads against reactions
// (ADR-051), named as in the run's own frozen setup. From M3.7 the result can be shown in units
// of its own, picked per kind, instead of the unit system's (ADR-056). From M3.8 a succeeded run
// can be exported as CSV and VTK files (ADR-057). From M4.5 a run whose setup ties bonds shows
// the report's note on stresses near bonded faces under its results (ADR-062). From M5.1 a
// steady-state thermal run shows its highest and lowest temperature instead of displacement,
// stress and reactions, and offers only the temperature to show on the undeformed model.
// Since ADR-063 the panel chooses the equation solver (PaStiX by default), shows each solver's
// element limit on a 16 GB machine, warns that the iterative solvers are less exact, and the
// record says which solver a run used. From M6.1 a modal run lists its natural frequencies, and
// from M6.2 (ADR-071) they form a table whose rows pick the mode shape drawn, exaggerated or
// undeformed, and swinging when asked. From M6.3 a modal setup's solver list and estimate use
// the modal fit: limits for the most modes, the solvers that may solve it, the modes asked for.
// From M8.7 (ADR-083) the owner can make a read-only link to a succeeded run, and revoke it; the
// shared run's page shows the same results through RunResults.
// Numbers only: no verdict is ever drawn from them (CLAUDE.md).

import {
  type ElementOrder,
  frozenRunSolver,
  ITERATIVE_ACCURACY_NOTE,
  isIterative,
  limitMemoryText,
  MAX_MODES,
  maxElements,
  type RunEstimate,
  type RunKind,
  type RunFileName,
  type RunView,
  SOLVER_LABELS,
  SOLVERS,
  runReportNotes,
  runSolverProblem,
  specRunKind,
  type SimulationSpec,
  type Solver,
  type SolveResult,
  systemUnit,
} from "@clearfea/spec";
import { Fragment, useEffect, useState } from "react";
import { runFileUrl } from "../api/runs";
import { credits } from "../billing/credits";
import { duration, memory } from "../billing/estimate";
import type { Deformation } from "../layout/Viewer";
import { fromSi } from "../units/convert";
import { useUnitSystem } from "../units/system";
import {
  type DisplayKind,
  type DisplayUnitChoice,
  type ResultUnits,
  STATIC_KINDS,
  THERMAL_KINDS,
  MODAL_KINDS,
  THERMAL_STRESS_KINDS,
  unitsOf,
} from "./displayUnits";
import {
  isModalRun,
  isThermalRun,
  isThermalStressRun,
  QUANTITIES,
  type Quantity,
  type QuantityGroup,
  runQuantities,
  SAFETY_FACTOR_CAP,
} from "../viewer/resultFields";
import { Notes } from "./ItemPanels";
import { RunExport } from "./RunExport";
import { ShareLink } from "./ShareLink";
import { type ItemStatus, sameSpec } from "./spec";
import type { EstimateState } from "./useEstimate";

/** What each display kind is called in the Run panel's unit choice. */
const KIND_LABELS: Record<DisplayKind, string> = {
  length: "Length",
  pressure: "Stress",
  force: "Force",
  moment: "Moment",
  strain: "Strain",
  temperature: "Temperature",
  heatFlux: "Heat flux",
  heatFlow: "Heat flow",
  frequency: "Frequency",
};

/**
 * The result view's display units (M3.7, ADR-056): one list per kind, first "as the unit system"
 * (naming its unit), then every unit units.json has for the kind. A change redraws the figures,
 * legend, markers and probes from the stored SI values, without running again.
 */
function DisplayUnits({
  kinds,
  choice,
  onChange,
  onReset,
}: {
  /** The kinds the run shows, in order. */
  kinds: readonly DisplayKind[];
  choice: DisplayUnitChoice;
  onChange: (kind: DisplayKind, unit: string | null) => void;
  onReset: () => void;
}) {
  const system = useUnitSystem();
  const picked = kinds.some((kind) => choice[kind] !== undefined);
  return (
    <fieldset className="result-choice result-units">
      <legend>Units shown</legend>
      {kinds.map((kind) => {
        return (
          <label key={kind}>
            {KIND_LABELS[kind]}
            <select value={choice[kind] ?? ""} onChange={(event) => onChange(kind, event.target.value || null)}>
              <option value="">As the unit system ({systemUnit(system, kind)})</option>
              {unitsOf(kind).map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </label>
        );
      })}
      <p className="field-hint">Changes only how results are shown; nothing is run again.</p>
      {picked && (
        <button type="button" className="link-button" onClick={onReset}>
          Show all in the unit system
        </button>
      )}
    </fieldset>
  );
}

/** The headings of the quantity list, in order. */
const QUANTITY_GROUPS: readonly QuantityGroup[] = [
  "Displacement",
  "Stress",
  "Strain",
  "Safety factor",
  "Temperature",
  "Heat flux",
  "Mode shape",
];

/** One reason the setup cannot be run now, and the tree item that fixes it (null for none). */
export interface RunBlocker {
  message: string;
  item: string | null;
}

/** The list beside the Run button of what still stops the setup from being run. */
function Blockers({ blockers, onOpen }: { blockers: readonly RunBlocker[]; onOpen: (item: string) => void }) {
  return (
    <section className="run-blockers" aria-label="Before running">
      <p className="field-hint">Before the simulation can run:</p>
      <ul className="setup-notes setup-notes-incomplete">
        {blockers.map((blocker) => (
          <li key={blocker.message}>
            {blocker.item === null ? (
              blocker.message
            ) : (
              <button type="button" className="link-button" onClick={() => onOpen(blocker.item ?? "")}>
                {blocker.message}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What each solver is, in a few words, after its name in the list. */
const SOLVER_KINDS: Record<Solver, string> = {
  pastix: "direct, fastest",
  spooles: "direct",
  iterative_cholesky: "iterative, least memory, less exact",
  iterative_scaling: "iterative, least memory, less exact",
};

/**
 * The equation solver (ADR-063): PaStiX by default, SPOOLES, or one of the iterative solvers,
 * each with the most elements it may solve on a 16 GB machine for the mesh's element order.
 */
function SolverChoice({
  solver,
  order,
  kind,
  onChange,
}: {
  solver: Solver;
  order: ElementOrder;
  kind: RunKind;
  onChange: (solver: Solver) => void;
}) {
  const count = (n: number) => n.toLocaleString("en-US");
  const words = order === 1 ? "4-node" : "10-node";
  const modal = kind.analysis === "modal";
  /** A solver's limit for this run, or why it has none (M6.3). */
  const limit = (s: Solver) =>
    runSolverProblem(s, kind) === null ? `up to ${count(maxElements(s, order, kind))} elements` : "not for modal analysis";
  return (
    <section aria-label="Solver">
      <label className="field">
        Equation solver
        <select value={solver} onChange={(event) => onChange(event.target.value as Solver)}>
          {SOLVERS.map((s) => (
            <option key={s} value={s}>
              {SOLVER_LABELS[s]} ({SOLVER_KINDS[s]}), {limit(s)}
            </option>
          ))}
        </select>
      </label>
      <p className="field-hint">
        Element limits are for {words} elements on a {limitMemoryText()} machine
        {modal && ` in a modal analysis of up to ${MAX_MODES} modes`}, from the solver benchmark of a stocky block; a
        larger mesh is refused so the run cannot run out of memory.
      </p>
      {isIterative(solver) && (
        <p className="field-hint" role="note">
          {ITERATIVE_ACCURACY_NOTE}
        </p>
      )}
    </section>
  );
}

/** The solver a run used: its frozen spec's, or SPOOLES for runs made before ADR-063. */
function runSolver(run: Pick<RunView, "spec">): Solver {
  return frozenRunSolver(run.spec);
}

/** One machine size as an option: its cores and memory, and whether it is the recommended one. */
function sizeLabel(size: RunEstimate["sizes"][number], recommended: string | null): string {
  const label = `${size.size} (${size.cores} cores, ${memory(size.memoryBytes)})`;
  if (size.size === recommended) return `${label}, recommended`;
  return size.fits ? label : `${label}, too little memory`;
}

/**
 * The estimate for the current mesh (ADR-049) and the machine size to run on. Shown before a
 * run; the chosen size goes with the Run button.
 */
function Estimate({
  state,
  size,
  onSizeChange,
}: {
  state: EstimateState;
  size: string | null;
  onSizeChange: (size: string) => void;
}) {
  if (state.kind === "none") return null;
  if (state.kind === "loading") return <p className="field-hint">Estimating memory, time and cost…</p>;
  if (state.kind === "failed") {
    return <p className="field-hint">No estimate: {state.problem}</p>;
  }
  const { estimate } = state;
  const chosen = estimate.sizes.find((s) => s.size === size);
  return (
    <section aria-label="Estimate">
      <h3 className="pane-subtitle">Estimate</h3>
      <dl className="geometry-facts">
        <dt>Solver memory</dt>
        <dd>about {memory(estimate.memoryBytes)} at its peak</dd>
        <dt>Time</dt>
        <dd>about {duration(estimate.seconds)}</dd>
        {chosen !== undefined && (
          <>
            <dt>Cost</dt>
            <dd>
              about {credits(chosen.cost)} on {chosen.size}
            </dd>
          </>
        )}
      </dl>
      <label className="field">
        Machine size
        <select value={size ?? ""} onChange={(event) => onSizeChange(event.target.value)}>
          {estimate.sizes.map((s) => (
            <option key={s.size} value={s.size}>
              {sizeLabel(s, estimate.recommended)}
            </option>
          ))}
        </select>
      </label>
      <p className="field-hint">
        Estimated for this mesh's {estimate.nodes.toLocaleString("en-US")} nodes
        {estimate.analysis === "modal" && estimate.modes !== undefined && ` and ${estimate.modes} modes`} from the
        solver benchmark of a stocky block; slender parts usually need less memory.
        {estimate.extrapolated && " The mesh is larger than any the estimate was measured on, so it is less certain."}
      </p>
      {estimate.recommended === null && (
        <p className="field-hint">
          By the estimate no machine size has enough memory for this mesh. A coarser mesh, or linear elements, needs
          less.
        </p>
      )}
      {estimate.recommended !== null && chosen !== undefined && !chosen.fits && (
        <p className="field-hint">
          The estimate needs more memory than this size has, so the run may stop for lack of memory, and the time it used
          is then charged. The recommended size is {estimate.recommended}.
        </p>
      )}
    </section>
  );
}

/** The estimate a run started with, on the size it ran on. */
function estimateText(run: RunView): string | null {
  const { estimate } = run;
  if (estimate === null) return null;
  const size = estimate.sizes.find((s) => s.size === run.machine?.size);
  const cost = size === undefined ? "" : `, ${credits(size.cost)}`;
  return `about ${duration(estimate.seconds)} and ${memory(estimate.memoryBytes)} of solver memory${cost}`;
}

/** What the viewer draws of the run's results: for a modal run (M6.2) the mode whose shape is
 * drawn, from 1, and whether it swings. */
export type ResultChoice = { quantity: Quantity; deformation: Deformation; mode: number; animate: boolean };

/** A modal run's mode shape has no true scale (M6.2). */
const MODE_DEFORMATIONS: readonly Deformation[] = ["auto", "undeformed"];

const DEFORMATIONS: Record<Deformation, string> = {
  auto: "Deformed, exaggerated to be seen",
  true: "Deformed, true scale",
  undeformed: "Undeformed",
};

function figure(value: number, unit: string, kind: string): string {
  return `${Number(fromSi(value, unit, kind).toPrecision(4))} ${unit}`;
}

/** A safety factor to three figures; the worker keeps none above SAFETY_FACTOR_CAP (ADR-054). */
function safetyFactorText(value: number): string {
  return value >= SAFETY_FACTOR_CAP ? `${SAFETY_FACTOR_CAP} or more` : `${Number(value.toPrecision(3))}`;
}

function at(position: number[], unit: string): string {
  return `at (${position.map((p) => Number(fromSi(p, unit, "length").toPrecision(4))).join(", ")}) ${unit}`;
}

/** A vector's components to four figures, in brackets, with the unit. */
function components(values: readonly number[], unit: string, kind: string): string {
  return `(${values.map((v) => Number(fromSi(v, unit, kind).toPrecision(4))).join(", ")}) ${unit}`;
}

/** A fraction as a percentage to two figures. */
function percent(ratio: number): string {
  return `${Number((100 * ratio).toPrecision(2))} %`;
}

/** Reactions per support, totals per load and their balance (ADR-051). Numbers only. */
function Reactions({ result, spec, units }: { result: SolveResult; spec: SimulationSpec; units: ResultUnits }) {
  const supportName = new Map(spec.supports.map((s) => [s.id, s.name]));
  const loadName = new Map(spec.loads.map((l) => [l.id, l.name]));
  const balance = result.balance;
  return (
    <>
      {(result.reactions ?? []).map((reaction) => (
        <Fragment key={reaction.supportId}>
          <dt>Reaction, {supportName.get(reaction.supportId) ?? reaction.supportId}</dt>
          <dd>
            {components(reaction.force, units.force, "force")}
            {reaction.moment && reaction.point && (
              <>
                <br />
                <span className="field-hint">
                  moment {components(reaction.moment, units.moment, "moment")} about the faces' centre{" "}
                  {at(reaction.point, units.length)}
                </span>
              </>
            )}
          </dd>
        </Fragment>
      ))}
      {result.loads?.map((load) => (
        <Fragment key={load.loadId}>
          <dt>Applied, {loadName.get(load.loadId) ?? load.loadId}</dt>
          <dd>{components(load.force, units.force, "force")}</dd>
        </Fragment>
      ))}
      {balance === undefined ? (
        <>
          <dt>Balance</dt>
          <dd className="field-hint">Run again to see reaction moments and the balance of loads and reactions.</dd>
        </>
      ) : (
        <>
          <dt>Balance, about the origin</dt>
          <dd>
            applied {components(balance.appliedForce, units.force, "force")}, reactions{" "}
            {components(balance.reactionForce, units.force, "force")}
            <br />
            <span className="field-hint">
              applied moment {components(balance.appliedMoment, units.moment, "moment")}, reactions{" "}
              {components(balance.reactionMoment, units.moment, "moment")}
            </span>
          </dd>
          <dt>Out of balance</dt>
          <dd>
            force {percent(balance.forceRatio)} of {Number(fromSi(balance.forceScale, units.force, "force").toPrecision(4))}{" "}
            {units.force}, moment {percent(balance.momentRatio)} of{" "}
            {Number(fromSi(balance.momentScale, units.moment, "moment").toPrecision(4))} {units.moment}
          </dd>
        </>
      )}
    </>
  );
}

/** A heat flow into the body, or out of it, as a positive figure with its direction. */
function heatFlowText(heat: number, unit: string): string {
  const size = figure(Math.abs(heat), unit, "heatFlow");
  return heat > 0 ? `${size} in` : heat < 0 ? `${size} out` : size;
}

/** The figures of a steady-state thermal run (M5.1): its highest and lowest temperature, where
 * they are, and since M5.3 its largest heat flux, the heat each thermal load brings in or takes
 * out, and the heat balance. Absolute temperatures, converted with their offset. Numbers only. */
/**
 * A modal run's natural frequencies, mode 1 first (M6.1, ADR-070), as a table whose rows pick
 * the mode shape the viewer draws (M6.2, ADR-071), with the shape and whether it swings. A
 * mode near zero is a rigid-body mode of a body no support holds; rounding can put it a little
 * below zero.
 */
function ModalFigures({
  result,
  units,
  choice,
  onChoiceChange,
}: {
  result: SolveResult;
  units: ResultUnits;
  choice: ResultChoice;
  onChoiceChange: (next: ResultChoice) => void;
}) {
  const frequencies = result.frequencies ?? [];
  const largest = Math.max(0, ...frequencies.map((f) => Math.abs(f)));
  const rigid = frequencies.some((f) => Math.abs(f) <= RIGID_BODY_FRACTION * largest);
  return (
    <>
      {frequencies.length === 0 ? (
        <dl className="geometry-facts" aria-label="Natural frequencies">
          <dt>Natural frequencies</dt>
          <dd className="field-hint">The run reported no frequencies. Run it again.</dd>
        </dl>
      ) : (
        <>
          <table className="frequency-table" aria-label="Natural frequencies">
            <thead>
              <tr>
                <th scope="col">Mode</th>
                <th scope="col">Frequency ({units.frequency})</th>
                <th scope="col">Shown</th>
              </tr>
            </thead>
            <tbody>
              {frequencies.map((f, k) => {
                const mode = k + 1;
                const shown = choice.mode === mode;
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the mode number is the position
                  <tr key={k} className={shown ? "frequency-shown" : undefined} onClick={() => onChoiceChange({ ...choice, mode })}>
                    <th scope="row">{mode}</th>
                    <td>{Number(fromSi(f, units.frequency, "frequency").toPrecision(4))}</td>
                    <td>
                      <input
                        type="radio"
                        name="mode-shown"
                        aria-label={`Show mode ${mode}`}
                        checked={shown}
                        onChange={() => onChoiceChange({ ...choice, mode })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <fieldset className="result-choice">
            <legend>Mode shape on the model</legend>
            <label>
              Shape
              <select
                value={choice.deformation}
                onChange={(event) => onChoiceChange({ ...choice, deformation: event.target.value as Deformation })}
              >
                {MODE_DEFORMATIONS.map((d) => (
                  <option key={d} value={d}>
                    {DEFORMATIONS[d]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={choice.animate && choice.deformation !== "undeformed"}
                disabled={choice.deformation === "undeformed"}
                onChange={(event) => onChoiceChange({ ...choice, animate: event.target.checked })}
              />
              Animate
            </label>
            <p className="field-hint">
              A mode shape shows how the model moves in that mode, not how far: the colours give each point's displacement
              relative to the largest, which is 1.
            </p>
          </fieldset>
        </>
      )}
      {rigid && (
        <p className="field-hint" role="note">
          Frequencies at or near zero are rigid-body modes: a body no support holds moves in them without deforming.
        </p>
      )}
    </>
  );
}

/** A mode below this fraction of the largest frequency reads as a rigid-body mode (M6.1). */
const RIGID_BODY_FRACTION = 1e-4;

function ThermalFigures({
  result,
  spec,
  units,
  label = "Run results",
}: {
  result: SolveResult;
  spec: SimulationSpec;
  units: ResultUnits;
  /** "Thermal results" beside a thermal stress run's structural ones (M5.4). */
  label?: string;
}) {
  const { temperature, heatFlux, heatFlows, heatBalance } = result;
  const loadName = new Map(spec.loads.map((l) => [l.id, l.name]));
  return (
    <dl className="geometry-facts" aria-label={label}>
      {temperature === undefined ? (
        <>
          <dt>Temperature</dt>
          <dd className="field-hint">The run reported no temperatures. Run it again.</dd>
        </>
      ) : (
        <>
          <dt>Highest temperature</dt>
          <dd>
            {figure(temperature.max.value, units.temperature, "temperature")}{" "}
            <span className="field-hint">{at(temperature.max.position, units.length)}</span>
          </dd>
          <dt>Lowest temperature</dt>
          <dd>
            {figure(temperature.min.value, units.temperature, "temperature")}{" "}
            <span className="field-hint">{at(temperature.min.position, units.length)}</span>
          </dd>
        </>
      )}
      {heatFlux === undefined || heatFlows === undefined || heatBalance === undefined ? (
        <>
          <dt>Heat flows</dt>
          <dd className="field-hint">Run again to see the heat flux, each load's heat flow and the heat balance.</dd>
        </>
      ) : (
        <>
          <dt>Largest heat flux</dt>
          <dd>
            {figure(heatFlux.max.value, units.heatFlux, "heatFlux")}{" "}
            <span className="field-hint">{at(heatFlux.max.position, units.length)}</span>
          </dd>
          {heatFlows.map((flow) => (
            <Fragment key={flow.loadId}>
              <dt>Heat flow, {loadName.get(flow.loadId) ?? flow.loadId}</dt>
              <dd>{heatFlowText(flow.heat, units.heatFlow)}</dd>
            </Fragment>
          ))}
          <dt>Heat balance</dt>
          <dd>
            in {figure(heatBalance.heatIn, units.heatFlow, "heatFlow")}, out{" "}
            {figure(heatBalance.heatOut, units.heatFlow, "heatFlow")}
          </dd>
          <dt>Out of balance</dt>
          <dd>
            {percent(heatBalance.ratio)} of {figure(heatBalance.scale, units.heatFlow, "heatFlow")}
          </dd>
        </>
      )}
    </dl>
  );
}

/** An API timestamp as a fixed, unambiguous UTC time. */
export function utc(timestamp: string): string {
  return `${timestamp.slice(0, 19).replace("T", " ")} UTC`;
}

function version(value: string | number | null): string {
  return value === null ? "not recorded" : String(value);
}

export const ORDERS = { 1: "linear tetrahedra (4 nodes)", 2: "quadratic tetrahedra (10 nodes)" } as const;

/** What the run cost, or why there is no cost to show. */
function costText(run: RunView): string {
  if (run.machine === null) return "Not metered: the run was made before metering.";
  if (run.cost === null) return "Counted when the run has finished.";
  const time = `${run.cost.billedSeconds.toLocaleString("en-US")} s`;
  if (!run.cost.charged && run.status === "cancelled") return "Nothing: the run was cancelled before the solver started.";
  if (!run.cost.charged) return `Not charged: the run stopped because of a fault in ClearFEA (${time}).`;
  return `${credits(run.cost.amount)} for ${time}`;
}

/** Time on a running clock: m:ss, or h:mm:ss from an hour. */
export function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const [h, m, s] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** Milliseconds since the component last saw `key` change, refreshed every second. */
function useTicking(key: unknown): number {
  const [since, setSince] = useState({ key, at: Date.now() });
  const [now, setNow] = useState(Date.now());
  if (since.key !== key) setSince({ key, at: Date.now() });
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return since.key === key ? Math.max(0, now - since.at) : 0;
}

/**
 * A solving run as it goes (M8.2): its stage, how long the solver has had it against the
 * estimate, what that time costs so far against the estimated cost, and a cancel button. The
 * clock runs on between the API's answers; the cost is the API's, refreshed with each one.
 */
function RunningJob({
  run,
  requesting,
  onCancel,
}: {
  run: RunView;
  requesting: boolean;
  onCancel: () => void;
}) {
  const progress = run.progress;
  const ticked = useTicking(progress);
  const waiting = progress === null || progress.elapsedMs === null;
  const cancelling = progress?.cancelling === true;
  const estimate = run.estimate;
  const size = estimate?.sizes.find((s) => s.size === run.machine?.size);
  const stage = cancelling
    ? "Cancelling: the solver stops at its next check-in, within a few seconds…"
    : run.stage === "queued" || run.stage === null
      ? "Waiting for the solver…"
      : `Solver: ${run.stage}…`;
  return (
    <section aria-label="Running job">
      <p role="status" aria-label="Run stage">
        {stage}
      </p>
      {!waiting && (
        <dl className="geometry-facts">
          <dt>Elapsed</dt>
          <dd aria-label="Elapsed">
            {clock((progress.elapsedMs ?? 0) + ticked)}
            {estimate !== null && <span className="field-hint"> of about {duration(estimate.seconds)} estimated</span>}
          </dd>
          {progress.costSoFar !== null && (
            <>
              <dt>Cost so far</dt>
              <dd aria-label="Cost so far">
                {credits(progress.costSoFar)}
                {size !== undefined && <span className="field-hint"> of about {credits(size.cost)} estimated</span>}
              </dd>
            </>
          )}
        </dl>
      )}
      <button type="button" onClick={onCancel} disabled={requesting || cancelling}>
        Cancel the run
      </button>
      <p className="field-hint">
        {waiting
          ? "Cancelled before the solver starts, the run costs nothing."
          : "Cancelled, the run is charged for the time it has used."}{" "}
        It carries on if you close the browser.
      </p>
    </section>
  );
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
        <dt>Solver</dt>
        <dd>
          {SOLVER_LABELS[runSolver(run)]}
          {isIterative(runSolver(run)) && <span className="field-hint"> ({ITERATIVE_ACCURACY_NOTE})</span>}
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
        {estimateText(run) !== null && (
          <>
            <dt>Estimate</dt>
            <dd>{estimateText(run)}</dd>
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

const ignoreSignedOut = () => {};

/**
 * A succeeded run's results: what to show on the model, the display units and the figures, with
 * the notes the report prints. The Run panel and a shared run's page (M8.7) both show them.
 */
export function RunResults({
  run,
  result,
  units,
  unitChoice,
  onUnitChange,
  onUnitReset,
  choice,
  onChoiceChange,
}: {
  run: Pick<RunView, "spec" | "result">;
  result: SolveResult;
  units: ResultUnits;
  unitChoice: DisplayUnitChoice;
  onUnitChange: (kind: DisplayKind, unit: string | null) => void;
  onUnitReset: () => void;
  choice: ResultChoice;
  onChoiceChange: (next: ResultChoice) => void;
}) {
  const thermal = isThermalRun(run);
  const thermalStress = isThermalStressRun(run);
  const modal = isModalRun(run);
  const quantities = runQuantities(run);
  return (
    <>
      {!modal && (
        <fieldset className="result-choice">
          <legend>Show on the model</legend>
          <label>
            Quantity
            <select
              value={choice.quantity}
              onChange={(event) => onChoiceChange({ ...choice, quantity: event.target.value as Quantity })}
            >
              {QUANTITY_GROUPS.filter((group) => quantities.some((q) => QUANTITIES[q].group === group)).map((group) => (
                <optgroup key={group} label={group}>
                  {quantities
                    .filter((q) => QUANTITIES[q].group === group)
                    .map((q) => (
                      <option key={q} value={q}>
                        {QUANTITIES[q].label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          {/* A thermal run has no displacement, so it is drawn undeformed. */}
          {!thermal && (
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
          )}
        </fieldset>
      )}
      <DisplayUnits
        kinds={modal ? MODAL_KINDS : thermal ? THERMAL_KINDS : thermalStress ? THERMAL_STRESS_KINDS : STATIC_KINDS}
        choice={unitChoice}
        onChange={onUnitChange}
        onReset={onUnitReset}
      />
      {isIterative(runSolver(run)) && (
        <p className="field-hint" role="note">
          Solved with {SOLVER_LABELS[runSolver(run)]}. {ITERATIVE_ACCURACY_NOTE}
        </p>
      )}
      {thermal && <ThermalFigures result={result} spec={run.spec} units={units} />}
      {modal && <ModalFigures result={result} units={units} choice={choice} onChoiceChange={onChoiceChange} />}
      {!thermal && !modal && (
        <dl className="geometry-facts" aria-label="Run results">
          {result.displacement && (
            <>
              <dt>Largest displacement</dt>
              <dd>
                {figure(result.displacement.max.value, units.length, "length")}{" "}
                <span className="field-hint">{at(result.displacement.max.position, units.length)}</span>
              </dd>
            </>
          )}
          {result.vonMises && (
            <>
              <dt>Largest von Mises stress</dt>
              <dd>
                {figure(result.vonMises.max.value, units.pressure, "pressure")}{" "}
                <span className="field-hint">{at(result.vonMises.max.position, units.length)}</span>
              </dd>
              <dt>Smallest von Mises stress</dt>
              <dd>{figure(result.vonMises.min.value, units.pressure, "pressure")}</dd>
            </>
          )}
          <dt>Smallest safety factor against yield</dt>
          <dd>
            {result.safetyFactor ? (
              <>
                {safetyFactorText(result.safetyFactor.min.value)}{" "}
                <span className="field-hint">{at(result.safetyFactor.min.position, units.length)}</span>
              </>
            ) : (
              "None: it needs a yield strength for every material. Enter them under Materials and run again."
            )}
          </dd>
          <Reactions result={result} spec={run.spec} units={units} />
        </dl>
      )}
      {thermalStress && (
        <ThermalFigures result={result} spec={run.spec} units={units} label="Thermal results" />
      )}
      {runReportNotes(run.spec).map((note) => (
          <p key={note.id} className="field-hint" role="note" aria-label={note.title}>
            <strong>{note.title}.</strong> {note.text}
          </p>
        ))}
    </>
  );
}

export function RunPanel({
  status,
  run,
  currentSpec,
  log,
  blockers,
  onOpen,
  units,
  unitChoice,
  onUnitChange,
  onUnitReset,
  estimate,
  solver,
  meshOrder,
  onSolverChange,
  requesting,
  requestProblem,
  onRun,
  onCancel,
  choice,
  onChoiceChange,
  onSignedOut = ignoreSignedOut,
}: {
  status: ItemStatus | undefined;
  run: RunView | null;
  /** The simulation's setup as saved now, to tell whether the run's frozen setup differs. */
  currentSpec: SimulationSpec;
  log: string;
  /** What stops the simulation from being run now; empty when it can be run. */
  blockers: readonly RunBlocker[];
  /** Opens a tree item, from a line of the blocker list. */
  onOpen: (item: string) => void;
  /** The units figures are shown in. */
  units: ResultUnits;
  /** The units picked for the result view; a kind left out follows the unit system. */
  unitChoice: DisplayUnitChoice;
  onUnitChange: (kind: DisplayKind, unit: string | null) => void;
  onUnitReset: () => void;
  /** The estimate for the current mesh, shown before a run. */
  estimate: EstimateState;
  /** The equation solver the setup asks for (ADR-063). */
  solver: Solver;
  /** The element order the limits are shown for: the mesh's, or the mesh settings'. */
  meshOrder: ElementOrder;
  onSolverChange: (solver: Solver) => void;
  requesting: boolean;
  requestProblem?: string;
  /** Starts a run on the machine size chosen. */
  onRun: (machineSize: string | undefined) => void;
  /** Cancels the solving run (M8.2). */
  onCancel: () => void;
  choice: ResultChoice;
  onChoiceChange: (next: ResultChoice) => void;
  /** Called when the API says the user is signed out, from the share link's calls. */
  onSignedOut?: (problem: string) => void;
}) {
  const solving = run?.status === "solving";
  const result = run?.status === "succeeded" ? run.result : null;
  // A steady-state thermal run (M5.1) has temperatures only; a thermal stress run (M5.4) has
  // the structural results and the temperatures and heat flows of its thermal step.
  const thermal = run !== null && isThermalRun(run);
  const thermalStress = run !== null && isThermalStressRun(run);
  // A modal run (M6.1) has its natural frequencies and, since M6.2, its mode shapes.
  const modal = run !== null && isModalRun(run);
  // The size to run on: the recommended one (the largest when none fits) until the user picks
  // another for this estimate.
  const [picked, setPicked] = useState<{ estimate: RunEstimate; size: string } | null>(null);
  const loaded = estimate.kind === "loaded" ? estimate.estimate : null;
  const size =
    loaded === null
      ? null
      : picked?.estimate === loaded
        ? picked.size
        : (loaded.recommended ?? [...loaded.sizes].sort((a, b) => b.memoryBytes - a.memoryBytes)[0]?.size ?? null);
  const setSize = (chosen: string) => {
    if (loaded !== null) setPicked({ estimate: loaded, size: chosen });
  };
  return (
    <section className="setup-panel" aria-label="Run">
      <h2 className="pane-title">Run</h2>
      <Notes status={status} />
      {!solving && <SolverChoice solver={solver} order={meshOrder} kind={specRunKind(currentSpec)} onChange={onSolverChange} />}
      {!solving && <Estimate state={estimate} size={size} onSizeChange={setSize} />}
      <button
        type="button"
        onClick={() => onRun(size ?? undefined)}
        disabled={blockers.length > 0 || requesting || solving}
      >
        {run === null ? "Run" : "Run again"}
      </button>
      {blockers.length > 0 && !solving && <Blockers blockers={blockers} onOpen={onOpen} />}
      {requestProblem && (
        <p className="form-problem" role="alert">
          {requestProblem}
        </p>
      )}
      {solving && <RunningJob run={run} requesting={requesting} onCancel={onCancel} />}
      {result && run !== null && (
        <RunResults
          run={run}
          result={result}
          units={units}
          unitChoice={unitChoice}
          onUnitChange={onUnitChange}
          onUnitReset={onUnitReset}
          choice={choice}
          onChoiceChange={onChoiceChange}
        />
      )}
      {run !== null && result && !modal && <RunExport run={run} result={result} units={units} thermal={thermal} thermalStress={thermalStress} />}
      {run !== null && result && <ShareLink key={run.id} runId={run.id} onSignedOut={onSignedOut} />}
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
