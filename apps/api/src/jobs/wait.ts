// SPDX-License-Identifier: AGPL-3.0-or-later
// How a job that has not finished is getting on (M11.2, ADR-112): sent as `wait` with the answers
// the screens poll, so one request tells them the job's state, its place in the queue, whether a
// solver machine is starting for it, and when asking again is worth it.

import type { JobStatus, JobWait } from "@clearfea/spec";
import { getJob, queuePlace } from "../db/jobs";
import type { Env } from "../env";
import { machineStarting } from "../launcher";

/** The longest `retryAfter`; the browser never waits longer between checks either. */
export const MAX_RETRY_AFTER = 30;

const ACTIVE: readonly JobStatus[] = ["queued", "claimed", "running"];

/**
 * Seconds before asking again is worth it: a job a worker is on changes stage often, so soon; a
 * queued job waits at least for the jobs ahead of it; a machine start takes 1 to 3 minutes.
 */
export function retryAfter(status: JobStatus, queuePosition: number | null, starting: boolean): number {
  if (status !== "queued") return 2;
  const behind = Math.min(MAX_RETRY_AFTER, 5 * (queuePosition ?? 1));
  return starting ? Math.max(15, behind) : behind;
}

/** The job's wait, or undefined when there is no job or it has finished. Owner-scoped. */
export async function jobWait(env: Env, userId: string, jobId: string | null): Promise<JobWait | undefined> {
  if (jobId === null) return undefined;
  const job = await getJob(env.DB, userId, jobId);
  if (job === null || !ACTIVE.includes(job.status)) return undefined;
  const place = job.status === "queued" ? await queuePlace(env.DB, userId, job.id) : null;
  const starting = place?.machineSize ? await machineStarting(env, place.machineSize) : false;
  const queuePosition = place?.position ?? null;
  return { status: job.status, queuePosition, machineStarting: starting, retryAfter: retryAfter(job.status, queuePosition, starting) };
}
