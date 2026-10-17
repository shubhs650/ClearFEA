// SPDX-License-Identifier: AGPL-3.0-or-later
// The Figures part of the Report panel (M7.2, ADR-011): draws the report's figures for the latest
// solved run (one per support and load, one per view picked) from the saved report options,
// stores them on the run, and shows what is stored.

import type { ReportFigure, ReportOptions, RunView, SavedView } from "@clearfea/spec";
import { useEffect, useState } from "react";
import { figurePath, listFigures } from "../api/figures";
import { captureFigures, planFigures } from "../report/figures";

type Stored = { kind: "loading" } | { kind: "failed"; problem: string } | { kind: "ok"; figures: ReportFigure[] };

type Capture =
  | { kind: "idle" }
  | { kind: "drawing"; done: number; total: number }
  | { kind: "done"; count: number; problems: string[] }
  | { kind: "failed"; problem: string };

export function ReportFigures({
  run,
  geometryId,
  options,
  views,
  unsaved,
  units,
  onSignedOut,
}: {
  /** The simulation's latest run; figures are drawn from it once it has succeeded. */
  run: RunView | null;
  geometryId: string | null;
  /** The saved report options, which decide the figures. */
  options: ReportOptions;
  /** The simulation's saved views, or null while they load. */
  views: SavedView[] | null;
  /** Whether the options shown differ from the saved ones. */
  unsaved: boolean;
  units: Readonly<Record<string, string>>;
  onSignedOut: (problem: string) => void;
}) {
  const solved = run?.status === "succeeded" ? run : null;
  const runId = solved?.id ?? null;
  const [stored, setStored] = useState<Stored>({ kind: "loading" });
  const [capture, setCapture] = useState<Capture>({ kind: "idle" });

  useEffect(() => {
    if (runId === null) return;
    let current = true;
    setStored({ kind: "loading" });
    setCapture({ kind: "idle" });
    listFigures(runId).then((result) => {
      if (!current) return;
      if (result.kind === "ok") return setStored({ kind: "ok", figures: result.value });
      if (result.kind === "signedOut") onSignedOut(result.problem);
      setStored({ kind: "failed", problem: `The figures could not be loaded: ${result.problem}` });
    });
    return () => {
      current = false;
    };
  }, [runId, onSignedOut]);

  if (solved === null || geometryId === null) {
    return (
      <fieldset className="setup-bodies">
        <legend>Figures</legend>
        <span className="field-hint">Run the simulation to draw the figures. They are drawn from its latest solved run.</span>
      </fieldset>
    );
  }

  const planned = views === null ? null : planFigures(solved, options, views);
  const drawing = capture.kind === "drawing";

  async function draw() {
    if (solved === null || geometryId === null || planned === null) return;
    setCapture({ kind: "drawing", done: 0, total: planned.length });
    const outcome = await captureFigures({
      run: solved,
      geometryId,
      planned,
      units,
      onProgress: (done, total) => setCapture({ kind: "drawing", done, total }),
    });
    if (outcome.kind === "signedOut") return onSignedOut(outcome.problem);
    if (outcome.kind === "error") {
      setCapture({ kind: "failed", problem: `The figures were not drawn: ${outcome.problem}` });
      // Capturing starts by clearing the stored figures, so show what is left.
      const now = await listFigures(solved.id);
      if (now.kind === "ok") setStored({ kind: "ok", figures: now.value });
      return;
    }
    setStored({ kind: "ok", figures: outcome.figures });
    setCapture({ kind: "done", count: outcome.figures.length, problems: outcome.problems });
  }

  return (
    <fieldset className="setup-bodies">
      <legend>Figures</legend>
      <span className="field-hint">
        One figure for each support and load, and one for each view picked above, drawn from the latest solved run as the
        viewer shows it.
      </span>
      <div className="field-actions">
        <button type="button" onClick={() => void draw()} disabled={drawing || unsaved || planned === null || planned.length === 0}>
          {stored.kind === "ok" && stored.figures.length > 0 ? "Draw the figures again" : "Draw the figures"}
        </button>
      </div>
      {unsaved && <span className="field-hint">Save the report options first: the figures follow the saved ones.</span>}
      {planned !== null && planned.length === 0 && (
        <span className="field-hint">
          The options ask for no figures. Turn on Loads and supports, or Result plots with views picked.
        </span>
      )}
      {capture.kind === "drawing" && (
        <span className="field-hint" role="status">
          Drawing figure {Math.min(capture.done + 1, capture.total)} of {capture.total}…
        </span>
      )}
      {capture.kind === "done" && (
        <span className="field-hint" role="status">
          {capture.count === 1 ? "Drew 1 figure." : `Drew ${capture.count} figures.`}
        </span>
      )}
      {capture.kind === "done" && capture.problems.length > 0 && (
        <div className="form-problem" role="alert">
          {capture.problems.length === 1 ? "One figure could not be drawn:" : "Some figures could not be drawn:"}
          <ul>
            {capture.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}
      {capture.kind === "failed" && (
        <span className="form-problem" role="alert">
          {capture.problem}
        </span>
      )}
      {stored.kind === "loading" && <span className="field-hint">Loading the figures…</span>}
      {stored.kind === "failed" && (
        <span className="form-problem" role="alert">
          {stored.problem}
        </span>
      )}
      {stored.kind === "ok" && stored.figures.length === 0 && capture.kind === "idle" && (
        <span className="field-hint">No figures drawn for this run yet.</span>
      )}
      {stored.kind === "ok" && stored.figures.length > 0 && (
        <ol className="report-figures" aria-label="Figures">
          {stored.figures.map((figure) => (
            <li key={`${figure.kind}/${figure.item}`}>
              <a href={figurePath(solved.id, figure)} target="_blank" rel="noreferrer">
                <img src={figurePath(solved.id, figure)} alt={figure.caption} width={figure.width} height={figure.height} />
              </a>
              <span>{figure.caption}</span>
            </li>
          ))}
        </ol>
      )}
    </fieldset>
  );
}
