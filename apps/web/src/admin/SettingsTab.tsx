// SPDX-License-Identifier: AGPL-3.0-or-later
// The dashboard's Settings (M13.3, ADR-128): every setting in its group, each changed on its own
// and recorded in the event log; the cloud machine sizes switched on (M10.6, ADR-099); and the
// solver machines with their hours this month (M10.7, ADR-100) or, with MACHINES=vps, the solver
// host (M12.4, ADR-120).

import type { AdminResponse, AdminSetting, MachineStart, SolverHost, SolverMachines } from "@clearfea/spec";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { fetchSettings, setSetting, switchCloudSize } from "../api/admin";
import type { ApiResult } from "../api/request";
import { utc } from "./format";
import { useAdminView } from "./useAdminView";

const GROUPS: { id: AdminSetting["group"]; title: string }[] = [
  { id: "queue", title: "Queue and workers" },
  { id: "storage", title: "Storage" },
  { id: "accounts", title: "Accounts" },
  { id: "machines", title: "Cloud machines" },
  { id: "costs", title: "Costs" },
  { id: "alerts", title: "Alerts" },
];

type SettingsState =
  | { kind: "loading" }
  | { kind: "loaded"; settings: AdminSetting[] }
  | { kind: "problem"; problem: string };

export function SettingsTab({ onSignedOut }: { onSignedOut: (notice?: string) => void }) {
  const [state, setState] = useState<SettingsState>({ kind: "loading" });
  const view = useAdminView(onSignedOut);

  const show = useCallback(
    (result: ApiResult<{ settings: AdminSetting[] }>): string | undefined => {
      if (result.kind === "signedOut") onSignedOut(result.problem);
      else if (result.kind === "error") return result.problem;
      else setState({ kind: "loaded", settings: result.value.settings });
      return undefined;
    },
    [onSignedOut],
  );

  useEffect(() => {
    fetchSettings().then((result) => {
      const problem = show(result);
      if (problem !== undefined) setState({ kind: "problem", problem });
    });
  }, [show]);

  async function save(name: string, value: number): Promise<string | undefined> {
    const problem = show(await setSetting(name, value));
    // The Solver machines card shows the hours cap too.
    if (problem === undefined && name === "machine_hours_cap") await view.reload();
    return problem;
  }

  return (
    <div className="admin-settings">
      {state.kind === "loading" && <p className="pane-empty">Loading…</p>}
      {state.kind === "problem" && (
        <p className="form-problem" role="alert">
          {state.problem}
        </p>
      )}
      {state.kind === "loaded" && (
        <div className="admin-grid">
          {GROUPS.map((group) => (
            <section key={group.id} className="admin-card" aria-label={group.title}>
              <h3 className="wallet-subtitle">{group.title}</h3>
              {group.id === "machines" && (
                <p className="wallet-note">These apply only when jobs run on cloud machines (MACHINES=cloud).</p>
              )}
              <ul className="admin-setting-list">
                {state.settings
                  .filter((setting) => setting.group === group.id)
                  .map((setting) => (
                    <SettingRow key={setting.name} setting={setting} onSave={save} />
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {view.state.kind === "problem" && (
        <p className="form-problem" role="alert">
          {view.state.problem}
        </p>
      )}
      {view.state.kind === "loaded" && (
        <div className="admin-grid">
          <MachineSizes
            admin={view.state.admin}
            busy={view.busy}
            problem={view.problem}
            onSwitch={(name, enabled) => view.change(() => switchCloudSize(name, enabled))}
          />
          {view.state.admin.machines === "vps" ? (
            <SolverHostCard host={view.state.admin.solverHost} />
          ) : (
            <SolverMachinesCard machines={view.state.admin.solverMachines} />
          )}
        </div>
      )}
    </div>
  );
}

/** A stored value as shown, to at most six significant figures. */
function shownValue(setting: AdminSetting, value = setting.value): string {
  return String(Number((value / setting.scale).toPrecision(6)));
}

/** One setting: its value, a field to change it, and what it does. */
function SettingRow({
  setting,
  onSave,
}: {
  setting: AdminSetting;
  onSave: (name: string, value: number) => Promise<string | undefined>;
}) {
  const [text, setText] = useState(shownValue(setting));
  const [problem, setProblem] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => setText(shownValue(setting)), [setting]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const shown = Number(text.trim());
    if (text.trim() === "" || !Number.isFinite(shown)) {
      setProblem(`Type a number of ${setting.unit}, such as ${shownValue(setting)}.`);
      return;
    }
    setBusy(true);
    setProblem(await onSave(setting.name, Math.round(shown * setting.scale)));
    setBusy(false);
  }

  return (
    <li className="admin-setting">
      <form className="admin-add" onSubmit={submit}>
        <label className="field">
          <span>{setting.label}</span>
          <input
            name={setting.name}
            inputMode="decimal"
            value={text}
            onChange={(event) => setText(event.target.value)}
            required
          />
        </label>
        <span className="admin-tag admin-setting-unit">{setting.unit}</span>
        <button type="submit" disabled={busy} aria-label={`Save ${setting.label}`}>
          Save
        </button>
      </form>
      <p className="wallet-note">
        {setting.description} From {shownValue(setting, setting.min)} to {shownValue(setting, setting.max)}{" "}
        {setting.unit}.
      </p>
      {problem && (
        <p className="form-problem" role="alert">
          {problem}
        </p>
      )}
    </li>
  );
}

const SIZE_NOTES: Record<AdminResponse["machines"], string> = {
  cloud:
    "Runs can choose the sizes switched on here. Switch a size on only after it is switched on in the AWS stack too (docs/DEPLOYMENT.md section 7.3); until it is benchmarked, a larger size keeps the 16 GB element limits.",
  vps: "Runs can choose the sizes switched on here. On the solver host every run goes into its solve lane; the size sets the run's estimate and rate, and keeps the 16 GB element limits until the host is benchmarked.",
  local:
    "Jobs here run on the local worker, which simulates every size, so this list changes nothing on this server. It decides which sizes the live site offers.",
};

function MachineSizes({
  admin,
  busy,
  problem,
  onSwitch,
}: {
  admin: AdminResponse;
  busy: boolean;
  problem: string | undefined;
  onSwitch: (name: string, enabled: boolean) => void;
}) {
  return (
    <section className="admin-card" aria-label="Machine sizes">
      <h3 className="wallet-subtitle">Machine sizes</h3>
      <p className="wallet-note">{SIZE_NOTES[admin.machines]}</p>
      {problem && (
        <p className="form-problem" role="alert">
          {problem}
        </p>
      )}
      <ul className="admin-allowed">
        {admin.cloudSizes.map((size) => (
          <li key={size.name}>
            <label className="admin-size">
              <input
                type="checkbox"
                checked={size.enabled}
                disabled={busy || size.default}
                onChange={(event) => onSwitch(size.name, event.target.checked)}
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
  );
}

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

/** The cloud machines started this month and against the monthly limit, set under Cloud machines. */
function SolverMachinesCard({ machines }: { machines: SolverMachines }) {
  return (
    <section className="admin-card" aria-label="Solver machines">
      <h3 className="wallet-subtitle">Solver machines</h3>
      <p className="wallet-note">{launcherNote(machines)}</p>
      <p className="admin-hours">
        <strong>{machines.hoursThisMonth.toFixed(1)} h</strong> of {machines.hoursCap} h used this month (UTC)
      </p>
      <p className="wallet-note">
        When the limit is reached no machine is started and new runs and meshes are refused until the 1st. Set it
        under Cloud machines; 0 pauses the solver and the site stays up.
      </p>
      {machines.starts.length === 0 ? (
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
            {machines.starts.map((start) => (
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
