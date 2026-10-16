// SPDX-License-Identifier: AGPL-3.0-or-later
// The estimate before a run (M2.12, ADR-049): read from the API for the simulation's current
// mesh whenever that mesh becomes ready, and again when it or the solver changes (ADR-063).

import type { RunEstimate, Solver } from "@clearfea/spec";
import { useEffect, useState } from "react";
import { getEstimate } from "../api/runs";

export type EstimateState =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "failed"; problem: string }
  | { kind: "loaded"; estimate: RunEstimate };

/**
 * `meshId` is the id of the simulation's mesh while it is ready and current, and null
 * otherwise: there is nothing to estimate then.
 */
export function useEstimate(
  simulationId: string | null,
  meshId: string | null,
  solver: Solver,
  onSignedOut: (problem: string) => void,
): EstimateState {
  const [state, setState] = useState<EstimateState>({ kind: "none" });
  useEffect(() => {
    if (simulationId === null || meshId === null) {
      setState({ kind: "none" });
      return;
    }
    let current = true;
    setState({ kind: "loading" });
    void getEstimate(simulationId, solver).then((result) => {
      if (!current) return;
      if (result.kind === "ok") setState({ kind: "loaded", estimate: result.value });
      else {
        if (result.kind === "signedOut") onSignedOut(result.problem);
        setState({ kind: "failed", problem: result.problem });
      }
    });
    return () => {
      current = false;
    };
  }, [simulationId, meshId, solver, onSignedOut]);
  return state;
}
