// SPDX-License-Identifier: AGPL-3.0-or-later
// The page a read-only share link opens (/share/<token>, M8.7, ADR-082), for anyone holding the
// link, signed in or not. It reads the run through the link alone and shows what the owner sees
// of its results: the viewer with the quantity, shape and units chosen here, the result figures
// and the run's record without its cost. Nothing on it changes data; choices last until reload.

import { analysisKinds, type SharedRunResponse } from "@clearfea/spec";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSharedRun, sharedSource } from "../api/shareLinks";
import { StatusBar } from "../layout/StatusBar";
import { Viewer } from "../layout/Viewer";
import { useDisplayUnits } from "../setup/displayUnits";
import { ORDERS, type ResultChoice, RunResults, utc } from "../setup/RunPanel";
import { UnitSystemProvider } from "../units/system";
import { runChoice } from "../viewer/resultFields";

type State = { kind: "loading" } | { kind: "failed"; problem: string } | { kind: "shown"; shared: SharedRunResponse };

const NO_SELECTION: ReadonlySet<number> = new Set();
const ignore = () => {};

export function SharedRunPage({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [choice, setChoice] = useState<ResultChoice>({
    quantity: "vonMises",
    deformation: "auto",
    mode: 1,
    animate: false,
  });
  const source = useMemo(() => sharedSource(token), [token]);

  useEffect(() => {
    let current = true;
    void getSharedRun(token).then((reply) => {
      if (!current) return;
      if (reply.kind === "ok") setState({ kind: "shown", shared: reply.value });
      else setState({ kind: "failed", problem: reply.problem });
    });
    return () => {
      current = false;
    };
  }, [token]);

  // A file the viewer reads can say the link stopped working (it was revoked while open).
  const failed = useCallback((problem: string) => setState({ kind: "failed", problem }), []);

  const system = state.kind === "shown" ? state.shared.unitSystem : "metric-mm";
  const displayUnits = useDisplayUnits(null, system);

  if (state.kind !== "shown") {
    return (
      <div className="signin-page">
        <main className="signin" aria-label="Shared run">
          <div className="signin-form">
          <h1 className="signin-title">ClearFEA</h1>
          {state.kind === "loading" ? (
            <p role="status">Opening the shared run…</p>
          ) : (
            <p className="form-problem" role="alert">
              {state.problem}
            </p>
          )}
          </div>
        </main>
        <StatusBar />
      </div>
    );
  }

  const { run, simulationName } = state.shared;
  const shown = runChoice(run, choice);
  const count = (n: number | null) => (n === null ? "?" : n.toLocaleString("en-US"));
  return (
    <UnitSystemProvider value={system}>
      <div className="shell">
        <nav className="pane pane-tree" aria-label="Shared run">
          <h2 className="pane-title">Shared run</h2>
          <p className="shared-name">{simulationName}</p>
          <p className="field-hint" role="note">
            Read-only: someone shared this run's results with you. You can look at them but not change anything.
          </p>
          <dl className="geometry-facts" aria-label="Run record">
            <dt>Analysis</dt>
            <dd>{analysisKinds[run.spec.analysis]}</dd>
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
              {run.mesh.size.value} {run.mesh.size.unit}, {ORDERS[run.mesh.order]}; {count(run.mesh.elementCount)}{" "}
              elements, {count(run.mesh.nodeCount)} nodes
            </dd>
            <dt>ClearFEA</dt>
            <dd>{run.software.clearfea ?? "not recorded"}</dd>
            <dt>CalculiX</dt>
            <dd>{run.software.calculix ?? "not recorded"}</dd>
          </dl>
        </nav>
        <Viewer
          // The viewer keys its model on the geometry; the link reads the run's own topology.
          geometry={{ id: run.spec.geometryId, status: "ready", scaling: null }}
          result={{ run, ...shown, units: displayUnits.units }}
          selection={NO_SELECTION}
          onSelectionChange={ignore}
          onSignedOut={failed}
          source={source}
        />
        <aside className="pane pane-settings" aria-label="Results">
          <section className="setup-panel" aria-label="Run">
            <h2 className="pane-title">Results</h2>
            <RunResults
              run={run}
              result={run.result}
              units={displayUnits.units}
              unitChoice={displayUnits.choice}
              onUnitChange={displayUnits.change}
              onUnitReset={displayUnits.reset}
              choice={shown}
              onChoiceChange={setChoice}
            />
          </section>
        </aside>
        <StatusBar />
      </div>
    </UnitSystemProvider>
  );
}
