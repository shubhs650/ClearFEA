// SPDX-License-Identifier: AGPL-3.0-or-later
// The ribbon (UI redesign, ADR-094): the workflow's commands in tabs, Model, Setup, Mesh, Solve
// and Results, each in labelled groups of large buttons. It only calls what the tree and the
// settings panels already do (open an item, add a support or load, generate the mesh, start a
// run, pick the contour), so every command stays reachable there too. The tab follows the item
// open in the tree; a click on a tab shows another one.

import {
  type AnalysisType,
  analysisLoads,
  type IsotropicMaterial,
  type LocalMeshScope,
  loadKinds,
  supportKinds,
} from "@clearfea/spec";
import {
  Activity,
  ArrowDown,
  ArrowDownToLine,
  ArrowRightLeft,
  Box,
  Boxes,
  ChartColumn,
  CircleStop,
  Cpu,
  Droplets,
  FileText,
  FileUp,
  Flame,
  Grid3x3,
  Layers,
  Library,
  Link2,
  Lock,
  type LucideIcon,
  Move3d,
  MoveRight,
  Play,
  Radiation,
  RotateCw,
  SlidersHorizontal,
  Spline,
  Square,
  Sun,
  Thermometer,
  ThermometerSun,
  Waves,
  Weight,
  Wind,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import type { LoadType, SupportType } from "../setup/spec";

export type RibbonTab = "model" | "setup" | "mesh" | "solve" | "results";

const TABS: { id: RibbonTab; label: string }[] = [
  { id: "model", label: "Model" },
  { id: "setup", label: "Setup" },
  { id: "mesh", label: "Mesh" },
  { id: "solve", label: "Solve" },
  { id: "results", label: "Results" },
];

export const SUPPORT_ICONS: Record<SupportType, LucideIcon> = {
  fixed: Lock,
  displacement: MoveRight,
  frictionless: ArrowRightLeft,
  elastic: Waves,
};

export const LOAD_ICONS: Record<LoadType, LucideIcon> = {
  pressure: ArrowDownToLine,
  force: ArrowDown,
  remote: Move3d,
  hydrostatic: Droplets,
  gravity: Weight,
  centrifugal: RotateCw,
  temperature: Thermometer,
  fixed_temperature: ThermometerSun,
  heat_flux: Sun,
  convection: Wind,
  radiation: Radiation,
  heat_generation: Flame,
};

/** Short ribbon labels; the full kind names are the buttons' tooltips. */
const SUPPORT_LABELS: Record<SupportType, string> = {
  fixed: "Fixed",
  displacement: "Displacement",
  frictionless: "Frictionless",
  elastic: "Elastic",
};

const LOAD_LABELS: Record<LoadType, string> = {
  pressure: "Pressure",
  force: "Force",
  remote: "Remote",
  hydrostatic: "Hydrostatic",
  gravity: "Gravity",
  centrifugal: "Centrifugal",
  temperature: "Temperature change",
  fixed_temperature: "Fixed temperature",
  heat_flux: "Heat flux",
  convection: "Convection",
  radiation: "Radiation",
  heat_generation: "Heat generation",
};

const THERMAL_LOADS: readonly LoadType[] = ["fixed_temperature", "heat_flux", "convection", "radiation", "heat_generation"];

/** The tab that belongs to a tree item. */
export function tabOf(item: string, hasResults: boolean): RibbonTab {
  if (["geometry", "analysis", "bodies", "bonds"].includes(item) || item.startsWith("body:")) return "model";
  if (item === "mesh" || item.startsWith("local")) return "mesh";
  if (item === "run") return hasResults ? "results" : "solve";
  if (item === "report") return "results";
  return "setup";
}

function Command({
  icon: Icon,
  label,
  title,
  onClick,
  disabled = false,
  active = false,
  primary = false,
}: {
  icon: LucideIcon;
  label: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      className={`ribbon-command${primary ? " ribbon-primary" : ""}`}
      aria-current={active ? "true" : undefined}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={22} strokeWidth={1.6} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="ribbon-group" aria-label={`${label} commands`}>
      <div className="ribbon-group-body">{children}</div>
      <div className="ribbon-group-label" aria-hidden="true">
        {label}
      </div>
    </fieldset>
  );
}

export type RibbonProps = {
  /** The tree item open now: it picks the tab and marks the command that opened it. */
  selected: string;
  /** Whether the setup has started, so its commands can work. */
  open: boolean;
  analysis: AnalysisType | null;
  multiBody: boolean;
  hasResults: boolean;
  onOpen: (item: string) => void;
  onAddMaterial: (material?: IsotropicMaterial) => void;
  onAddSupport: (type: SupportType) => void;
  onAddLoad: (type: LoadType) => void;
  onAddLocal: (scope: LocalMeshScope) => void;
  /** Generates the mesh, or null when it cannot be generated now (with the reason). */
  generate: { run: () => void; disabled: string | null };
  /** Starts a run with the default machine and stop limit, or null when it cannot start now. */
  solve: { run: () => void; disabled: string | null };
  /** Cancels the running job, or null when none is running. */
  cancel: (() => void) | null;
  /** The contour and shape controls of the run shown, when it has results. */
  results?: ReactNode;
};

export function Ribbon(props: RibbonProps) {
  const { selected, open, analysis, multiBody, hasResults, onOpen } = props;
  const context = tabOf(selected, hasResults);
  const [tab, setTab] = useState<RibbonTab>(context);
  // Opening another item in the tree brings its tab forward.
  useEffect(() => setTab(context), [context]);
  const offered = analysis === null ? [] : analysisLoads[analysis];
  const structural = offered.filter((type) => !THERMAL_LOADS.includes(type));
  const thermal = offered.filter((type) => THERMAL_LOADS.includes(type));
  const supports = analysis !== null && analysis !== "steady_thermal";
  const needsSetup = open ? undefined : "Start the setup first.";
  return (
    <div className="ribbon" role="toolbar" aria-label="Ribbon">
      <div className="ribbon-tabs" role="tablist" aria-label="Ribbon tabs">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`ribbon-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="ribbon-panel"
            className="ribbon-tab"
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="ribbon-panel" id="ribbon-panel" role="tabpanel" aria-labelledby={`ribbon-tab-${tab}`}>
        {tab === "model" && (
          <>
            <Group label="Geometry">
              <Command
                icon={FileUp}
                label="Import STEP"
                title="Upload a STEP file and confirm its length unit"
                active={selected === "geometry"}
                onClick={() => onOpen("geometry")}
              />
            </Group>
            <Group label="Analysis">
              <Command
                icon={Activity}
                label="Analysis type"
                title={needsSetup ?? "Linear static, steady-state thermal, thermal stress or modal"}
                disabled={!open}
                active={selected === "analysis"}
                onClick={() => onOpen("analysis")}
              />
            </Group>
            <Group label="Assembly">
              <Command
                icon={Box}
                label="Body list"
                title={needsSetup ?? "Each body's material and whether it is solved"}
                disabled={!open}
                active={selected === "bodies"}
                onClick={() => onOpen("bodies")}
              />
              <Command
                icon={Link2}
                label="Bonds"
                title={needsSetup ?? (multiBody ? "Where the bodies touch and are tied" : "Bonds join two or more bodies")}
                disabled={!open || !multiBody}
                active={selected === "bonds"}
                onClick={() => onOpen("bonds")}
              />
            </Group>
          </>
        )}
        {tab === "setup" && (
          <>
            <Group label="Materials">
              <Command
                icon={Layers}
                label="New material"
                title={needsSetup ?? "Add an empty material to fill in"}
                disabled={!open}
                onClick={() => props.onAddMaterial()}
              />
              <Command
                icon={Library}
                label="Library"
                title={needsSetup ?? "Pick a material from the library or your saved materials"}
                disabled={!open}
                active={selected === "materials"}
                onClick={() => onOpen("materials")}
              />
            </Group>
            {supports && (
              <Group label="Supports">
                {(Object.keys(supportKinds) as SupportType[]).map((type) => (
                  <Command
                    key={type}
                    icon={SUPPORT_ICONS[type]}
                    label={SUPPORT_LABELS[type]}
                    title={`${supportKinds[type]} on the faces selected in the viewer`}
                    disabled={!open}
                    onClick={() => props.onAddSupport(type)}
                  />
                ))}
              </Group>
            )}
            {structural.length > 0 && (
              <Group label="Loads">
                {structural.map((type) => (
                  <Command
                    key={type}
                    icon={LOAD_ICONS[type]}
                    label={LOAD_LABELS[type]}
                    title={`${loadKinds[type]}${type === "gravity" || type === "centrifugal" || type === "temperature" ? " on every body" : " on the faces selected in the viewer"}`}
                    disabled={!open}
                    onClick={() => props.onAddLoad(type)}
                  />
                ))}
              </Group>
            )}
            {thermal.length > 0 && (
              <Group label="Thermal">
                {thermal.map((type) => (
                  <Command
                    key={type}
                    icon={LOAD_ICONS[type]}
                    label={LOAD_LABELS[type]}
                    title={`${loadKinds[type]}${type === "heat_generation" ? " in the bodies you tick" : " on the faces selected in the viewer"}`}
                    disabled={!open}
                    onClick={() => props.onAddLoad(type)}
                  />
                ))}
              </Group>
            )}
            {!open && <p className="ribbon-note">Upload a STEP file and start the setup to add materials, supports and loads.</p>}
            {open && analysis === "modal" && (
              <p className="ribbon-note">A modal analysis takes no loads: it finds the natural frequencies as held.</p>
            )}
          </>
        )}
        {tab === "mesh" && (
          <>
            <Group label="Mesh">
              <Command
                icon={SlidersHorizontal}
                label="Settings"
                title={needsSetup ?? "Element size, order and quality"}
                disabled={!open}
                active={selected === "mesh"}
                onClick={() => onOpen("mesh")}
              />
              <Command
                icon={Grid3x3}
                label="Generate"
                title={props.generate.disabled ?? "Make the mesh with the settings as they are"}
                disabled={props.generate.disabled !== null}
                primary
                onClick={props.generate.run}
              />
            </Group>
            <Group label="Local sizes">
              <Command
                icon={Square}
                label="On faces"
                title={needsSetup ?? "A finer size on the faces selected in the viewer"}
                disabled={!open}
                onClick={() => props.onAddLocal("faces")}
              />
              <Command
                icon={Spline}
                label="On edges"
                title={needsSetup ?? "A finer size on edges you pick in the viewer"}
                disabled={!open}
                onClick={() => props.onAddLocal("edges")}
              />
              <Command
                icon={Boxes}
                label="On bodies"
                title={needsSetup ?? "Another size for whole bodies"}
                disabled={!open}
                onClick={() => props.onAddLocal("bodies")}
              />
            </Group>
          </>
        )}
        {tab === "solve" && (
          <>
            <Group label="Solver">
              <Command
                icon={Cpu}
                label="Solver and estimate"
                title={needsSetup ?? "Equation solver, machine size, estimate and stop limit"}
                disabled={!open}
                active={selected === "run"}
                onClick={() => onOpen("run")}
              />
            </Group>
            <Group label="Job">
              <Command
                icon={Play}
                label="Solve"
                title={props.solve.disabled ?? "Solve on the recommended machine size with the stop limit at 3 × the estimate"}
                disabled={props.solve.disabled !== null}
                primary
                onClick={props.solve.run}
              />
              <Command
                icon={CircleStop}
                label="Stop"
                title={props.cancel === null ? "Nothing is solving" : "Cancel the job that is solving"}
                disabled={props.cancel === null}
                onClick={() => props.cancel?.()}
              />
            </Group>
          </>
        )}
        {tab === "results" && (
          <>
            <Group label="Results">
              <Command
                icon={ChartColumn}
                label="Result details"
                title={hasResults ? "Largest values, reactions, export and the run record" : "Solve the simulation to see results"}
                disabled={!open}
                active={selected === "run"}
                onClick={() => onOpen("run")}
              />
            </Group>
            {hasResults && props.results && <Group label="Contour">{props.results}</Group>}
            <Group label="Report">
              <Command
                icon={FileText}
                label="Report"
                title={needsSetup ?? "Make the Word and PDF report"}
                disabled={!open}
                active={selected === "report"}
                onClick={() => onOpen("report")}
              />
            </Group>
            {!hasResults && open && <p className="ribbon-note">Solve the simulation to see its results here.</p>}
          </>
        )}
      </div>
    </div>
  );
}
