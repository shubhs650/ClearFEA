// SPDX-License-Identifier: AGPL-3.0-or-later
// The Figures and Word and PDF report parts of the Report panel. Figures (M7.2, ADR-011): draws the
// report's figures for the latest solved run (one per support and load, one per view picked) from
// the saved report options, stores them on the run, and shows what is stored. Word and PDF report
// (M7.3, ADR-077; M7.4, ADR-078): draws the figures again, so they follow the saved options, then
// asks the worker to make the report and offers its Word file and PDF for download once made.

import type { JobWait, ReportFigure, ReportOptions, RunReport, RunView, SavedView } from "@clearfea/spec";
import { useEffect, useState } from "react";
import { figurePath, listFigures } from "../api/figures";
import { fetchRunReport, followRunReport, makeRunReport, reportFilePath } from "../api/reports";
import { MachineStartNote } from "../jobs/MachineStartNote";
import { usePolling, waitChanged } from "../jobs/usePolling";
import { captureFigures, planFigures } from "../report/figures";
import { resultUnits } from "./displayUnits";

type Stored = { kind: "loading" } | { kind: "failed"; problem: string } | { kind: "ok"; figures: ReportFigure[] };

type Capture =
  | { kind: "idle" }
  | { kind: "drawing"; done: number; total: number }
  | { kind: "done"; count: number; problems: string[] }
  | { kind: "failed"; problem: string };

type Report = { kind: "loading" } | { kind: "failed"; problem: string } | { kind: "ok"; report: RunReport | null };

function megabytes(bytes: number): string {
  return bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} kB` : `${(bytes / 1e6).toFixed(1)} MB`;
}

export function ReportFigures({
  run,
  geometryId,
  options,
  views,
  unsaved,
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
  onSignedOut: (problem: string) => void;
}) {
  const solved = run?.status === "succeeded" ? run : null;
  const runId = solved?.id ?? null;
  const [stored, setStored] = useState<Stored>({ kind: "loading" });
  const [capture, setCapture] = useState<Capture>({ kind: "idle" });
  const [report, setReport] = useState<Report>({ kind: "loading" });
  const [asking, setAsking] = useState(false);
  const [wait, setWait] = useState<JobWait | null>(null);

  useEffect(() => {
    if (runId === null) return;
    let current = true;
    setStored({ kind: "loading" });
    setCapture({ kind: "idle" });
    setReport({ kind: "loading" });
    listFigures(runId).then((result) => {
      if (!current) return;
      if (result.kind === "ok") return setStored({ kind: "ok", figures: result.value });
      if (result.kind === "signedOut") onSignedOut(result.problem);
      setStored({ kind: "failed", problem: `The figures could not be loaded: ${result.problem}` });
    });
    fetchRunReport(runId).then((result) => {
      if (!current) return;
      if (result.kind === "ok") return setReport({ kind: "ok", report: result.value });
      if (result.kind === "signedOut") onSignedOut(result.problem);
      setReport({ kind: "failed", problem: `The report could not be loaded: ${result.problem}` });
    });
    return () => {
      current = false;
    };
  }, [runId, onSignedOut]);

  // While a report is queued or being made, check on it until it is made or has failed, through
  // the shared polling hook (M11.2, ADR-112).
  const pendingReport =
    report.kind === "ok" && report.report !== null && ["queued", "making"].includes(report.report.status)
      ? report.report
      : null;
  const pending = pendingReport?.id ?? null;
  usePolling(pending === null || runId === null ? null : `${runId}/${pending}`, async (current) => {
    if (runId === null) return { changed: false };
    const result = await followRunReport(runId);
    if (!current()) return { changed: false };
    if (result.kind !== "ok") {
      if (result.kind === "signedOut") onSignedOut(result.problem);
      return { changed: false };
    }
    const { value: next, wait: nextWait } = result.value;
    const changed = next?.id !== pendingReport?.id || next?.status !== pendingReport?.status || waitChanged(wait, nextWait);
    setWait(nextWait);
    setReport({ kind: "ok", report: next });
    return { changed, retryAfter: nextWait?.retryAfter };
  });

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

  /** Draws and stores the figures; true when it got as far as storing them. */
  async function draw(): Promise<boolean> {
    if (solved === null || geometryId === null || planned === null) return false;
    setCapture({ kind: "drawing", done: 0, total: planned.length });
    const outcome = await captureFigures({
      run: solved,
      geometryId,
      planned,
      // Legends in the report's own unit system (ADR-076), not the units the viewer shows.
      units: resultUnits(options.unitSystem, {}),
      onProgress: (done, total) => setCapture({ kind: "drawing", done, total }),
    });
    if (outcome.kind === "signedOut") {
      onSignedOut(outcome.problem);
      return false;
    }
    if (outcome.kind === "error") {
      setCapture({ kind: "failed", problem: `The figures were not drawn: ${outcome.problem}` });
      // Capturing starts by clearing the stored figures, so show what is left.
      const now = await listFigures(solved.id);
      if (now.kind === "ok") setStored({ kind: "ok", figures: now.value });
      return false;
    }
    setStored({ kind: "ok", figures: outcome.figures });
    setCapture({ kind: "done", count: outcome.figures.length, problems: outcome.problems });
    return true;
  }

  /** Draws the figures again, so they follow the saved options, then asks for the report. */
  async function make() {
    if (solved === null) return;
    setAsking(true);
    const drawn = planned === null || planned.length === 0 ? true : await draw();
    if (!drawn) return setAsking(false);
    const result = await makeRunReport(solved.id);
    setAsking(false);
    if (result.kind === "ok") return setReport({ kind: "ok", report: result.value });
    if (result.kind === "signedOut") return onSignedOut(result.problem);
    setReport({ kind: "failed", problem: `The report was not made: ${result.problem}` });
  }

  const latest = report.kind === "ok" ? report.report : null;
  const busy = asking || drawing || pending !== null;
  return (
    <>
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
    <fieldset className="setup-bodies">
      <legend>Word and PDF report</legend>
      <span className="field-hint">
        Draws the figures again from the saved options, then makes the report of the latest solved run as a Word file
        and a PDF printed from it, page for page.
      </span>
      <div className="field-actions">
        <button type="button" onClick={() => void make()} disabled={busy || unsaved || planned === null}>
          Make the report
        </button>
      </div>
      {unsaved && <span className="field-hint">Save the report options first: the report follows the saved ones.</span>}
      {asking && !drawing && <span className="field-hint" role="status">Asking for the report…</span>}
      {latest?.status === "queued" && <span className="field-hint" role="status">The report is waiting for the worker…</span>}
      <MachineStartNote wait={latest?.status === "queued" ? wait : null} />
      {latest?.status === "making" && <span className="field-hint" role="status">Making the report…</span>}
      {latest?.status === "failed" && (
        <span className="form-problem" role="alert">
          {latest.problem}
        </span>
      )}
      {report.kind === "failed" && (
        <span className="form-problem" role="alert">
          {report.problem}
        </span>
      )}
      {latest?.status === "succeeded" && (
        <div className="field-hint" role="status">
          <p>Made {new Date(latest.finishedAt ?? latest.createdAt).toLocaleString()}:</p>
          <ul>
            <li>
              <a href={reportFilePath(solved.id, latest, "docx")} download>
                Download the Word report
              </a>
              {latest.sizeBytes !== null && ` (${megabytes(latest.sizeBytes)})`}
            </li>
            <li>
              {latest.pdfSizeBytes !== null ? (
                <>
                  <a href={reportFilePath(solved.id, latest, "pdf")} download>
                    Download the PDF report
                  </a>
                  {` (${megabytes(latest.pdfSizeBytes)})`}
                </>
              ) : (
                "This report was made before reports had a PDF. Make the report again to get one."
              )}
            </li>
          </ul>
        </div>
      )}
    </fieldset>
    </>
  );
}
