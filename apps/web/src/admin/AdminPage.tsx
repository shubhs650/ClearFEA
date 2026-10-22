// SPDX-License-Identifier: AGPL-3.0-or-later
// The admin dashboard (M13.2, ADR-113, ADR-127), drawn over the workbench like the wallet page:
// the Overview of the solver host, its lanes and queues, with pause and resume; every user's Jobs
// and runs with their statistics, logs, cancel and re-queue; the Events log (M13.1); and Access and
// machines (M10.3, ADR-097): who may sign in with Google, and who has, which cloud machine sizes
// are switched on (M10.6, ADR-099), and the solver machines with their monthly hours cap (M10.7,
// ADR-100), or, with MACHINES=vps, the solver host (M12.4, ADR-120), until M13.3 splits it into
// Users and Settings. Only the admin (ADMIN_EMAIL) sees it.

import type { AdminResponse, MachineStart, SolverHost, SolverMachines } from "@clearfea/spec";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { addAllowed, fetchAdmin, removeAllowed, setMachineHoursCap, switchCloudSize } from "../api/admin";
import type { ApiResult } from "../api/request";
import { EventsTab } from "./EventsTab";
import { hours, utc } from "./format";
import { JobsTab } from "./JobsTab";
import { OverviewTab } from "./OverviewTab";

type AdminState = { kind: "loading" } | { kind: "loaded"; admin: AdminResponse } | { kind: "problem"; problem: string };

type Tab = "overview" | "jobs" | "events" | "access";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "jobs", label: "Jobs and runs" },
  { id: "events", label: "Events" },
  { id: "access", label: "Access and machines" },
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
        {tab === "events" && <EventsTab onSignedOut={onSignedOut} />}
        {tab === "access" && <AccessAndMachines onSignedOut={onSignedOut} />}
      </div>
    </section>
  );
}

function AccessAndMachines({ onSignedOut }: { onSignedOut: (notice?: string) => void }) {
  const [state, setState] = useState<AdminState>({ kind: "loading" });
  const [email, setEmail] = useState("");
  const [problem, setProblem] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [cap, setCap] = useState("");

  /** Shows the API's answer; a refused change keeps the page and says why. */
  const show = useCallback(
    (result: ApiResult<AdminResponse>, change: boolean): boolean => {
      if (result.kind === "signedOut") onSignedOut(result.problem);
      else if (result.kind === "error") {
        if (change) setProblem(result.problem);
        else setState({ kind: "problem", problem: result.problem });
      } else {
        setState({ kind: "loaded", admin: result.value });
        setProblem(undefined);
        return true;
      }
      return false;
    },
    [onSignedOut],
  );

  useEffect(() => {
    fetchAdmin().then((result) => show(result, false));
  }, [show]);

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    if (show(await addAllowed(email.trim()), true)) setEmail("");
    setBusy(false);
  }

  async function remove(address: string) {
    setBusy(true);
    show(await removeAllowed(address), true);
    setBusy(false);
  }

  async function saveCap(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    if (show(await setMachineHoursCap(Number(cap.trim())), true)) setCap("");
    setBusy(false);
  }

  async function switchSize(name: string, enabled: boolean) {
    setBusy(true);
    show(await switchCloudSize(name, enabled), true);
    setBusy(false);
  }

  return (
    <>
      {state.kind === "loading" && <p className="pane-empty">Loading…</p>}
      {state.kind === "problem" && (
        <p className="form-problem" role="alert">
          {state.problem}
        </p>
      )}
      {state.kind === "loaded" && (
        <div className="admin-columns">
          <section className="admin-card" aria-label="Allowed addresses">
            <h3 className="wallet-subtitle">Allowed addresses</h3>
            <p className="wallet-note">
              These Google accounts can sign in. Add each one also as a test user on the Google consent screen
              (docs/DEPLOYMENT.md section 2.2). Removing an address signs its owner out at once; their projects
              stay.
            </p>
            <form className="admin-add" onSubmit={add}>
              <label className="field">
                <span>Email address</span>
                <input
                  name="email"
                  type="email"
                  placeholder="colleague@gmail.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </label>
              <button type="submit" disabled={busy}>
                Add
              </button>
            </form>
            {problem && (
              <p className="form-problem" role="alert">
                {problem}
              </p>
            )}
            <ul className="admin-allowed">
              <li>
                <span className="admin-email">{state.admin.adminEmail}</span>
                <span className="admin-tag">Admin, always allowed</span>
              </li>
              {state.admin.allowed.map((entry) => (
                <li key={entry.email}>
                  <span className="admin-email">{entry.email}</span>
                  <span className="admin-when">added {utc(entry.addedAt)} UTC</span>
                  <button
                    type="button"
                    className="link-button"
                    disabled={busy}
                    aria-label={`Remove ${entry.email}`}
                    onClick={() => remove(entry.email)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            {state.admin.allowed.length === 0 && <p className="pane-empty">Nobody else is invited yet.</p>}
          </section>
          <section className="admin-card" aria-label="Users">
            <h3 className="wallet-subtitle">Users</h3>
            <table className="wallet-table" aria-label="Users">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>First signed in (UTC)</th>
                  <th>Last signed in (UTC)</th>
                  <th className="wallet-number">Machine time this month</th>
                  <th>Can sign in</th>
                </tr>
              </thead>
              <tbody>
                {state.admin.users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.name}</td>
                    <td>{user.email ?? "none (local test user)"}</td>
                    <td>{utc(user.createdAt)}</td>
                    <td>{user.lastSignIn === null ? "" : utc(user.lastSignIn)}</td>
                    <td className="wallet-number">{hours(user.machineSecondsThisMonth)}</td>
                    <td>{user.allowed ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="admin-card" aria-label="Machine sizes">
            <h3 className="wallet-subtitle">Machine sizes</h3>
            <p className="wallet-note">
              {SIZE_NOTES[state.admin.machines]}
            </p>
            <ul className="admin-allowed">
              {state.admin.cloudSizes.map((size) => (
                <li key={size.name}>
                  <label className="admin-size">
                    <input
                      type="checkbox"
                      checked={size.enabled}
                      disabled={busy || size.default}
                      onChange={(event) => switchSize(size.name, event.target.checked)}
                    />
                    <span className="admin-email">{size.name}</span>
                  </label>
                  <span className="admin-when">
                    {size.cores} vCPU, {Math.round(size.memoryBytes / 2 ** 30)} GB
                  </span>
                  {size.default && <span className="admin-tag">Default, always on</span>}
                </li>
              ))}
            </ul>
          </section>
          {state.admin.machines === "vps" ? (
            <SolverHostCard host={state.admin.solverHost} />
          ) : (
          <section className="admin-card" aria-label="Solver machines">
            <h3 className="wallet-subtitle">Solver machines</h3>
            <p className="wallet-note">{launcherNote(state.admin.solverMachines)}</p>
            <p className="admin-hours">
              <strong>{state.admin.solverMachines.hoursThisMonth.toFixed(1)} h</strong> of{" "}
              {state.admin.solverMachines.hoursCap} h used this month (UTC)
            </p>
            <form className="admin-add" onSubmit={saveCap}>
              <label className="field">
                <span>Monthly limit in hours</span>
                <input
                  name="hours"
                  type="number"
                  min={0}
                  max={744}
                  step={1}
                  placeholder={String(state.admin.solverMachines.hoursCap)}
                  value={cap}
                  onChange={(event) => setCap(event.target.value)}
                  required
                />
              </label>
              <button type="submit" disabled={busy}>
                Set limit
              </button>
            </form>
            <p className="wallet-note">
              When the limit is reached no machine is started and new runs and meshes are refused until the 1st.
              Set it to 0 to pause the solver; the site stays up.
            </p>
            {state.admin.solverMachines.starts.length === 0 ? (
              <p className="pane-empty">No machine started yet.</p>
            ) : (
              <table className="wallet-table" aria-label="Machine starts">
              <thead>
                <tr>
                  <th>Asked for (UTC)</th>
                  <th>Size</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {state.admin.solverMachines.starts.map((start) => (
                  <tr key={start.requestedAt + start.size}>
                    <td>{utc(start.requestedAt)}</td>
                    <td>{start.size}</td>
                    <td>{startText(start)}</td>
                  </tr>
                ))}
              </tbody>
              </table>
            )}
          </section>
          )}
        </div>
      )}
    </>
  );
}

const SIZE_NOTES: Record<AdminResponse["machines"], string> = {
  cloud:
    "Runs can choose the sizes switched on here. Switch a size on only after it is switched on in the AWS stack too (docs/DEPLOYMENT.md section 7.3); until it is benchmarked, a larger size keeps the 16 GB element limits.",
  vps: "Runs can choose the sizes switched on here. On the solver host every run goes into its solve lane; the size sets the run's estimate and rate, and keeps the 16 GB element limits until the host is benchmarked.",
  local:
    "Jobs here run on the local worker, which simulates every size, so this list changes nothing on this server. It decides which sizes the live site offers.",
};

/** The always-on solver host (M12.4, ADR-120): online or offline, from its check-ins. */
function SolverHostCard({ host }: { host: SolverHost | null }) {
  return (
    <section className="admin-card" aria-label="Solver host">
      <h3 className="wallet-subtitle">Solver host</h3>
      {host === null ? (
        <p className="form-problem" role="alert">
          No solver host has checked in yet, so new jobs are refused. Start the compute manager on the VPS
          (docs/DEPLOYMENT.md).
        </p>
      ) : host.online ? (
        <p className="wallet-note" data-testid="solver-host-state">
          <strong>{host.host}</strong> is online: last check-in {utc(host.lastSeenAt)} UTC, up since{" "}
          {utc(host.firstSeenAt)} UTC{host.managerVersion === null ? "" : `, manager ${host.managerVersion}`}.
        </p>
      ) : (
        <p className="form-problem" role="alert" data-testid="solver-host-state">
          <strong>{host.host}</strong> is offline: no check-in since {utc(host.lastSeenAt)} UTC, so new jobs are
          refused and queued work waits. Restart the VPS by hand (docs/DEPLOYMENT.md); nothing starts a new one.
        </p>
      )}
    </section>
  );
}

/** What the admin needs to know about starting machines on this server. */
function launcherNote(machines: SolverMachines): string {
  if (machines.launcher === "local") {
    return "Jobs here run on the local worker, so no machine is started and the limit changes nothing on this server. On the live site machines start on AWS when work is queued and stop 10 minutes after their last job.";
  }
  if (machines.launcher === "not_set_up") {
    return `Machines cannot be started yet, so queued work fails at once. ${machines.problem ?? ""}`;
  }
  return "Machines start on AWS when work is queued and stop 10 minutes after their last job.";
}

const START_STATES: Record<MachineStart["state"], string> = {
  starting: "Starting",
  running: "Running",
  ended: "Stopped",
  failed: "Did not start",
};

function startText(start: MachineStart): string {
  return start.problem === null ? START_STATES[start.state] : `${START_STATES[start.state]}: ${start.problem}`;
}
