// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ReactNode } from "react";

export function SettingsPanel({ children }: { children?: ReactNode }) {
  return (
    <aside className="pane pane-settings" aria-label="Settings">
      <h2 className="pane-title">Settings</h2>
      <p className="pane-empty">Select an item in the tree to edit its settings.</p>
      {children}
    </aside>
  );
}
