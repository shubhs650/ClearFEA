// SPDX-License-Identifier: AGPL-3.0-or-later
// The open simulation's latest run (M1.8): loads it, starts a new one, and while it solves
// follows its stage, time and cost and reads on in its solver log every couple of seconds; it
// can be cancelled (M8.2). Since M8.6 a run's pin can change, and a finished run can be solved
// again with its own frozen setup. Since M11.2 (ADR-112) a solving run is checked through the
// shared polling hook, which backs off while nothing changes.

import type { JobWait, RunView } from "@clearfea/spec";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiResult } from "../api/request";
import { cancelRun, followRun, getRunLog, listRuns, rerunRun, startRun } from "../api/runs";
import { usePolling, waitChanged } from "../jobs/usePolling";

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
  const [wait, setWait] = useState<JobWait | null>(null);
  /** Reads the run's log on from where it stopped; set while a run is shown. */
  const readLogRef = useRef<((id: string) => Promise<void>) | null>(null);

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

  // Reads the run's log from the start when the run changes, then on from where it stopped
  // whenever the polling below checks the solving run.
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
    readLogRef.current = readLog;
    return () => {
      current = false;
      if (readLogRef.current === readLog) readLogRef.current = null;
    };
  }, [runId, failed]);

  // While the run solves, its status, cost and log are checked until it has finished. New log
  // lines alone do not count as a change, so a long solve is checked less and less often.
  usePolling(solving && runId !== null ? runId : null, async (current) => {
    if (runId === null) return { changed: false };
    const result = await followRun(runId);
    if (!current()) return { changed: false };
    if (result.kind !== "ok") {
      failed(result);
      return { changed: false };
    }
    const { value: next, wait: nextWait } = result.value;
    await readLogRef.current?.(runId);
    if (!current()) return { changed: false };
    const changed = next.status !== run?.status || next.stage !== run?.stage || waitChanged(wait, nextWait);
    setWait(nextWait);
    setState({ kind: "loaded", run: next });
    return { changed, retryAfter: nextWait?.retryAfter };
  });

  const start = useCallback(
    async (machineSize?: string, stopMultiplier?: number) => {
    if (simulationId === null) return;
    setRequesting(true);
    const result = await startRun(simulationId, machineSize, stopMultiplier);
    setRequesting(false);
    const problem = failed(result);
    if (problem !== null || result.kind !== "ok") {
      setRequestProblem(problem ?? undefined);
      return;
    }
    setRequestProblem(undefined);
    setState({ kind: "loaded", run: result.value });
    },
    [simulationId, failed],
  );

  const cancel = useCallback(async () => {
    if (runId === null) return;
    setRequesting(true);
    const result = await cancelRun(runId);
    setRequesting(false);
    const problem = failed(result);
    if (problem !== null || result.kind !== "ok") {
      setRequestProblem(problem ?? undefined);
      return;
    }
    setRequestProblem(undefined);
    setState({ kind: "loaded", run: result.value });
  }, [runId, failed]);

  /** Solves a finished run's frozen setup again; the new run becomes the latest (M8.6). */
  const rerun = useCallback(
    async (id: string) => {
      setRequesting(true);
      const result = await rerunRun(id);
      setRequesting(false);
      const problem = failed(result);
      if (problem !== null || result.kind !== "ok") {
        setRequestProblem(problem ?? undefined);
        return;
      }
      setRequestProblem(undefined);
      setState({ kind: "loaded", run: result.value });
    },
    [failed],
  );

  /** Shows a newer copy of the latest run, such as after its pin changed. */
  const replace = useCallback((next: RunView) => {
    setState((was) => (was.kind === "loaded" && was.run?.id === next.id ? { kind: "loaded", run: next } : was));
  }, []);

  return {
    state,
    run,
    log: log.runId === runId ? log.text : "",
    wait: solving ? wait : null,
    start,
    cancel,
    rerun,
    replace,
    requesting,
    requestProblem,
  };
}
