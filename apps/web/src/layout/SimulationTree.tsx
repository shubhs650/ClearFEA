// SPDX-License-Identifier: AGPL-3.0-or-later
// The simulation tree (M1.5): geometry, then its bodies (M4.1) and their bonds (M4.2), materials, supports and loads with their items,
// then the mesh (M1.6) with its local sizes (M2.8) and the run (M1.8).
// Each row carries a complete / incomplete / error mark; selecting a row opens its settings.

import type { GeometryStatus, GeometryView } from "@clearfea/spec";
import type { ReactNode } from "react";
import { bodyItem, type Group, type ItemStatus, type Mark } from "../setup/spec";
import type { SaveState, Setup } from "../setup/useSimulation";

const markLabels: Record<Mark, string> = {
  complete: "complete",
  incomplete: "incomplete",
  error: "has a problem",
};

const geometryMarks: Record<GeometryStatus, Mark> = {
  importing: "incomplete",
  needs_unit: "incomplete",
  unconfirmed: "incomplete",
  ready: "complete",
  failed: "error",
};

function Row({
  id,
  label,
  status,
  selected,
  onSelect,
  depth = 0,
}: {
  id: string;
  label: string;
  status: ItemStatus | undefined;
  selected: string;
  onSelect: (id: string) => void;
  depth?: number;
}) {
  const mark = status?.mark ?? "incomplete";
  return (
    <button
      type="button"
      className={`tree-row tree-depth-${depth}`}
      aria-current={selected === id ? "true" : undefined}
      aria-label={`${label}, ${markLabels[mark]}`}
      title={status?.notes.join(" ")}
      onClick={() => onSelect(id)}
    >
      <span className={`mark mark-${mark}`} aria-hidden="true" />
      <span className="tree-label">{label}</span>
    </button>
  );
}

function saveText(save: SaveState): string {
  switch (save.kind) {
    case "saved":
      return "All changes saved.";
    case "saving":
      return "Saving…";
    case "invalid":
      return `Not saved: ${save.problems.join(" ")}`;
    case "failed":
      return `Not saved: ${save.problem}`;
  }
}

const groups: { group: Group; label: string }[] = [
  { group: "materials", label: "Materials" },
  { group: "supports", label: "Supports" },
  { group: "loads", label: "Loads" },
];

export function SimulationTree({
  geometry,
  setup,
  statuses,
  save,
  selected,
  onSelect,
  onStart,
  starting,
  startProblem,
  units,
  bodyLabels,
}: {
  geometry: GeometryView | null;
  setup: Setup;
  statuses: ReadonlyMap<string, ItemStatus>;
  save: SaveState;
  selected: string;
  onSelect: (id: string) => void;
  onStart: () => void;
  starting: boolean;
  startProblem?: string;
  /** The project's unit system choice, shown under the tree. */
  units?: ReactNode;
  /** What each body is called (M4.1): its part name, or "Body <tag>". */
  bodyLabels?: ReadonlyMap<number, string>;
}) {
  const geometryStatus: ItemStatus = {
    mark: geometry === null ? "incomplete" : geometryMarks[geometry.status],
    notes: geometry === null ? ["Upload a STEP file."] : [],
  };
  return (
    <nav className="pane pane-tree" aria-label="Simulation tree">
      <h2 className="pane-title">Simulation</h2>
      <ul className="tree">
        <li>
          <Row id="geometry" label="Geometry" status={geometryStatus} selected={selected} onSelect={onSelect} />
        </li>
        {setup.kind === "open" && (
          <li>
            <Row id="bodies" label="Bodies" status={statuses.get("bodies")} selected={selected} onSelect={onSelect} />
            <ul className="tree">
              {setup.spec.bodies.map((body) => (
                <li key={body.tag}>
                  <Row
                    id={bodyItem(body.tag)}
                    label={bodyLabels?.get(body.tag) ?? `Body ${body.tag}`}
                    status={statuses.get(bodyItem(body.tag))}
                    selected={selected}
                    onSelect={onSelect}
                    depth={1}
                  />
                </li>
              ))}
            </ul>
          </li>
        )}
        {setup.kind === "open" && setup.spec.bodies.length > 1 && (
          <li>
            <Row id="bonds" label="Bonds" status={statuses.get("bonds")} selected={selected} onSelect={onSelect} />
          </li>
        )}
        {setup.kind === "open" &&
          groups.map(({ group, label }) => {
            const items =
              group === "materials" ? setup.spec.materials : group === "supports" ? setup.spec.supports : setup.spec.loads;
            return (
              <li key={group}>
                <Row id={group} label={label} status={statuses.get(group)} selected={selected} onSelect={onSelect} />
                {items.length > 0 && (
                  <ul className="tree">
                    {items.map((item) => (
                      <li key={item.id}>
                        <Row
                          id={item.id}
                          label={item.name}
                          status={statuses.get(item.id)}
                          selected={selected}
                          onSelect={onSelect}
                          depth={1}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        {setup.kind === "open" && (
          <li>
            <Row id="mesh" label="Mesh" status={statuses.get("mesh")} selected={selected} onSelect={onSelect} />
            {(setup.spec.mesh.local ?? []).length > 0 && (
              <ul className="tree">
                {(setup.spec.mesh.local ?? []).map((item) => (
                  <li key={item.id}>
                    <Row
                      id={item.id}
                      label={item.name}
                      status={statuses.get(item.id)}
                      selected={selected}
                      onSelect={onSelect}
                      depth={1}
                    />
                  </li>
                ))}
              </ul>
            )}
          </li>
        )}
        {setup.kind === "open" && (
          <li>
            <Row id="run" label="Run" status={statuses.get("run")} selected={selected} onSelect={onSelect} />
          </li>
        )}
      </ul>
      {setup.kind === "none" && geometry !== null && geometry.status !== "failed" && (
        <p className="pane-empty tree-note">Confirm the geometry's length unit to start the setup.</p>
      )}
      {setup.kind === "loading" && <p className="pane-empty tree-note">Loading the setup…</p>}
      {setup.kind === "failed" && (
        <p className="form-problem tree-note" role="alert">
          {setup.problem}
        </p>
      )}
      {setup.kind === "absent" && (
        <div className="tree-note">
          <button type="button" onClick={onStart} disabled={starting}>
            Start setup
          </button>
          <p className="field-hint">The geometry's length unit is locked once the setup starts.</p>
          {startProblem && (
            <p className="form-problem" role="alert">
              {startProblem}
            </p>
          )}
        </div>
      )}
      {setup.kind === "open" && (
        <p
          className={`tree-note tree-save ${save.kind === "invalid" || save.kind === "failed" ? "form-problem" : "field-hint"}`}
          role={save.kind === "invalid" || save.kind === "failed" ? "alert" : "status"}
        >
          {saveText(save)}
        </p>
      )}
      {units && <div className="tree-note tree-units">{units}</div>}
    </nav>
  );
}
