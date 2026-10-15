// SPDX-License-Identifier: AGPL-3.0-or-later
// The open simulation's latest run (M1.8): loads it, starts a new one, and while it solves
// follows its stage and reads on in its solver log every couple of seconds.

import type { RunView } from "@clearfea/spec";
import { useCallback, useEffect, useState } from "react";
import type { ApiResult } from "../api/request";
import { getRun, getRunLog, listRuns, startRun } from "../api/runs";

/** How often a solving run and its log are checked. */
export const RUN_POLL_MS = 2000;

export type RunState =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "failed"; problem: string }
  | { kind: "loaded"; run: RunView | null };

export function useRun(simulationId: string | null, onSignedOut: (problem: string) => void) {
  const [state, setState] = useState<RunState>({ kind: "none" });
  const [log, setLog] = useState({ runId: "", text: "", next: 0 });
  const [requesting, setRequesting] = useState(false);
  const [requestProblem, setRequestProblem] = useState<string>();

  const failed = useCallback(
    (result: ApiResult<unknown>): string | null => {
      if (result.kind === "ok") return null;
      if (result.kind === "signedOut") onSignedOut(result.problem);
      return result.problem;
    },
    [onSignedOut],
  );

  useEffect(() => {
    setRequestProblem(undefined);
    if (simulationId === null) {
      setState({ kind: "none" });
      return;
    }
    let current = true;
    setState({ kind: "loading" });
    void listRuns(simulationId).then((result) => {
      if (!current) return;
      const problem = failed(result);
      if (problem !== null || result.kind !== "ok") setState({ kind: "failed", problem: problem ?? "" });
      else setState({ kind: "loaded", run: result.value[0] ?? null });
    });
    return () => {
      current = false;
    };
  }, [simulationId, failed]);

  const run = state.kind === "loaded" ? state.run : null;
  const runId = run?.id ?? null;
  const solving = run?.status === "solving";

  // Reads the run's log from the start when the run changes, then on from where it stopped.
  // While the run solves, its status and log are read again every RUN_POLL_MS.
  useEffect(() => {
    if (runId === null) return;
    let current = true;
    let next = 0;
    let reading = false;
    setLog({ runId, text: "", next: 0 });
    async function readLog(id: string) {
      // One read at a time, so no chunk is fetched twice.
      if (reading) return;
      reading = true;
      try {
        await readOn(id);
      } finally {
        reading = false;
      }
    }
    async function readOn(id: string) {
      for (;;) {
        const result = await getRunLog(id, next);
        if (!current || result.kind !== "ok") {
          if (current) failed(result);
          return;
        }
        if (result.value.next === next) return;
        next = result.value.next;
        const text = result.value.text;
        setLog((old) => ({ runId: id, text: old.runId === id ? old.text + text : text, next }));
      }
    }
    void readLog(runId);
    if (!solving) {
      return () => {
        current = false;
      };
    }
    const timer = setInterval(() => {
      void getRun(runId).then(async (result) => {
        if (!current || result.kind !== "ok") {
          if (current) failed(result);
          return;
        }
        await readLog(runId);
        if (current) setState({ kind: "loaded", run: result.value });
      });
    }, RUN_POLL_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [runId, solving, failed]);

  const start = useCallback(async () => {
    if (simulationId === null) return;
    setRequesting(true);
    const result = await startRun(simulationId);
    setRequesting(false);
    const problem = failed(result);
    if (problem !== null || result.kind !== "ok") {
      setRequestProblem(problem ?? undefined);
      return;
    }
    setRequestProblem(undefined);
    setState({ kind: "loaded", run: result.value });
  }, [simulationId, failed]);

  return { state, run, log: log.runId === runId ? log.text : "", start, requesting, requestProblem };
}
