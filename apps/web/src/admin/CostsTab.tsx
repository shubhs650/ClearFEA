// SPDX-License-Identifier: AGPL-3.0-or-later
// The dashboard's Costs (M13.3, ADR-128): one calendar month's (UTC) machine time, jobs and
// charges, by user and by job type, beside what the beta costs each month used or not (the
// solver host and Cloudflare, set on the Settings tab). Users' wallets show usage only.

import type { CostsResponse } from "@clearfea/spec";
import { useEffect, useState } from "react";
import { fetchCosts } from "../api/admin";
import { credits } from "../billing/credits";
import { hours } from "./format";
import { JOB_TYPE_NAMES } from "./names";

/** The last twelve calendar months in UTC, this one first, as `YYYY-MM`. */
function recentMonths(now = new Date()): string[] {
  return Array.from({ length: 12 }, (_, back) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)).toISOString().slice(0, 7),
  );
}

/** A month such as "October 2026". */
function monthName(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** US cents as dollars, such as "$17.00". */
function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

type State = { kind: "loading" } | { kind: "loaded"; costs: CostsResponse } | { kind: "problem"; problem: string };

export function CostsTab({ onSignedOut }: { onSignedOut: (notice?: string) => void }) {
  const months = recentMonths();
  const [month, setMonth] = useState(months[0] ?? "");
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let current = true;
    fetchCosts(month).then((result) => {
      if (!current) return;
      if (result.kind === "signedOut") onSignedOut(result.problem);
      else if (result.kind === "error") setState({ kind: "problem", problem: result.problem });
      else setState({ kind: "loaded", costs: result.value });
    });
    return () => {
      current = false;
    };
  }, [month, onSignedOut]);

  return (
    <div className="admin-costs">
      <div className="admin-filters">
        <label className="field">
          <span>Month (UTC)</span>
          <select value={month} onChange={(event) => setMonth(event.target.value)}>
            {months.map((value) => (
              <option key={value} value={value}>
                {monthName(value)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {state.kind === "loading" && <p className="pane-empty">Loading…</p>}
      {state.kind === "problem" && (
        <p className="form-problem" role="alert">
          {state.problem}
        </p>
      )}
      {state.kind === "loaded" && <Costs costs={state.costs} />}
    </div>
  );
}

function Costs({ costs }: { costs: CostsResponse }) {
  const { totals } = costs;
  const fixed = costs.solverHostCents + costs.platformCents;
  const machineHours = totals.machineSeconds / 3600;
  return (
    <>
      <section className="admin-card" aria-label="Month">
        <h3 className="wallet-subtitle">{monthName(costs.month)}</h3>
        <dl className="admin-facts">
          <div>
            <dt>Fixed costs</dt>
            <dd data-testid="costs-fixed">{dollars(fixed)} a month</dd>
          </div>
          <div>
            <dt>Machine time</dt>
            <dd>{hours(totals.machineSeconds)}</dd>
          </div>
          <div>
            <dt>Jobs</dt>
            <dd>{totals.jobs}</dd>
          </div>
          <div>
            <dt>Runs solved</dt>
            <dd>{totals.solveRuns}</dd>
          </div>
          <div>
            <dt>Per machine hour</dt>
            <dd>{machineHours > 0 ? dollars(Math.round(fixed / machineHours)) : "no machine time yet"}</dd>
          </div>
          <div>
            <dt>Per run solved</dt>
            <dd>{totals.solveRuns > 0 ? dollars(Math.round(fixed / totals.solveRuns)) : "no runs yet"}</dd>
          </div>
          <div>
            <dt>Charged for jobs</dt>
            <dd>{credits(totals.jobMicroCredits)}</dd>
          </div>
          <div>
            <dt>Charged for storage</dt>
            <dd>{credits(totals.storageMicroCredits)}</dd>
          </div>
        </dl>
        <p className="wallet-note">
          Fixed costs are the solver host ({dollars(costs.solverHostCents)}) and Cloudflare (
          {dollars(costs.platformCents)}) a month at today's settings, used or not; change them on the Settings tab.
          The cost per machine hour and per run spreads them over this month's use. Credits are play money: users'
          wallets show usage only and nothing is refused for its balance.
        </p>
      </section>
      <section className="admin-card" aria-label="By user">
        <h3 className="wallet-subtitle">By user</h3>
        {costs.byUser.length === 0 ? (
          <p className="pane-empty">Nobody used ClearFEA in {monthName(costs.month)}.</p>
        ) : (
          <table className="wallet-table" aria-label="Costs by user">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th className="wallet-number">Jobs</th>
                <th className="wallet-number">Runs solved</th>
                <th className="wallet-number">Machine time</th>
                <th className="wallet-number">Share of machine time</th>
                <th className="wallet-number">Charged for jobs</th>
                <th className="wallet-number">Charged for storage</th>
              </tr>
            </thead>
            <tbody>
              {costs.byUser.map((user) => (
                <tr key={user.userId}>
                  <td>{user.name}</td>
                  <td>{user.email ?? "none (local test user)"}</td>
                  <td className="wallet-number">{user.jobs}</td>
                  <td className="wallet-number">{user.solveRuns}</td>
                  <td className="wallet-number">{hours(user.machineSeconds)}</td>
                  <td className="wallet-number">
                    {totals.machineSeconds > 0 ? `${Math.round((100 * user.machineSeconds) / totals.machineSeconds)} %` : ""}
                  </td>
                  <td className="wallet-number">{credits(user.jobMicroCredits)}</td>
                  <td className="wallet-number">{credits(user.storageMicroCredits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="admin-card" aria-label="By job type">
        <h3 className="wallet-subtitle">By job type</h3>
        {costs.byType.length === 0 ? (
          <p className="pane-empty">No job finished in {monthName(costs.month)}.</p>
        ) : (
          <table className="wallet-table" aria-label="Costs by job type">
            <thead>
              <tr>
                <th>Type</th>
                <th className="wallet-number">Jobs</th>
                <th className="wallet-number">Machine time</th>
                <th className="wallet-number">Charged</th>
              </tr>
            </thead>
            <tbody>
              {costs.byType.map((row) => (
                <tr key={row.type}>
                  <td>{JOB_TYPE_NAMES[row.type]}</td>
                  <td className="wallet-number">{row.jobs}</td>
                  <td className="wallet-number">{hours(row.machineSeconds)}</td>
                  <td className="wallet-number">{credits(row.jobMicroCredits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
