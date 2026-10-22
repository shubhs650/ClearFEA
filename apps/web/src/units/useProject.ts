// SPDX-License-Identifier: AGPL-3.0-or-later
// The open project and its unit system (M2.1, ADR-038; one of many since M14.3, ADR-114). Until
// the project has loaded, or if it cannot be loaded, the table's default system is used, so the
// app never waits on it. A system chosen before the project has loaded wins over the loaded one.
// Opening the project records it for Recent on the home page.

import { type ProjectView, unitsTable } from "@clearfea/spec";
import { useCallback, useEffect, useRef, useState } from "react";
import { changeProject, fetchProject, markProjectOpened } from "../api/projects";

/** Whether the project could be opened: loading, open, or not one to work in. */
export type ProjectState =
  | { kind: "loading" }
  | { kind: "open"; project: ProjectView }
  | { kind: "unavailable"; problem: string };

export function useProject(projectId: string, signedIn: boolean, onSignedOut: (problem: string) => void) {
  const [state, setState] = useState<ProjectState>({ kind: "loading" });
  const [unitSystem, setUnitSystem] = useState(unitsTable.defaultSystem);
  const [problem, setProblem] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  // Set once the user chooses a system, so a project that loads later does not undo the choice
  // or clear the reason it was refused.
  const chosen = useRef(false);

  useEffect(() => {
    if (!signedIn) return;
    let current = true;
    fetchProject(projectId).then((result) => {
      if (!current) return;
      if (result.kind === "signedOut") {
        onSignedOut(result.problem);
        return;
      }
      if (result.kind === "error") {
        setState({ kind: "unavailable", problem: result.problem });
        return;
      }
      const project = result.value;
      if (project.deletedAt !== null) {
        setState({
          kind: "unavailable",
          problem: `The project ${project.name} is in the trash. Restore it from the trash on your home page to work in it.`,
        });
        return;
      }
      setState({ kind: "open", project });
      if (!chosen.current) {
        setUnitSystem(project.unitSystem);
        setProblem(undefined);
      }
      void markProjectOpened(projectId);
    });
    return () => {
      current = false;
    };
  }, [projectId, signedIn, onSignedOut]);

  /** Chooses another system; shown at once, and put back if the API refuses it. */
  const changeUnitSystem = useCallback(
    async (next: string) => {
      chosen.current = true;
      const before = unitSystem;
      setUnitSystem(next);
      setSaving(true);
      const result = await changeProject(projectId, { unitSystem: next });
      setSaving(false);
      if (result.kind === "ok") {
        setProblem(undefined);
        return;
      }
      setUnitSystem(before);
      if (result.kind === "signedOut") onSignedOut(result.problem);
      else setProblem(`The unit system was not changed: ${result.problem}`);
    },
    [projectId, unitSystem, onSignedOut],
  );

  /** Takes a newer view of the project, for example once its thumbnail is stored. */
  const replace = useCallback((project: ProjectView) => setState({ kind: "open", project }), []);

  return { state, unitSystem, changeUnitSystem, saving, problem, replace };
}
