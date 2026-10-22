// SPDX-License-Identifier: AGPL-3.0-or-later
// The dashboard's Users (M13.3, ADR-128; the allowlist and users of M10.3, ADR-097): who may sign
// in with Google, and who has, with each user's machine time, jobs and failed jobs this month.

import { type FormEvent, useState } from "react";
import { addAllowed, removeAllowed } from "../api/admin";
import { hours, utc } from "./format";
import { useAdminView } from "./useAdminView";

export function UsersTab({ onSignedOut }: { onSignedOut: (notice?: string) => void }) {
  const { state, problem, busy, change } = useAdminView(onSignedOut);
  const [email, setEmail] = useState("");

  async function add(event: FormEvent) {
    event.preventDefault();
    if (await change(() => addAllowed(email.trim()))) setEmail("");
  }

  if (state.kind === "loading") return <p className="pane-empty">Loading…</p>;
  if (state.kind === "problem") {
    return (
      <p className="form-problem" role="alert">
        {state.problem}
      </p>
    );
  }
  const { admin } = state;
  return (
    <div className="admin-columns">
      <section className="admin-card" aria-label="Allowed addresses">
        <h3 className="wallet-subtitle">Allowed addresses</h3>
        <p className="wallet-note">
          These Google accounts can sign in. Add each one also as a test user on the Google consent screen
          (docs/DEPLOYMENT.md section 2.2). Removing an address signs its owner out at once; their projects stay.
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
            <span className="admin-email">{admin.adminEmail}</span>
            <span className="admin-tag">Admin, always allowed</span>
          </li>
          {admin.allowed.map((entry) => (
            <li key={entry.email}>
              <span className="admin-email">{entry.email}</span>
              <span className="admin-when">added {utc(entry.addedAt)} UTC</span>
              <button
                type="button"
                className="link-button"
                disabled={busy}
                aria-label={`Remove ${entry.email}`}
                onClick={() => change(() => removeAllowed(entry.email))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        {admin.allowed.length === 0 && <p className="pane-empty">Nobody else is invited yet.</p>}
      </section>
      <section className="admin-card" aria-label="Users">
        <h3 className="wallet-subtitle">Users</h3>
        <p className="wallet-note">
          Machine time, jobs and failed jobs count this calendar month (UTC). A user's jobs and their logs are on
          Jobs and runs, and their sign-ins on Events.
        </p>
        <table className="wallet-table" aria-label="Users">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>First signed in (UTC)</th>
              <th>Last signed in (UTC)</th>
              <th className="wallet-number">Machine time</th>
              <th className="wallet-number">Jobs</th>
              <th className="wallet-number">Failed</th>
              <th>Can sign in</th>
            </tr>
          </thead>
          <tbody>
            {admin.users.map((user) => (
              <tr key={user.id}>
                <td>{user.name}</td>
                <td>{user.email ?? "none (local test user)"}</td>
                <td>{utc(user.createdAt)}</td>
                <td>{user.lastSignIn === null ? "" : utc(user.lastSignIn)}</td>
                <td className="wallet-number">{hours(user.machineSecondsThisMonth)}</td>
                <td className="wallet-number">{user.jobsThisMonth}</td>
                <td className="wallet-number">{user.failedJobsThisMonth}</td>
                <td>{user.allowed ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
