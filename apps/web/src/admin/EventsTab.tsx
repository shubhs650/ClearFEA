// SPDX-License-Identifier: AGPL-3.0-or-later
// The dashboard's Events (M13.2, M13.1, ADR-125): the event log newest first, by kind and level,
// with older pages on demand. Read when opened, filtered or refreshed, not polled.

import type { AdminEvent } from "@clearfea/spec";
import { useCallback, useEffect, useState } from "react";
import { fetchEvents } from "../api/admin";
import { utcSeconds } from "./format";

const PAGE = 100;

const KIND_NAMES: Record<AdminEvent["kind"], string> = {
  sign_in: "Sign-in",
  sign_in_refused: "Sign-in refused",
  job_failed: "Job failed",
  job_retried: "Job queued again",
  host_online: "Host online",
  host_offline: "Host offline",
  manager_started: "Manager restarted",
  admin_action: "Admin action",
};

const LEVEL_NAMES: Record<AdminEvent["level"], string> = { info: "Info", warning: "Warning", error: "Error" };

export function EventsTab({ onSignedOut }: { onSignedOut: (notice?: string) => void }) {
  const [kind, setKind] = useState("");
  const [level, setLevel] = useState("");
  const [events, setEvents] = useState<AdminEvent[] | null>(null);
  const [more, setMore] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  const read = useCallback(
    async (before?: string): Promise<AdminEvent[] | undefined> => {
      const result = await fetchEvents({ kind, level, before, limit: PAGE });
      if (result.kind === "signedOut") onSignedOut(result.problem);
      else if (result.kind === "error") setProblem(result.problem);
      else {
        setProblem(undefined);
        setMore(result.value.events.length === PAGE);
        return result.value.events;
      }
      return undefined;
    },
    [kind, level, onSignedOut],
  );

  const load = useCallback(async () => {
    const page = await read();
    if (page !== undefined) setEvents(page);
  }, [read]);

  useEffect(() => {
    void load();
  }, [load]);

  async function older() {
    const last = events?.[events.length - 1];
    if (last === undefined) return;
    const page = await read(last.at);
    if (page !== undefined) setEvents([...(events ?? []), ...page]);
  }

  return (
    <div className="admin-events">
      <div className="admin-filters">
        <label className="field">
          <span>Kind</span>
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="">Any kind</option>
            {Object.entries(KIND_NAMES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Level</span>
          <select value={level} onChange={(event) => setLevel(event.target.value)}>
            <option value="">Any level</option>
            {Object.entries(LEVEL_NAMES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {problem && (
        <p className="form-problem" role="alert">
          {problem}
        </p>
      )}
      {events === null ? (
        <p className="pane-empty">Loading…</p>
      ) : events.length === 0 ? (
        <p className="pane-empty">No events match.</p>
      ) : (
        <section className="admin-card" aria-label="Events">
          <table className="wallet-table admin-events-table" aria-label="Events">
            <thead>
              <tr>
                <th>Time (UTC)</th>
                <th>Kind</th>
                <th>Level</th>
                <th>What happened</th>
                <th>Job</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className={`admin-event-${event.level}`}>
                  <td>{utcSeconds(event.at)}</td>
                  <td>{KIND_NAMES[event.kind]}</td>
                  <td>{LEVEL_NAMES[event.level]}</td>
                  <td>{event.message}</td>
                  <td>{event.jobId === null ? "" : <span className="admin-id">{event.jobId.slice(0, 8)}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {more && (
            <button type="button" className="admin-older" onClick={() => void older()}>
              Older events
            </button>
          )}
        </section>
      )}
    </div>
  );
}
