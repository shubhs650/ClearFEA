// SPDX-License-Identifier: AGPL-3.0-or-later
// A simulation's saved views (M3.6, ADR-055), loaded while it is open. Saving a view under a
// name it already has replaces that view.

import type { SavedView, ViewSettings } from "@clearfea/spec";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiResult } from "../api/request";
import { deleteView, listViews, saveView } from "../api/views";

export type ViewList = { kind: "loading" } | { kind: "failed"; problem: string } | { kind: "ok"; views: SavedView[] };

/** The outcome of saving or deleting, as a line for the panel. */
export type ViewAction = { kind: "ok"; message: string } | { kind: "failed"; problem: string };

function byName(views: SavedView[]): SavedView[] {
  return [...views].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function useViews(simulationId: string | null, onSignedOut: (problem: string) => void) {
  const [list, setList] = useState<ViewList>({ kind: "loading" });
  const listNow = useRef(list);
  listNow.current = list;

  useEffect(() => {
    if (simulationId === null) return;
    let current = true;
    setList({ kind: "loading" });
    listViews(simulationId).then((result) => {
      if (!current) return;
      if (result.kind === "ok") setList({ kind: "ok", views: result.value });
      else {
        if (result.kind === "signedOut") onSignedOut(result.problem);
        setList({ kind: "failed", problem: `The saved views could not be loaded: ${result.problem}` });
      }
    });
    return () => {
      current = false;
    };
  }, [simulationId, onSignedOut]);

  const failed = useCallback(
    (result: ApiResult<unknown>, what: string): ViewAction => {
      if (result.kind === "signedOut") onSignedOut(result.problem);
      return { kind: "failed", problem: `${what}: ${result.kind === "ok" ? "" : result.problem}` };
    },
    [onSignedOut],
  );

  const save = useCallback(
    async (name: string, settings: ViewSettings): Promise<ViewAction> => {
      if (simulationId === null) return { kind: "failed", problem: "Open a simulation to save a view." };
      const result = await saveView(simulationId, name, settings);
      if (result.kind !== "ok") return failed(result, "The view was not saved");
      const saved = result.value;
      const before = listNow.current;
      const replaced = before.kind === "ok" && before.views.some((v) => v.id === saved.id);
      setList((now) =>
        now.kind === "ok" ? { kind: "ok", views: byName([...now.views.filter((v) => v.id !== saved.id), saved]) } : now,
      );
      return { kind: "ok", message: replaced ? `Replaced the view "${saved.name}".` : `Saved the view "${saved.name}".` };
    },
    [simulationId, failed],
  );

  const remove = useCallback(
    async (view: SavedView): Promise<ViewAction> => {
      if (simulationId === null) return { kind: "failed", problem: "Open a simulation to delete a view." };
      const result = await deleteView(simulationId, view.id);
      if (result.kind !== "ok") return failed(result, "The view was not deleted");
      setList((now) => (now.kind === "ok" ? { kind: "ok", views: now.views.filter((v) => v.id !== view.id) } : now));
      return { kind: "ok", message: `Deleted the view "${view.name}".` };
    },
    [simulationId, failed],
  );

  return { list, save, remove };
}
