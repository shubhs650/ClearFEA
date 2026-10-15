// SPDX-License-Identifier: AGPL-3.0-or-later
// The material library and the user's own materials (M2.9, ADR-046), loaded once a setup is open.
// Saving or deleting one of the user's materials updates the list; a simulation keeps its own
// copy of a material, so neither touches a setup.

import type { IsotropicMaterial, MaterialsResponse } from "@clearfea/spec";
import { useCallback, useEffect, useState } from "react";
import { deleteMaterial, listMaterials, saveMaterial } from "../api/materials";
import type { ApiResult } from "../api/request";

export type MaterialList =
  | { kind: "loading" }
  | { kind: "failed"; problem: string }
  | ({ kind: "ok" } & MaterialsResponse);

/** The outcome of saving or deleting, as a line for the panel. */
export type MaterialAction = { kind: "ok"; message: string } | { kind: "failed"; problem: string };

function byName(materials: IsotropicMaterial[]): IsotropicMaterial[] {
  return [...materials].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function useMaterials(enabled: boolean, onSignedOut: (problem: string) => void) {
  const [list, setList] = useState<MaterialList>({ kind: "loading" });

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    setList({ kind: "loading" });
    listMaterials().then((result) => {
      if (!current) return;
      if (result.kind === "ok") setList({ kind: "ok", ...result.value });
      else {
        if (result.kind === "signedOut") onSignedOut(result.problem);
        setList({ kind: "failed", problem: `The material library could not be loaded: ${result.problem}` });
      }
    });
    return () => {
      current = false;
    };
  }, [enabled, onSignedOut]);

  const failed = useCallback(
    (result: ApiResult<unknown>, what: string): MaterialAction => {
      if (result.kind === "signedOut") onSignedOut(result.problem);
      return { kind: "failed", problem: `${what}: ${result.kind === "ok" ? "" : result.problem}` };
    },
    [onSignedOut],
  );

  const save = useCallback(
    async (material: IsotropicMaterial): Promise<MaterialAction> => {
      const result = await saveMaterial(material);
      if (result.kind !== "ok") return failed(result, "The material was not saved");
      const saved = result.value;
      setList((now) => (now.kind === "ok" ? { ...now, custom: byName([...now.custom, saved]) } : now));
      return { kind: "ok", message: `Saved "${saved.name}" to your materials. You can add it to any simulation.` };
    },
    [failed],
  );

  const remove = useCallback(
    async (material: IsotropicMaterial): Promise<MaterialAction> => {
      const result = await deleteMaterial(material.id);
      if (result.kind !== "ok") return failed(result, "The material was not deleted");
      setList((now) => (now.kind === "ok" ? { ...now, custom: now.custom.filter((m) => m.id !== material.id) } : now));
      return { kind: "ok", message: `Deleted "${material.name}" from your materials. Simulations that use it keep their copy.` };
    },
    [failed],
  );

  return { list, save, remove };
}
