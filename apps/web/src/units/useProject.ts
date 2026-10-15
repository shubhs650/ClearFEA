// SPDX-License-Identifier: AGPL-3.0-or-later
// The signed-in user's project and its unit system (M2.1, ADR-038). Until the project has loaded,
// or if it cannot be loaded, the table's default system is used, so the app never waits on it.

import { unitsTable } from "@clearfea/spec";
import { useCallback, useEffect, useState } from "react";
import { fetchProject, setProjectUnitSystem } from "../api/projects";

export function useProject(signedIn: boolean, onSignedOut: (problem: string) => void) {
  const [unitSystem, setUnitSystem] = useState(unitsTable.defaultSystem);
  const [problem, setProblem] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    let current = true;
    fetchProject().then((result) => {
      if (!current) return;
      if (result.kind === "ok") {
        setUnitSystem(result.value.unitSystem);
        setProblem(undefined);
      } else if (result.kind === "signedOut") onSignedOut(result.problem);
      else setProblem(`The project's unit system could not be loaded: ${result.problem}`);
    });
    return () => {
      current = false;
    };
  }, [signedIn, onSignedOut]);

  /** Chooses another system; shown at once, and put back if the API refuses it. */
  const changeUnitSystem = useCallback(
    async (next: string) => {
      const before = unitSystem;
      setUnitSystem(next);
      setSaving(true);
      const result = await setProjectUnitSystem(next);
      setSaving(false);
      if (result.kind === "ok") {
        setProblem(undefined);
        return;
      }
      setUnitSystem(before);
      if (result.kind === "signedOut") onSignedOut(result.problem);
      else setProblem(`The unit system was not changed: ${result.problem}`);
    },
    [unitSystem, onSignedOut],
  );

  return { unitSystem, changeUnitSystem, saving, problem };
}
