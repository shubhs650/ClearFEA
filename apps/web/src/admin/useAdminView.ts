// SPDX-License-Identifier: AGPL-3.0-or-later
// The admin view of GET /api/admin (M10.3, ADR-097) that the Users and Settings tabs read and
// change (M13.3): the allowlist, the users, the machine sizes and the solver machines or host.

import type { AdminResponse } from "@clearfea/spec";
import { useCallback, useEffect, useState } from "react";
import { fetchAdmin } from "../api/admin";
import type { ApiResult } from "../api/request";

export type AdminState =
  | { kind: "loading" }
  | { kind: "loaded"; admin: AdminResponse }
  | { kind: "problem"; problem: string };

/**
 * Reads the view once, and `change` runs a change and shows its answer; a refused change keeps
 * the tab and sets `problem` to why. `change` returns whether it was accepted; `reload` reads it again.
 */
export function useAdminView(onSignedOut: (notice?: string) => void) {
  const [state, setState] = useState<AdminState>({ kind: "loading" });
  const [problem, setProblem] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const show = useCallback(
    (result: ApiResult<AdminResponse>, change: boolean): boolean => {
      if (result.kind === "signedOut") onSignedOut(result.problem);
      else if (result.kind === "error") {
        if (change) setProblem(result.problem);
        else setState({ kind: "problem", problem: result.problem });
      } else {
        setState({ kind: "loaded", admin: result.value });
        setProblem(undefined);
        return true;
      }
      return false;
    },
    [onSignedOut],
  );

  const reload = useCallback(async () => {
    show(await fetchAdmin(), false);
  }, [show]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function change(request: () => Promise<ApiResult<AdminResponse>>): Promise<boolean> {
    setBusy(true);
    const accepted = show(await request(), true);
    setBusy(false);
    return accepted;
  }

  return { state, problem, busy, change, reload };
}
