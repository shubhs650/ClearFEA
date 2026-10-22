// SPDX-License-Identifier: AGPL-3.0-or-later
// Queues a no-op job and shows it move through the worker's states. Proves the API,
// the database and the worker are connected before any real job type exists (M0 exit).

import type { JobStatus, JobView } from "@clearfea/spec";
import { useCallback, useEffect, useState } from "react";
import { listJobs, queueNoopJob } from "../api/jobs";
import type { ApiResult } from "../api/request";
import { usePolling } from "./usePolling";

const ACTIVE: readonly JobStatus[] = ["queued", "claimed", "running"];

const labels: Record<JobStatus, string> = {
  queued: "Queued",
  claimed: "Claimed",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
  stopped_at_limit: "Stopped at limit",
};

export function TestJobs({ onSignedOut }: { onSignedOut: (problem: string) => void }) {
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);

  const handle = useCallback(
    <T,>(result: ApiResult<T>): T | undefined => {
      if (result.kind === "ok") {
        setProblem(undefined);
        return result.value;
      }
      if (result.kind === "signedOut") onSignedOut(result.problem);
      else setProblem(result.problem);
      return undefined;
    },
    [onSignedOut],
  );

  const refresh = useCallback(async () => {
    const list = handle(await listJobs());
    if (list) setJobs(list);
  }, [handle]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // While a job is active, the list is checked through the shared polling hook (M11.2, ADR-112).
  const active = jobs.some((job) => ACTIVE.includes(job.status));
  usePolling(active ? "jobs" : null, async (current) => {
    const list = handle(await listJobs());
    if (!list || !current()) return { changed: false };
    const key = (all: JobView[]) => all.map((job) => `${job.id}:${job.status}`).join(",");
    const changed = key(list) !== key(jobs);
    setJobs(list);
    return { changed };
  });

  async function queue() {
    setBusy(true);
    const job = handle(await queueNoopJob());
    setBusy(false);
    if (job) setJobs((current) => [job, ...current]);
  }

  return (
    <section className="test-jobs" aria-label="Worker check">
      <h2 className="pane-title">Worker check</h2>
      <p className="pane-empty">
        A no-op job does no work. It shows that the worker picks up jobs and reports back.
      </p>
      <button type="button" onClick={queue} disabled={busy}>
        Queue a no-op job
      </button>
      {problem && (
        <p className="form-problem" role="alert">
          {problem}
        </p>
      )}
      {jobs.length > 0 && (
        <ul className="job-list">
          {jobs.map((job) => (
            <li key={job.id} className="job-row">
              <span className={`job-status job-${job.status}`}>{labels[job.status]}</span>
              <span className="job-time">{new Date(job.createdAt).toLocaleTimeString()}</span>
              {job.failureCause && <span className="job-cause">{job.failureCause}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
