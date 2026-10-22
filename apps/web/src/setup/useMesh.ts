// SPDX-License-Identifier: AGPL-3.0-or-later
// The open simulation's mesh (M1.6): loads its latest mesh, requests a new one, and follows a
// mesh that is being made until it is ready or failed. Remembers the id of a mesh the last
// request reused instead of making (M2.10), so the panel can say so. A mesh being made is checked
// through the shared polling hook (M11.2, ADR-112).

import type { JobWait, MeshView } from "@clearfea/spec";
import { useCallback, useEffect, useState } from "react";
import { followSimulationMesh, getSimulationMesh, requestMesh } from "../api/meshes";
import type { ApiResult } from "../api/request";
import { usePolling, waitChanged } from "../jobs/usePolling";

export type MeshState =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "failed"; problem: string }
  | { kind: "loaded"; mesh: MeshView | null };

export function useMesh(simulationId: string | null, onSignedOut: (problem: string) => void) {
  const [state, setState] = useState<MeshState>({ kind: "none" });
  const [requesting, setRequesting] = useState(false);
  const [requestProblem, setRequestProblem] = useState<string>();
  const [reusedId, setReusedId] = useState<string | null>(null);
  const [wait, setWait] = useState<JobWait | null>(null);

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
    setReusedId(null);
    if (simulationId === null) {
      setState({ kind: "none" });
      return;
    }
    let current = true;
    setState({ kind: "loading" });
    void getSimulationMesh(simulationId).then((result) => {
      if (!current) return;
      const problem = failed(result);
      if (problem !== null || result.kind !== "ok") setState({ kind: "failed", problem: problem ?? "" });
      else setState({ kind: "loaded", mesh: result.value });
    });
    return () => {
      current = false;
    };
  }, [simulationId, failed]);

  // While the mesh is being made, check on it until it is ready or failed.
  const meshing = state.kind === "loaded" && state.mesh?.status === "meshing" ? state.mesh.id : null;
  usePolling(meshing === null || simulationId === null ? null : `${simulationId}/${meshing}`, async (current) => {
    if (simulationId === null) return { changed: false };
    const result = await followSimulationMesh(simulationId);
    if (!current()) return { changed: false };
    if (result.kind !== "ok") {
      failed(result);
      return { changed: false };
    }
    const { value: mesh, wait: next } = result.value;
    const changed = mesh?.status !== "meshing" || waitChanged(wait, next);
    setWait(next);
    setState({ kind: "loaded", mesh });
    return { changed, retryAfter: next?.retryAfter };
  });

  const generate = useCallback(async () => {
    if (simulationId === null) return;
    setRequesting(true);
    const result = await requestMesh(simulationId);
    setRequesting(false);
    const problem = failed(result);
    if (problem !== null || result.kind !== "ok") {
      setRequestProblem(problem ?? undefined);
      return;
    }
    setRequestProblem(undefined);
    setReusedId(result.value.reused ? result.value.mesh.id : null);
    setState({ kind: "loaded", mesh: result.value.mesh });
  }, [simulationId, failed]);

  const mesh = state.kind === "loaded" ? state.mesh : null;
  const reused = mesh !== null && mesh.id === reusedId;
  return { state, mesh, generate, requesting, requestProblem, reused, wait: meshing === null ? null : wait };
}
