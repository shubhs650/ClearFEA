// SPDX-License-Identifier: AGPL-3.0-or-later
// The bar across the top of the workbench (UI redesign, ADR-094): the ClearFEA mark, the open
// geometry's file and whether the setup is saved, the project's unit system and the light or
// dark theme.

import type { GeometryView } from "@clearfea/spec";
import { CircleAlert, CircleCheck, FileBox, LoaderCircle, Moon, PanelLeft, PanelRight, Sun } from "lucide-react";
import type { ReactNode } from "react";
import type { SaveState, Setup } from "../setup/useSimulation";
import type { Theme } from "./theme";

/** The ClearFEA mark: a tetrahedral element, the solver's building block. */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo-mark">
      <defs>
        <linearGradient id="logo-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#logo-fill)" />
      <path d="M16 6 L26 23 L6 23 Z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
      <path d="M16 6 L18.5 17.5 L26 23 M18.5 17.5 L6 23" fill="none" stroke="#fff" strokeOpacity="0.7" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
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

export function AppHeader({
  geometry,
  setup,
  save,
  units,
  theme,
  onTheme,
  treeShown,
  settingsShown,
  onToggleTree,
  onToggleSettings,
}: {
  geometry: GeometryView | null;
  setup: Setup;
  save: SaveState;
  /** The project's unit system choice. */
  units: ReactNode;
  theme: Theme;
  onTheme: (next: Theme) => void;
  treeShown: boolean;
  settingsShown: boolean;
  onToggleTree: () => void;
  onToggleSettings: () => void;
}) {
  const problem = save.kind === "invalid" || save.kind === "failed";
  const SaveIcon = save.kind === "saving" ? LoaderCircle : problem ? CircleAlert : CircleCheck;
  return (
    <header className="app-header">
      <div className="app-brand">
        <Logo />
        <span className="app-name">
          Clear<strong>FEA</strong>
        </span>
      </div>
      <button
        type="button"
        className="header-icon"
        aria-pressed={treeShown}
        title={treeShown ? "Hide the model tree" : "Show the model tree"}
        aria-label="Model tree panel"
        onClick={onToggleTree}
      >
        <PanelLeft size={17} aria-hidden="true" />
      </button>
      <div className="app-document">
        {geometry !== null && (
          <span className="app-file" title={geometry.name}>
            <FileBox size={15} aria-hidden="true" />
            {geometry.name}
          </span>
        )}
        {setup.kind === "open" && (
          <span
            className={`app-save app-save-${save.kind}`}
            role={problem ? "alert" : "status"}
            title={saveText(save)}
          >
            <SaveIcon size={14} aria-hidden="true" className={save.kind === "saving" ? "spin" : undefined} />
            {saveText(save)}
          </span>
        )}
      </div>
      <div className="app-header-tools">
        <div className="app-units">{units}</div>
        <button
          type="button"
          className="header-icon"
          title={theme === "dark" ? "Use the light theme" : "Use the dark theme"}
          aria-label={theme === "dark" ? "Light theme" : "Dark theme"}
          onClick={() => onTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="header-icon"
          aria-pressed={settingsShown}
          title={settingsShown ? "Hide the settings" : "Show the settings"}
          aria-label="Settings panel"
          onClick={onToggleSettings}
        >
          <PanelRight size={17} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
