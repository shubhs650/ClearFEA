// SPDX-License-Identifier: AGPL-3.0-or-later
// The dashboard's Jobs and runs (M13.2, ADR-127): every user's jobs, newest first, by status and
// type; a job's details with its tries' statistics (M12.3) and its log; and the admin's cancel
// (uncharged, at once) and re-queue (for a job whose worker hangs). Read when opened, filtered or
// refreshed, not polled.

import type { AdminJob, JobTry } from "@clearfea/spec";
import { useCallback, useEffect, useState } from "react";
import { adminJobAction, fetchAdminJobLog, fetchAdminJobs, fetchJobTries } from "../api/admin";
import type { ApiResult } from "../api/request";
import { bytes, duration, hours, utc } from "./format";
import { JOB_TYPE_NAMES, STATUS_NAMES } from "./names";

const PAGE = 50;

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Any status" },
  { value: "active", label: "Queued or running" },
  ...(["queued", "running", "succeeded", "failed", "cancelled", "stopped_at_limit"] as const).map((status) => ({
    value: status,
    label: STATUS_NAMES[status],
  })),
];

const TYPE_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Any type" },
  ...(["solve", "mesh", "import", "report", "noop"] as const).map((type) => ({ value: type, label: JOB_TYPE_NAMES[type] })),
];

type Signed = { onSignedOut: (notice?: string) => void };

export function JobsTab({ onSignedOut }: Signed) {
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [jobs, setJobs] = useState<AdminJob[] | null>(null);
  const [more, setMore] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [selected, setSelected] = useState<string | null>(null);

  /** The value of an answer, or undefined after saying what went wrong. */
  const answerOf = useCallback(
    <T,>(result: ApiResult<T>): T | undefined => {
      if (result.kind === "signedOut") onSignedOut(result.problem);
      else if (result.kind === "error") setProblem(result.problem);
      else {
        setProblem(undefined);
        return result.value;
      }
      return undefined;
    },
    [onSignedOut],
  );

  const load = useCallback(async () => {
    const answer = answerOf(await fetchAdminJobs({ status, type, limit: PAGE }));
    if (answer === undefined) return;
    setJobs(answer.jobs);
    setMore(answer.jobs.length === PAGE);
  }, [status, type, answerOf]);

  useEffect(() => {
    void load();
  }, [load]);

  async function older() {
    const last = jobs?.[jobs.length - 1];
    if (last === undefined) return;
    const answer = answerOf(await fetchAdminJobs({ status, type, before: last.createdAt, limit: PAGE }));
    if (answer === undefined) return;
    setJobs([...(jobs ?? []), ...answer.jobs]);
    setMore(answer.jobs.length === PAGE);
  }

  /** Puts a job the admin acted on in the list as it is now. */
  function replaced(job: AdminJob) {
    setJobs((list) => list?.map((j) => (j.id === job.id ? job : j)) ?? null);
  }

  const chosen = jobs?.find((job) => job.id === selected) ?? null;
  return (
    <div className="admin-jobs">
      <div className="admin-filters">
        <label className="field">
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            {STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Type</span>
          <select value={type} onChange={(event) => setType(event.target.value)}>
            {TYPE_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
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
      {jobs === null ? (
        <p className="pane-empty">Loading…</p>
      ) : jobs.length === 0 ? (
        <p className="pane-empty">No jobs match.</p>
      ) : (
        <section className="admin-card" aria-label="Jobs">
          <table className="wallet-table admin-jobs-table" aria-label="Jobs">
            <thead>
              <tr>
                <th>Queued (UTC)</th>
                <th>Job</th>
                <th>User</th>
                <th>Status</th>
                <th className="wallet-number">Try</th>
                <th>Worker</th>
                <th className="wallet-number">Peak memory</th>
                <th className="wallet-number">Billed</th>
                <th>Failure</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} aria-selected={job.id === selected}>
                  <td>{utc(job.createdAt)}</td>
                  <td>
                    {JOB_TYPE_NAMES[job.type]} <span className="admin-id">{job.id.slice(0, 8)}</span>
                  </td>
                  <td>{job.ownerEmail ?? job.ownerId.slice(0, 8)}</td>
                  <td>{statusText(job)}</td>
                  <td className="wallet-number">{job.attempt}</td>
                  <td>{job.claimedBy ?? ""}</td>
                  <td className="wallet-number">{job.peakMemoryBytes === null ? "" : bytes(job.peakMemoryBytes)}</td>
                  <td className="wallet-number">{job.billedSeconds === null ? "" : hours(job.billedSeconds)}</td>
                  <td>{job.failureCause === null ? "" : `${job.failureCause} (${faultName(job)})`}</td>
                  <td>
                    <button
                      type="button"
                      className="link-button"
                      aria-label={`Details of job ${job.id}`}
                      onClick={() => setSelected(job.id === selected ? null : job.id)}
                    >
                      {job.id === selected ? "Close" : "Details"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {more && (
            <button type="button" className="admin-older" onClick={() => void older()}>
              Older jobs
            </button>
          )}
        </section>
      )}
      {chosen !== null && (
        <JobDetails key={chosen.id} job={chosen} answerOf={answerOf} onChanged={replaced} />
      )}
    </div>
  );
}

function faultName(job: AdminJob): string {
  return job.failureCategory === "user_fault" ? "the user's setup" : "ClearFEA";
}

function statusText(job: AdminJob): string {
  const name = STATUS_NAMES[job.status];
  if (job.status === "queued" && job.queuePosition !== null) return `${name}, #${job.queuePosition}`;
  if (job.status === "running" && job.stage !== null) return `${name}: ${job.stage}`;
  if (job.stopRequested !== null) return `${name}, stopping`;
  return name;
}

type AnswerOf = <T>(result: ApiResult<T>) => T | undefined;

/** One job: what it is, its tries, its log, and the admin's cancel and re-queue. */
function JobDetails({ job, answerOf, onChanged }: { job: AdminJob; answerOf: AnswerOf; onChanged: (job: AdminJob) => void }) {
  const [tries, setTries] = useState<JobTry[] | null>(null);
  const [log, setLog] = useState<{ text: string; next: number; more: boolean } | null>(null);
  const [confirming, setConfirming] = useState<"cancel" | "requeue" | null>(null);
  const [busy, setBusy] = useState(false);

  const read = useCallback(async () => {
    const [triesAnswer, logAnswer] = await Promise.all([fetchJobTries(job.id), fetchAdminJobLog(job.id, 0)]);
    setTries(answerOf(triesAnswer)?.tries ?? []);
    setLog(answerOf(logAnswer) ?? null);
  }, [job.id, answerOf]);

  useEffect(() => {
    void read();
  }, [read]);

  async function readMore() {
    if (log === null) return;
    const answer = answerOf(await fetchAdminJobLog(job.id, log.next));
    if (answer !== undefined) setLog({ text: log.text + answer.text, next: answer.next, more: answer.more });
  }

  async function act(action: "cancel" | "requeue") {
    setBusy(true);
    const answer = answerOf(await adminJobAction(job.id, action));
    setBusy(false);
    setConfirming(null);
    if (answer === undefined) return;
    onChanged(answer.job);
    await read();
  }

  const active = job.status === "queued" || job.status === "claimed" || job.status === "running";
  const held = job.status === "claimed" || job.status === "running";
  return (
    <section className="admin-card admin-job" aria-label="Job details">
      <h3 className="wallet-subtitle">
        {JOB_TYPE_NAMES[job.type]} job <span className="admin-id">{job.id}</span>
      </h3>
      <dl className="admin-facts">
        <div>
          <dt>Status</dt>
          <dd data-testid="job-status">{statusText(job)}</dd>
        </div>
        <div>
          <dt>User</dt>
          <dd>{job.ownerEmail ?? job.ownerId}</dd>
        </div>
        <div>
          <dt>Works on</dt>
          <dd>{job.targetId ?? "nothing"}</dd>
        </div>
        <div>
          <dt>Machine size</dt>
          <dd>{job.machineSize ?? "none"}</dd>
        </div>
        <div>
          <dt>Queued, started, ended (UTC)</dt>
          <dd>
            {utc(job.createdAt)}, {job.claimedAt === null ? "–" : utc(job.claimedAt)},{" "}
            {job.finishedAt === null ? "–" : utc(job.finishedAt)}
          </dd>
        </div>
      </dl>
      {job.failureMessage !== null && <p className="wallet-note">The user was told: {job.failureMessage}</p>}
      {active && (
        <div className="admin-actions">
          {confirming === null ? (
            <>
              <button type="button" disabled={busy} onClick={() => setConfirming("cancel")}>
                Cancel job
              </button>
              {held && job.stopRequested === null && (
                <button type="button" disabled={busy} onClick={() => setConfirming("requeue")}>
                  Queue again
                </button>
              )}
            </>
          ) : (
            <>
              <span>
                {confirming === "cancel"
                  ? "End this job now? Its user is told the administrator stopped it, and nothing is charged."
                  : "Take this job from its worker and queue it again? It starts over, and the stopped try is not charged."}
              </span>
              <button type="button" disabled={busy} onClick={() => void act(confirming)}>
                {confirming === "cancel" ? "Yes, cancel it" : "Yes, queue it again"}
              </button>
              <button type="button" className="link-button" disabled={busy} onClick={() => setConfirming(null)}>
                Keep it
              </button>
            </>
          )}
        </div>
      )}
      <h4 className="admin-subhead">Tries</h4>
      {tries === null ? (
        <p className="pane-empty">Loading…</p>
      ) : tries.length === 0 ? (
        <p className="pane-empty">No worker has taken it yet.</p>
      ) : (
        <table className="wallet-table" aria-label="Tries">
          <thead>
            <tr>
              <th className="wallet-number">Try</th>
              <th>Worker</th>
              <th className="wallet-number">Waited</th>
              <th>Stages</th>
              <th>Ended</th>
              <th className="wallet-number">Elements</th>
              <th>Solver</th>
              <th className="wallet-number">Peak memory</th>
              <th className="wallet-number">CPU</th>
            </tr>
          </thead>
          <tbody>
            {tries.map((t) => (
              <tr key={`${t.attempt}-${t.workerId}`}>
                <td className="wallet-number">{t.attempt}</td>
                <td>{t.host === null ? t.workerId : `${t.workerId} (${t.lane ?? ""})`}</td>
                <td className="wallet-number">{duration(t.queueWaitMs)}</td>
                <td>
                  {Object.entries(t.stageMs)
                    .map(([stage, ms]) => `${stage} ${duration(ms)}`)
                    .join(", ")}
                </td>
                <td>{t.status === null ? "running" : t.failureCause === null ? t.status : `${t.status}: ${t.failureCause}`}</td>
                <td className="wallet-number">{t.elements ?? ""}</td>
                <td>{t.solver ?? ""}</td>
                <td className="wallet-number">{t.peakMemoryBytes === null ? "" : bytes(t.peakMemoryBytes)}</td>
                <td className="wallet-number">{t.cpuSeconds === null ? "" : `${Math.round(t.cpuSeconds)} s`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h4 className="admin-subhead">Log</h4>
      {log === null ? (
        <p className="pane-empty">Loading…</p>
      ) : log.text === "" ? (
        <p className="pane-empty">The job has written no log.</p>
      ) : (
        <pre className="admin-log" role="log" aria-label="Job log">
          {log.text}
        </pre>
      )}
      {log?.more && (
        <button type="button" onClick={() => void readMore()}>
          More of the log
        </button>
      )}
    </section>
  );
}
