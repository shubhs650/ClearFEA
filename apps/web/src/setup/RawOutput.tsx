// SPDX-License-Identifier: AGPL-3.0-or-later
// A finished run's raw solver output in the Run panel (M8.6, ADR-085): results.frd and
// results.dat to download, how long they are kept, a pin that keeps them, and, once the daily
// sweep has removed them, a rerun of the run's own setup that makes them again.

import type { RunView } from "@clearfea/spec";
import { useState } from "react";
import { pinRun, runFileUrl } from "../api/runs";

const RAW_FILES = ["results.frd", "results.dat"] as const;

/** A date the way the run record writes times: fixed, UTC, day only. */
function day(timestamp: string): string {
  return `${timestamp.slice(0, 10)} UTC`;
}

export function RawOutput({
  run,
  requesting,
  onRunChanged,
  onRerun,
  onSignedOut,
}: {
  run: RunView;
  /** True while a run or rerun request is on its way. */
  requesting: boolean;
  onRunChanged: (run: RunView) => void;
  onRerun: (runId: string) => void;
  onSignedOut: (problem: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const raw = run.rawOutput;
  const stored = RAW_FILES.filter((name) => run.files.includes(name));
  if (run.status === "solving" || (stored.length === 0 && raw.removedAt === null)) return null;

  async function pin(pinned: boolean) {
    setBusy(true);
    setProblem(null);
    const reply = await pinRun(run.id, pinned);
    setBusy(false);
    if (reply.kind === "signedOut") return onSignedOut(reply.problem);
    if (reply.kind === "error") return setProblem(reply.problem);
    onRunChanged(reply.value);
  }

  return (
    <section aria-label="Raw solver output">
      <h3 className="pane-subtitle">Raw solver output</h3>
      {raw.rerunOf !== null && (
        <p className="field-hint">This run solved the setup and mesh of an earlier run again, to regenerate its raw output.</p>
      )}
      {raw.removedAt !== null ? (
        <>
          <p data-testid="raw-output-state">
            Removed on {day(raw.removedAt)}, at the end of the retention period, because the run was not pinned. The
            results shown here, the solver input and the log are kept.
          </p>
          <button type="button" onClick={() => onRerun(run.id)} disabled={requesting}>
            Run this setup again
          </button>
          <p className="field-hint">
            Solves the setup and mesh of this run again as a new run, which makes the raw output again. It is charged
            like any run.
          </p>
        </>
      ) : (
        <>
          <p data-testid="raw-output-state">
            {raw.pinned
              ? "Pinned: kept until you unpin the run."
              : raw.keptUntil === null
                ? "Kept."
                : `Kept until ${day(raw.keptUntil)}, then removed unless the run is pinned. Everything else of the run is kept.`}
          </p>
          <p>
            {stored.map((name, index) => (
              <span key={name}>
                {index > 0 && " · "}
                <a href={runFileUrl(run.id, name, true)} download>
                  Download {name}
                </a>
              </span>
            ))}
          </p>
          <button type="button" onClick={() => void pin(!raw.pinned)} disabled={busy}>
            {raw.pinned ? "Unpin" : "Pin to keep"}
          </button>
        </>
      )}
      {problem !== null && (
        <p className="form-problem" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}
