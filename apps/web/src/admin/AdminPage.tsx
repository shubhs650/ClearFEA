// SPDX-License-Identifier: AGPL-3.0-or-later
// The admin page (M10.3, ADR-097): who may sign in with Google, and who has, and which cloud
// machine sizes are switched on (M10.6, ADR-099), and the solver machines with their monthly
// hours cap (M10.7, ADR-100). Only the admin
// (ADMIN_EMAIL) sees it. Drawn over the workbench like the wallet page, which stays as it was.

import type { AdminResponse, MachineStart, SolverMachines } from "@clearfea/spec";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { addAllowed, fetchAdmin, removeAllowed, setMachineHoursCap, switchCloudSize } from "../api/admin";
import type { ApiResult } from "../api/request";

type AdminState = { kind: "loading" } | { kind: "loaded"; admin: AdminResponse } | { kind: "problem"; problem: string };

export function AdminPage({ onClose, onSignedOut }: { onClose: () => void; onSignedOut: (notice?: string) => void }) {
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
    <section className="pane wallet-page admin-page" aria-label="Admin">
      <header className="wallet-header">
        <h2 className="wallet-title">Admin</h2>
        <button type="button" onClick={onClose}>
          Back to the workbench
        </button>
      </header>
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
              {state.admin.machines === "cloud"
                ? "Runs can choose the sizes switched on here. Switch a size on only after it is switched on in the AWS stack too (docs/DEPLOYMENT.md section 7.3); until it is benchmarked, a larger size keeps the 16 GB element limits."
                : "Jobs here run on the local worker, which simulates every size, so this list changes nothing on this server. It decides which sizes the live site offers."}
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
            {state.admin.solverMachines.starts.length === 0 && <p className="pane-empty">No machine started yet.</p>}
          </section>
        </div>
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

/** Machine time in hours and minutes, such as "1 h 05 min", or seconds under a minute. */
function hours(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** An API timestamp as a fixed, unambiguous UTC time, as the wallet writes it. */
function utc(timestamp: string): string {
  return timestamp.slice(0, 16).replace("T", " ");
}
