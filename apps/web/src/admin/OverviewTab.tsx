// SPDX-License-Identifier: AGPL-3.0-or-later
// The dashboard's Overview (M13.2, ADR-127): the alerts, the solver host and its latest load, pause
// and resume of the queue, and each lane's running and waiting jobs. Checked again through the
// app's one polling loop (ADR-112): 2 s doubling to 30 s while nothing changes, paused in hidden tabs.

import type { AdminJob, AdminLane, HostLoadSample, OverviewResponse, SolverHost } from "@clearfea/spec";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchOverview, setQueuePaused } from "../api/admin";
import type { ApiResult } from "../api/request";
import { usePolling } from "../jobs/usePolling";
import { bytes, percent, since, utc } from "./format";
import { JOB_TYPE_NAMES, STATUS_NAMES } from "./names";

type State = { kind: "loading" } | { kind: "loaded"; overview: OverviewResponse } | { kind: "problem"; problem: string };

export function OverviewTab({ onSignedOut }: { onSignedOut: (notice?: string) => void }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [problem, setProblem] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const shown = useRef("");

  /** Shows the answer; returns whether it differs from what was shown. */
  const show = useCallback(
    (result: ApiResult<OverviewResponse>, change: boolean): boolean => {
      if (result.kind === "signedOut") {
        onSignedOut(result.problem);
        return false;
      }
      if (result.kind === "error") {
        if (change) setProblem(result.problem);
        else setState({ kind: "problem", problem: result.problem });
        return false;
      }
      const json = JSON.stringify(result.value);
      const changed = json !== shown.current;
      shown.current = json;
      setState({ kind: "loaded", overview: result.value });
      setProblem(undefined);
      return changed;
    },
    [onSignedOut],
  );

  useEffect(() => {
    fetchOverview().then((result) => show(result, false));
  }, [show]);

  usePolling("overview", async (current) => {
    const result = await fetchOverview();
    return { changed: current() ? show(result, false) : false };
  });

  async function pause(paused: boolean) {
    setBusy(true);
    show(await setQueuePaused(paused), true);
    setBusy(false);
  }

  if (state.kind === "loading") return <p className="pane-empty">Loading…</p>;
  if (state.kind === "problem") {
    return (
      <p className="form-problem" role="alert">
        {state.problem}
      </p>
    );
  }
  const { overview } = state;
  return (
    <div className="admin-overview">
      {overview.alerts.length > 0 && (
        <ul className="admin-alerts" aria-label="Alerts">
          {overview.alerts.map((alert) => (
            <li key={alert.kind} className={`admin-alert admin-alert-${alert.level}`} role="alert">
              {alert.message}
            </li>
          ))}
        </ul>
      )}
      <div className="admin-grid">
        <HostCard machines={overview.machines} host={overview.host} load={overview.load} />
        <section className="admin-card" aria-label="Queue">
          <h3 className="wallet-subtitle">Queue</h3>
          {overview.paused ? (
            <p className="wallet-note" data-testid="queue-state">
              <strong>Paused</strong>
              {overview.pausedAt === null ? "" : ` since ${utc(overview.pausedAt)} UTC`}: no job starts. Jobs already
              running finish, and new jobs still queue.
            </p>
          ) : (
            <p className="wallet-note" data-testid="queue-state">
              <strong>Running</strong>: each lane takes the next waiting job as soon as it is free.
            </p>
          )}
          <button type="button" disabled={busy} onClick={() => pause(!overview.paused)}>
            {overview.paused ? "Resume the queue" : "Pause the queue"}
          </button>
          {problem && (
            <p className="form-problem" role="alert">
              {problem}
            </p>
          )}
        </section>
      </div>
      {overview.lanes.map((lane) => (
        <LaneCard key={lane.lane} lane={lane} />
      ))}
    </div>
  );
}

const MACHINES_NOTES: Record<OverviewResponse["machines"], string> = {
  vps: "Jobs run on the always-on solver host, one job per lane.",
  cloud: "Jobs run on solver machines started on AWS (parked until production).",
  local: "Jobs here run on the local worker; a solver host shows here once a compute manager checks in.",
};

function HostCard({
  machines,
  host,
  load,
}: {
  machines: OverviewResponse["machines"];
  host: SolverHost | null;
  load: HostLoadSample | null;
}) {
  return (
    <section className="admin-card" aria-label="Solver host">
      <h3 className="wallet-subtitle">Solver host</h3>
      <p className="wallet-note">{MACHINES_NOTES[machines]}</p>
      {host === null ? (
        <p className="pane-empty">No solver host has checked in.</p>
      ) : (
        <p className="admin-host" data-testid="solver-host-state">
          <strong>{host.host}</strong> is {host.online ? "online" : "offline"}: last check-in {utc(host.lastSeenAt)}{" "}
          UTC, up since {utc(host.firstSeenAt)} UTC{host.managerVersion === null ? "" : `, manager ${host.managerVersion}`}.
        </p>
      )}
      {load !== null && (
        <dl className="admin-load" aria-label="Host load">
          <div>
            <dt>CPU</dt>
            <dd>{load.cpu === null ? "–" : percent(load.cpu)}</dd>
          </div>
          <div>
            <dt>Load (1, 5, 15 min)</dt>
            <dd>
              {load.load1.toFixed(2)}, {load.load5.toFixed(2)}, {load.load15.toFixed(2)}
            </dd>
          </div>
          <div>
            <dt>Memory used</dt>
            <dd>
              {bytes(load.memoryTotalBytes - load.memoryAvailableBytes)} of {bytes(load.memoryTotalBytes)}
            </dd>
          </div>
          <div>
            <dt>Disk free</dt>
            <dd>
              {bytes(load.diskFreeBytes)} of {bytes(load.diskTotalBytes)}
            </dd>
          </div>
          <div>
            <dt>Job containers</dt>
            <dd>{load.containers}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}

const LANE_NAMES: Record<AdminLane["lane"], string> = { solve: "Solve lane", light: "Light lane" };
const LANE_NOTES: Record<AdminLane["lane"], string> = {
  solve: "Solves, one at a time.",
  light: "Imports, meshes and reports, one at a time.",
};

function LaneCard({ lane }: { lane: AdminLane }) {
  const name = LANE_NAMES[lane.lane];
  return (
    <section className="admin-card admin-lane" aria-label={name}>
      <h3 className="wallet-subtitle">
        {name} <span className="admin-when">{LANE_NOTES[lane.lane]}</span>
      </h3>
      {lane.running.length === 0 && lane.queued.length === 0 ? (
        <p className="pane-empty">Nothing running or waiting.</p>
      ) : (
        <table className="wallet-table" aria-label={`${name} jobs`}>
          <thead>
            <tr>
              <th>State</th>
              <th>Job</th>
              <th>User</th>
              <th>Try</th>
              <th>Since</th>
              <th>Worker or place</th>
            </tr>
          </thead>
          <tbody>
            {[...lane.running, ...lane.queued].map((job) => (
              <tr key={job.id}>
                <td>{stateText(job)}</td>
                <td>
                  {JOB_TYPE_NAMES[job.type]} <span className="admin-id">{job.id.slice(0, 8)}</span>
                </td>
                <td>{job.ownerEmail ?? job.ownerId.slice(0, 8)}</td>
                <td>{job.attempt}</td>
                <td>{since(job.claimedAt ?? job.createdAt)}</td>
                <td>{job.status === "queued" ? `#${job.queuePosition ?? "?"} in the queue` : (job.claimedBy ?? "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function stateText(job: AdminJob): string {
  if (job.status === "running" && job.stage !== null) return `Running: ${job.stage}`;
  return STATUS_NAMES[job.status];
}
