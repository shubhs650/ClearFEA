// SPDX-License-Identifier: AGPL-3.0-or-later
// The simulation tree (M1.5): geometry, the analysis type (M5.1), then its bodies (M4.1) and their bonds (M4.2), materials, supports
// and loads with their items, then the mesh (M1.6) with its local sizes (M2.8), the run (M1.8) and the report (M7.1).
// A steady-state thermal analysis has no supports, so their group is left out unless the setup still lists some to delete.
// Each row carries a complete / incomplete / error mark; selecting a row opens its settings.
// Since the UI redesign (ADR-094) each row has an icon for its kind of item.

import { type GeometryStatus, type GeometryView, isModal, isThermal, type SimulationSpec } from "@clearfea/spec";
import {
  Activity,
  Anchor,
  Box,
  Boxes,
  FileBox,
  FileText,
  Grid3x3,
  Layers,
  Link2,
  type LucideIcon,
  Palette,
  Play,
  Scan,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { bodyItem, type Group, type ItemStatus, type Mark } from "../setup/spec";
import type { Setup } from "../setup/useSimulation";
import { LOAD_ICONS, SUPPORT_ICONS } from "./Ribbon";

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
  icon: Icon,
}: {
  id: string;
  label: string;
  status: ItemStatus | undefined;
  selected: string;
  onSelect: (id: string) => void;
  depth?: number;
  icon: LucideIcon;
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
      <Icon className="tree-icon" size={15} strokeWidth={1.8} aria-hidden="true" />
      <span className="tree-label">{label}</span>
      <span className={`mark mark-${mark}`} aria-hidden="true" />
    </button>
  );
}

const groups: { group: Group; label: string; icon: LucideIcon }[] = [
  { group: "materials", label: "Materials", icon: Layers },
  { group: "supports", label: "Supports", icon: Anchor },
  { group: "loads", label: "Loads", icon: Zap },
];

/**
 * The groups the tree shows: supports not for a steady-state thermal analysis and loads not for
 * a modal one (M6.1), unless some are left to delete.
 */
function shownGroups(spec: SimulationSpec) {
  return groups.filter(
    ({ group }) =>
      (group !== "supports" || !isThermal(spec) || spec.supports.length > 0) &&
      (group !== "loads" || !isModal(spec) || spec.loads.length > 0),
  );
}

export function SimulationTree({
  geometry,
  setup,
  statuses,
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
  selected: string;
  onSelect: (id: string) => void;
  onStart: () => void;
  starting: boolean;
  startProblem?: string;
  /** Shown under the tree. */
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
      <h2 className="pane-title">Model tree</h2>
      <ul className="tree">
        <li>
          <Row id="geometry" label="Geometry" icon={FileBox} status={geometryStatus} selected={selected} onSelect={onSelect} />
        </li>
        {setup.kind === "open" && (
          <li>
            <Row id="analysis" label="Analysis" icon={Activity} status={statuses.get("analysis")} selected={selected} onSelect={onSelect} />
          </li>
        )}
        {setup.kind === "open" && (
          <li>
            <Row id="bodies" label="Bodies" icon={Boxes} status={statuses.get("bodies")} selected={selected} onSelect={onSelect} />
            <ul className="tree">
              {setup.spec.bodies.map((body) => (
                <li key={body.tag}>
                  <Row
                    id={bodyItem(body.tag)}
                    icon={Box}
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
            <Row id="bonds" label="Bonds" icon={Link2} status={statuses.get("bonds")} selected={selected} onSelect={onSelect} />
          </li>
        )}
        {setup.kind === "open" &&
          shownGroups(setup.spec).map(({ group, label, icon }) => {
            const items =
              group === "materials" ? setup.spec.materials : group === "supports" ? setup.spec.supports : setup.spec.loads;
            return (
              <li key={group}>
                <Row id={group} label={label} icon={icon} status={statuses.get(group)} selected={selected} onSelect={onSelect} />
                {items.length > 0 && (
                  <ul className="tree">
                    {items.map((item) => (
                      <li key={item.id}>
                        <Row
                          id={item.id}
                          icon={
                            group === "materials" || !("type" in item)
                              ? Palette
                              : group === "supports"
                                ? (SUPPORT_ICONS[item.type as keyof typeof SUPPORT_ICONS] ?? Anchor)
                                : (LOAD_ICONS[item.type as keyof typeof LOAD_ICONS] ?? Zap)
                          }
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
            <Row id="mesh" label="Mesh" icon={Grid3x3} status={statuses.get("mesh")} selected={selected} onSelect={onSelect} />
            {(setup.spec.mesh.local ?? []).length > 0 && (
              <ul className="tree">
                {(setup.spec.mesh.local ?? []).map((item) => (
                  <li key={item.id}>
                    <Row
                      id={item.id}
                      icon={Scan}
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
            <Row id="run" label="Run" icon={Play} status={statuses.get("run")} selected={selected} onSelect={onSelect} />
          </li>
        )}
        {setup.kind === "open" && (
          <li>
            <Row id="report" label="Report" icon={FileText} status={statuses.get("report")} selected={selected} onSelect={onSelect} />
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
      {units && <div className="tree-note tree-units">{units}</div>}
    </nav>
  );
}
