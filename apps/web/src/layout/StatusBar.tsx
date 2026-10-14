// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";
import { fetchHealth, type HealthState } from "../api/health";

const labels: Record<HealthState["kind"], string> = {
  checking: "Checking API…",
  ok: "API connected",
  degraded: "API running with problems",
  unreachable: "API not reachable",
};

export function StatusBar() {
  const [health, setHealth] = useState<HealthState>({ kind: "checking" });

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal).then(setHealth, () => {
      // Only an abort on unmount lands here; fetchHealth turns every other failure into a state.
    });
    return () => controller.abort();
  }, []);

  return (
    <footer className="pane pane-status" role="contentinfo" aria-label="Status">
      <span className={`status-dot status-${health.kind}`} aria-hidden="true" />
      <span role="status">{labels[health.kind]}</span>
      {"problems" in health &&
        health.problems.map((problem) => (
          <span key={problem} className="status-problem">
            {problem}
          </span>
        ))}
    </footer>
  );
}
