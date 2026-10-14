// SPDX-License-Identifier: AGPL-3.0-or-later
import { SettingsPanel } from "./layout/SettingsPanel";
import { SimulationTree } from "./layout/SimulationTree";
import { StatusBar } from "./layout/StatusBar";
import { Viewer } from "./layout/Viewer";

/** Layout shell: tree on the left, viewer in the centre, settings on the right, status bar along the bottom. */
export function App() {
  return (
    <div className="shell">
      <SimulationTree />
      <Viewer />
      <SettingsPanel />
      <StatusBar />
    </div>
  );
}
