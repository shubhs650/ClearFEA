// SPDX-License-Identifier: AGPL-3.0-or-later
// The admin dashboard (M13.2 to M13.4, ADR-113, ADR-127 to ADR-129), drawn over the workbench like the
// wallet page: the Overview of the solver host, its lanes and queues, with pause and resume; every
// user's Jobs and runs with their statistics, logs, cancel and re-queue; the Users and who may sign
// in; the Events log (M13.1); every Setting with the machine sizes and solver machines or host; and
// each month's Costs; and the Export of every table as CSV or Excel (M13.4). Only the admin
// (ADMIN_EMAIL) sees it.

import { useState } from "react";
import { CostsTab } from "./CostsTab";
import { EventsTab } from "./EventsTab";
import { ExportTab } from "./ExportTab";
import { JobsTab } from "./JobsTab";
import { OverviewTab } from "./OverviewTab";
import { SettingsTab } from "./SettingsTab";
import { UsersTab } from "./UsersTab";

type Tab = "overview" | "jobs" | "users" | "events" | "settings" | "costs" | "export";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "jobs", label: "Jobs and runs" },
  { id: "users", label: "Users" },
  { id: "events", label: "Events" },
  { id: "settings", label: "Settings" },
  { id: "costs", label: "Costs" },
  { id: "export", label: "Export" },
];

export function AdminPage({ onClose, onSignedOut }: { onClose: () => void; onSignedOut: (notice?: string) => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <section className="pane wallet-page admin-page" aria-label="Admin">
      <header className="wallet-header">
        <h2 className="wallet-title">Admin</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="admin-tabs" role="tablist" aria-label="Dashboard">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`admin-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="admin-panel"
            className="admin-tab"
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="admin-panel" id="admin-panel" role="tabpanel" aria-labelledby={`admin-tab-${tab}`}>
        {tab === "overview" && <OverviewTab onSignedOut={onSignedOut} />}
        {tab === "jobs" && <JobsTab onSignedOut={onSignedOut} />}
        {tab === "users" && <UsersTab onSignedOut={onSignedOut} />}
        {tab === "events" && <EventsTab onSignedOut={onSignedOut} />}
        {tab === "settings" && <SettingsTab onSignedOut={onSignedOut} />}
        {tab === "costs" && <CostsTab onSignedOut={onSignedOut} />}
        {tab === "export" && <ExportTab onSignedOut={onSignedOut} />}
      </div>
    </section>
  );
}
