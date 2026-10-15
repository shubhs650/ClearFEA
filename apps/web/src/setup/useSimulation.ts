// SPDX-License-Identifier: AGPL-3.0-or-later
// The simulation being set up for the shown geometry (M1.5). Loads the newest simulation of a
// ready geometry with the geometry's topology, creates one when the user starts setup, and
// saves the spec shortly after each edit. The spec is checked in the browser first, so a
// problem shows at once and a spec the API would refuse is never sent (ADR-026).

import {
  checkSimulationSpec,
  type GeometryView,
  type SimulationSpec,
  type Topology,
  validateSimulationSpec,
} from "@clearfea/spec";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTopology } from "../api/geometries";
import type { ApiResult } from "../api/request";
import { createSimulation, listSimulations, saveSimulationSpec } from "../api/simulations";

/** How long after the last edit the spec is saved, so typing a number is one save, not one per key. */
export const SAVE_DELAY_MS = 400;

/** The name of a simulation created by "Start setup"; renaming comes later. */
export const NEW_SIMULATION_NAME = "Static structural";

export type Setup =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "failed"; problem: string }
  | { kind: "absent"; topology: Topology }
  | { kind: "open"; id: string; spec: SimulationSpec; topology: Topology };

export type SaveState =
  | { kind: "saved" }
  | { kind: "saving" }
  | { kind: "invalid"; problems: string[] }
  | { kind: "failed"; problem: string };

export function useSimulation(geometry: GeometryView | null, onSignedOut: (problem: string) => void) {
  const [setup, setSetup] = useState<Setup>({ kind: "none" });
  const [save, setSave] = useState<SaveState>({ kind: "saved" });
  const [starting, setStarting] = useState(false);
  const [startProblem, setStartProblem] = useState<string>();
  // Edits since the simulation was opened; a save answers only for the revision it sent.
  const revision = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const failed = useCallback(
    (result: ApiResult<unknown>): string | null => {
      if (result.kind === "ok") return null;
      if (result.kind === "signedOut") onSignedOut(result.problem);
      return result.problem;
    },
    [onSignedOut],
  );

  // Setup needs a geometry whose unit is confirmed; its faces are then fixed.
  const id = geometry?.status === "ready" ? geometry.id : null;
  useEffect(() => {
    revision.current = 0;
    setSave({ kind: "saved" });
    setStartProblem(undefined);
    if (id === null) {
      setSetup({ kind: "none" });
      return;
    }
    let current = true;
    setSetup({ kind: "loading" });
    void Promise.all([listSimulations(id), fetchTopology(id)]).then(([list, topology]) => {
      if (!current) return;
      for (const result of [list, topology]) {
        const problem = failed(result);
        if (problem !== null) return setSetup({ kind: "failed", problem });
      }
      if (list.kind !== "ok" || topology.kind !== "ok") return;
      const newest = list.value[0];
      setSetup(
        newest === undefined
          ? { kind: "absent", topology: topology.value }
          : { kind: "open", id: newest.id, spec: newest.spec, topology: topology.value },
      );
    });
    return () => {
      current = false;
    };
  }, [id, failed]);

  const start = useCallback(async (): Promise<boolean> => {
    if (id === null || setup.kind !== "absent") return false;
    setStarting(true);
    const result = await createSimulation(id, NEW_SIMULATION_NAME);
    setStarting(false);
    const problem = failed(result);
    if (problem !== null || result.kind !== "ok") {
      setStartProblem(problem ?? undefined);
      return false;
    }
    setStartProblem(undefined);
    setSetup({ kind: "open", id: result.value.id, spec: result.value.spec, topology: setup.topology });
    return true;
  }, [id, setup, failed]);

  const edit = useCallback((spec: SimulationSpec) => {
    revision.current += 1;
    setSetup((was) => (was.kind === "open" ? { ...was, spec } : was));
  }, []);

  // Save the latest spec once edits pause; saves run one at a time, in order.
  const open = setup.kind === "open" ? setup : null;
  useEffect(() => {
    if (open === null || revision.current === 0) return;
    const sent = revision.current;
    // The panels keep values in range; the schema check is a backstop before the API's own.
    const shape = validateSimulationSpec(open.spec);
    const problems = shape.ok ? checkSimulationSpec(open.spec, open.topology) : shape.errors;
    if (problems.length > 0) {
      setSave({ kind: "invalid", problems });
      return;
    }
    setSave({ kind: "saving" });
    const timer = setTimeout(() => {
      queue.current = queue.current.then(async () => {
        const result = await saveSimulationSpec(open.id, open.spec);
        if (sent !== revision.current) return;
        const problem = failed(result);
        setSave(problem === null ? { kind: "saved" } : { kind: "failed", problem });
      });
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [open, failed]);

  return { setup, save, start, starting, startProblem, edit };
}
