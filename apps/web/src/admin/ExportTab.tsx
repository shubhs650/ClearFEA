// SPDX-License-Identifier: AGPL-3.0-or-later
// The dashboard's Export (M13.4, ADR-113, ADR-129): every table of the dashboard as CSV or Excel
// (.xlsx) for a range of days, or all of them as the sheets of one workbook. The API writes the
// files (GET /api/admin/export/...); the invited addresses and the settings are as of now.

import { useState } from "react";
import { downloadExport, type ExportFormat } from "../api/admin";
import { saveBlob } from "../saveBlob";

interface ExportTable {
  id: string;
  label: string;
  holds: string;
}

const TABLES: ExportTable[] = [
  { id: "jobs", label: "Jobs", holds: "Every user's jobs created in the range: state, tries, failure, memory and billed time." },
  { id: "tries", label: "Tries", holds: "Each try of a job claimed in the range: queue wait, stage times, model size, solver and what it used." },
  { id: "events", label: "Events", holds: "The event log in the range: sign-ins, failures, retries, host events and admin actions." },
  { id: "host-load", label: "Host load", holds: "The solver host's CPU, memory and disk at each check-in in the range." },
  { id: "users", label: "Users", holds: "Every user, with their jobs, failed jobs and machine time of the jobs that finished in the range." },
  { id: "invited", label: "Invited", holds: "The addresses that may sign in, as now." },
  { id: "settings", label: "Settings", holds: "Every setting as now, in its unit and as stored." },
  { id: "costs-by-user", label: "Costs by user", holds: "Jobs, runs, machine time and charges of the range, by user." },
  { id: "costs-by-type", label: "Costs by job type", holds: "Jobs, machine time and charges of the range, by job type." },
];

const FORMAT_NAMES: Record<ExportFormat, string> = { csv: "CSV", xlsx: "Excel" };

/** Today and the first of this month (UTC), as `YYYY-MM-DD`. */
function thisMonth(now = new Date()): { from: string; to: string } {
  const today = now.toISOString().slice(0, 10);
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

export function ExportTab({ onSignedOut }: { onSignedOut: (notice?: string) => void }) {
  const [range, setRange] = useState(thisMonth);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | undefined>();
  const [saved, setSaved] = useState<string | undefined>();

  async function download(table: string, format: ExportFormat) {
    const key = `${table}.${format}`;
    setBusy(key);
    setProblem(undefined);
    setSaved(undefined);
    const result = await downloadExport(table, format, range);
    setBusy(null);
    if (result.kind === "signedOut") onSignedOut(result.problem);
    else if (result.kind === "error") setProblem(result.problem);
    else {
      saveBlob(result.value.blob, result.value.name);
      setSaved(result.value.name);
    }
  }

  const button = (table: string, format: ExportFormat, label: string) => (
    <button
      type="button"
      aria-label={`${FORMAT_NAMES[format]} of ${label}`}
      disabled={busy !== null}
      onClick={() => void download(table, format)}
    >
      {busy === `${table}.${format}` ? "Preparing…" : FORMAT_NAMES[format]}
    </button>
  );

  return (
    <div className="admin-export">
      <div className="admin-filters">
        <label className="field">
          <span>From (UTC)</span>
          <input
            type="date"
            value={range.from}
            max={range.to}
            onChange={(event) => setRange({ ...range, from: event.target.value })}
          />
        </label>
        <label className="field">
          <span>To (UTC)</span>
          <input
            type="date"
            value={range.to}
            min={range.from}
            onChange={(event) => setRange({ ...range, to: event.target.value })}
          />
        </label>
        <button type="button" disabled={busy !== null} onClick={() => void download("all", "xlsx")}>
          {busy === "all.xlsx" ? "Preparing…" : "Every table in one Excel workbook"}
        </button>
      </div>
      <p className="wallet-note">
        Both days are included. Times in the files are UTC; numbers keep their stored units (seconds, bytes), named in
        each heading. A table of more than 50,000 rows asks for a shorter range.
      </p>
      {problem && (
        <p className="form-problem" role="alert">
          {problem}
        </p>
      )}
      {saved && (
        <p className="wallet-note" role="status">
          Saved {saved}.
        </p>
      )}
      <section className="admin-card" aria-label="Tables">
        <table className="wallet-table admin-export-table" aria-label="Tables to export">
          <thead>
            <tr>
              <th>Table</th>
              <th>What it holds</th>
              <th>Download</th>
            </tr>
          </thead>
          <tbody>
            {TABLES.map((table) => (
              <tr key={table.id}>
                <td>{table.label}</td>
                <td>{table.holds}</td>
                <td className="admin-export-buttons">
                  {button(table.id, "csv", table.label)}
                  {button(table.id, "xlsx", table.label)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
