// SPDX-License-Identifier: AGPL-3.0-or-later
// Storage on the wallet page (M8.6, ADR-085): what the user keeps, by kind, against the free
// allowance and its rate above it, and every run still holding raw solver output, with when it
// is removed and a pin that keeps it.

import type { StorageKind, StorageView } from "@clearfea/spec";
import { useCallback, useEffect, useState } from "react";
import { pinRun } from "../api/runs";
import { fetchStorage } from "../api/storage";
import { bytes } from "./bytes";
import { credits } from "./credits";

const KIND_LABELS: Record<StorageKind, string> = {
  geometry: "Geometry (STEP files, topology, display meshes)",
  mesh: "Meshes",
  results: "Results (solver input, logs, viewer files)",
  rawOutput: "Raw solver output (.frd, .dat)",
  report: "Reports, report figures and logo",
};

type State = { kind: "loading" } | { kind: "loaded"; storage: StorageView } | { kind: "problem"; problem: string };

export function StorageSection({ refresh, onSignedOut }: { refresh: number; onSignedOut: (notice?: string) => void }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchStorage();
    if (result.kind === "signedOut") onSignedOut(result.problem);
    else if (result.kind === "error") setState({ kind: "problem", problem: result.problem });
    else setState({ kind: "loaded", storage: result.value });
  }, [onSignedOut]);

  useEffect(() => {
    void refresh;
    void load();
  }, [load, refresh]);

  async function pin(runId: string, pinned: boolean) {
    setBusy(runId);
    setProblem(null);
    const reply = await pinRun(runId, pinned);
    setBusy(null);
    if (reply.kind === "signedOut") return onSignedOut(reply.problem);
    if (reply.kind === "error") return setProblem(reply.problem);
    await load();
  }

  return (
    <section aria-label="Storage" className="wallet-storage">
      <h3 className="wallet-subtitle">Storage</h3>
      {state.kind === "loading" && <p className="pane-empty">Loading storage…</p>}
      {state.kind === "problem" && (
        <p className="form-problem" role="alert">
          {state.problem}
        </p>
      )}
      {state.kind === "loaded" && (
        <>
          <dl className="wallet-totals">
            <div>
              <dt>Stored</dt>
              <dd data-testid="storage-used">{bytes(state.storage.usedBytes)}</dd>
            </div>
            <div>
              <dt>Free allowance</dt>
              <dd>{bytes(state.storage.freeBytes)}</dd>
            </div>
            <div>
              <dt>Above the allowance</dt>
              <dd>{bytes(Math.max(0, state.storage.usedBytes - state.storage.freeBytes))}</dd>
            </div>
          </dl>
          <p className="wallet-note">
            Geometry, setups, solver input, logs, viewer files and reports are kept permanently. Raw solver output is
            removed {state.storage.retentionDays} days after its run ends unless the run is pinned; running the same
            setup again makes it again. Storage above the free allowance is charged once a day at{" "}
            {credits(state.storage.ratePerGibDay)} per GiB.
          </p>
          <table className="wallet-table" aria-label="Storage by kind">
            <thead>
              <tr>
                <th>Kind</th>
                <th className="wallet-number">Files</th>
                <th className="wallet-number">Size</th>
              </tr>
            </thead>
            <tbody>
              {state.storage.parts.map((part) => (
                <tr key={part.kind}>
                  <td>{KIND_LABELS[part.kind]}</td>
                  <td className="wallet-number">{part.files.toLocaleString("en-US")}</td>
                  <td className="wallet-number">{bytes(part.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4 className="wallet-subtitle">Runs holding raw solver output</h4>
          {state.storage.runs.length === 0 ? (
            <p className="pane-empty">None.</p>
          ) : (
            <table className="wallet-table" aria-label="Raw solver output">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Kept</th>
                  <th className="wallet-number">Size</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.storage.runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      Run of “{run.simulationName}”, started {utc(run.startedAt)} UTC
                    </td>
                    <td>{run.pinned ? "Pinned" : run.keptUntil === null ? "" : `Until ${run.keptUntil.slice(0, 10)}`}</td>
                    <td className="wallet-number">{bytes(run.bytes)}</td>
                    <td>
                      <button type="button" disabled={busy !== null} onClick={() => void pin(run.id, !run.pinned)}>
                        {run.pinned ? "Unpin" : "Pin"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {problem !== null && (
            <p className="form-problem" role="alert">
              {problem}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function utc(timestamp: string): string {
  return timestamp.slice(0, 19).replace("T", " ");
}
