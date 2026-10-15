// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ReactNode } from "react";

/** The settings of the item selected in the simulation tree. */
export function SettingsPanel({ children }: { children?: ReactNode }) {
  return (
    <aside className="pane pane-settings" aria-label="Settings">
      {children}
    </aside>
  );
}
