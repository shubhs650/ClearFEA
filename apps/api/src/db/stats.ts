// SPDX-License-Identifier: AGPL-3.0-or-later
// Statistics for support (M12.3, ADR-109, ADR-123): one row per try of a job, and the solver
// host's load. Written from the worker routes, which serve every owner, and read by the admin
// only, so not owner-scoped; the admin's reads return statistics and ids, never a user's names,
// models or results (ADR-113).

import type { ContainerStats, HostLoad, HostLoadSample, JobTry } from "@clearfea/spec";
import type { Completion, Job } from "./jobs";

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** Days the host's load samples are kept. */
export const HOST_STATS_DAYS = 14;

/** Milliseconds from a stored time to now, as SQL. */
const msSince = (column: string) => `CAST(ROUND((julianday('now') - julianday(${column})) * 86400000) AS INTEGER)`;

/** The JSON path of a stage's entry in stage_ms. Stage names are the worker's words; quotes are dropped. */
const STAGE_PATH = `'$."' || replace(stage, '"', '') || '"'`;

/** stage_ms with the time since stage_started_at added to the current stage. */
const CLOSED_STAGE_MS = `json_set(stage_ms, ${STAGE_PATH},
  COALESCE(json_extract(stage_ms, ${STAGE_PATH}), 0) + MAX(0, ${msSince("stage_started_at")}))`;

/** The open try of a job held by a worker: its newest try that has not ended. */
const OPEN_TRY = `id = (SELECT id FROM job_stats WHERE job_id = ? AND worker_id = ? AND ended_at IS NULL
                         ORDER BY attempt DESC LIMIT 1)`;

/**
 * Starts the statistics of a try when a worker has claimed the job: its number, and when it began
 * to wait (the job's creation, or the end of the try before it, as a re-queued job waits again).
 */
export async function startTry(db: D1Database, job: Job): Promise<void> {
  await db
    .prepare(
      `INSERT INTO job_stats (job_id, attempt, worker_id, queued_at, claimed_at, stage_started_at)
       SELECT jobs.id,
              (SELECT COUNT(*) FROM job_stats WHERE job_id = jobs.id) + 1,
              jobs.claimed_by,
              COALESCE((SELECT MAX(ended_at) FROM job_stats WHERE job_id = jobs.id), jobs.created_at),
              jobs.claimed_at, jobs.claimed_at
         FROM jobs WHERE jobs.id = ? AND jobs.claimed_by IS NOT NULL AND jobs.claimed_at IS NOT NULL`,
    )
    .bind(job.id)
    .run();
}

/**
 * Moves the worker's try of the job to the stage its heartbeat names, adding the time spent in
 * the stage it leaves. Writes only when the stage changes.
 */
export async function recordStage(db: D1Database, workerId: string, jobId: string, stage: string | null): Promise<void> {
  if (stage === null || stage === "") return;
  await db
    .prepare(
      `UPDATE job_stats SET stage_ms = ${CLOSED_STAGE_MS}, stage = ?, stage_started_at = ${NOW}
        WHERE ${OPEN_TRY} AND stage IS NOT ?`,
    )
    .bind(stage, jobId, workerId, stage)
    .run();
}

/** The size of the model a job worked on, and how it was solved, for its try's statistics. */
export interface ModelSize {
  nodes: number | null;
  elements: number | null;
  dofs: number | null;
  solver: string | null;
  analysis: string | null;
}

const NO_SIZE: ModelSize = { nodes: null, elements: null, dofs: null, solver: null, analysis: null };

/** Analysis types that solve one temperature per node; every other solves three displacements. */
const THERMAL = new Set(["steady_thermal"]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/**
 * Nodes and elements of the mesh a mesh job made (from its result) or a solve job solved on (from
 * the mesh record), with a solve's unknowns, solver and analysis type from its frozen spec. A run's
 * spec without a solver was saved before ADR-063 and solved with PaStiX's default.
 */
export async function modelSize(db: D1Database, job: Job, completion: Completion): Promise<ModelSize> {
  if (job.type === "mesh") {
    const result = completion.status === "succeeded" ? record(completion.result) : null;
    return { ...NO_SIZE, nodes: count(result?.nodes), elements: count(result?.elements) };
  }
  if (job.type !== "solve") return NO_SIZE;
  const params = record(job.params);
  const spec = record(params?.spec);
  const meshId = typeof params?.meshId === "string" ? params.meshId : null;
  const mesh =
    meshId === null
      ? null
      : await db
          .prepare("SELECT node_count, element_count FROM meshes WHERE id = ? AND owner_id = ?")
          .bind(meshId, job.ownerId)
          .first<{ node_count: number | null; element_count: number | null }>();
  const analysis = typeof spec?.analysis === "string" ? spec.analysis : null;
  const nodes = mesh?.node_count ?? null;
  return {
    nodes,
    elements: mesh?.element_count ?? null,
    dofs: nodes === null || analysis === null ? null : nodes * (THERMAL.has(analysis) ? 1 : 3),
    solver: typeof spec?.solver === "string" ? spec.solver : spec === null ? null : "pastix",
    analysis,
  };
}

/**
 * Ends the worker's try of the job with how it ended, closing its last stage. Called where the
 * job's completion is recorded, before anything re-queues the job, so each try keeps its own row.
 */
export async function endTry(
  db: D1Database,
  workerId: string,
  job: Job,
  completion: Completion,
  size: ModelSize,
): Promise<void> {
  const failed = completion.status === "failed" ? completion : null;
  await db
    .prepare(
      `UPDATE job_stats
          SET stage_ms = ${CLOSED_STAGE_MS}, stage_started_at = ${NOW}, ended_at = ${NOW},
              status = ?, failure_category = ?, failure_cause = ?,
              nodes = ?, elements = ?, dofs = ?, solver = ?, analysis = ?
        WHERE ${OPEN_TRY}`,
    )
    .bind(
      completion.status,
      failed?.failureCategory ?? null,
      failed?.failureCause ?? null,
      size.nodes,
      size.elements,
      size.dofs,
      size.solver,
      size.analysis,
      job.id,
      workerId,
    )
    .run();
}

/**
 * Adds what the compute manager measured of the container to the worker's latest try of the job
 * still without it. The container has ended, so the try usually has too, and the job may already
 * be queued again. Returns false when there is no such try.
 */
export async function recordContainerStats(db: D1Database, jobId: string, stats: ContainerStats): Promise<boolean> {
  const sampled = stats.samples > 0;
  const result = await db
    .prepare(
      `UPDATE job_stats
          SET stats_at = ${NOW}, host = ?, lane = ?, image = ?, exit_code = ?, out_of_memory = ?, run_ms = ?,
              samples = ?, peak_memory_bytes = ?, cpu_seconds = ?, cpu_peak = ?, disk_written_bytes = ?
        WHERE id = (SELECT id FROM job_stats WHERE job_id = ? AND worker_id = ? AND stats_at IS NULL
                     ORDER BY attempt DESC LIMIT 1)`,
    )
    .bind(
      stats.host,
      stats.lane,
      stats.image,
      stats.exitCode,
      stats.outOfMemory ? 1 : 0,
      stats.runMs,
      stats.samples,
      sampled ? (stats.peakMemoryBytes ?? null) : null,
      sampled ? (stats.cpuSeconds ?? null) : null,
      sampled ? (stats.cpuPeak ?? null) : null,
      sampled ? (stats.diskWrittenBytes ?? null) : null,
      jobId,
      stats.workerId,
    )
    .run();
  return result.meta.changes > 0;
}

interface TryRow {
  job_id: string;
  type: JobTry["jobType"];
  owner_id: string;
  target_id: string | null;
  attempt: number;
  worker_id: string;
  host: string | null;
  lane: string | null;
  image: string | null;
  queued_at: string;
  claimed_at: string;
  ended_at: string | null;
  queue_wait_ms: number;
  stage: string;
  stage_ms: string;
  status: JobTry["status"];
  failure_category: JobTry["failureCategory"];
  failure_cause: string | null;
  nodes: number | null;
  elements: number | null;
  dofs: number | null;
  solver: string | null;
  analysis: string | null;
  exit_code: number | null;
  out_of_memory: number | null;
  run_ms: number | null;
  peak_memory_bytes: number | null;
  cpu_seconds: number | null;
  cpu_peak: number | null;
  disk_written_bytes: number | null;
}

function toTry(row: TryRow): JobTry {
  const signal = row.exit_code !== null && row.exit_code > 128 ? row.exit_code - 128 : null;
  return {
    jobId: row.job_id,
    jobType: row.type,
    ownerId: row.owner_id,
    targetId: row.target_id,
    attempt: row.attempt,
    workerId: row.worker_id,
    host: row.host,
    lane: row.lane,
    image: row.image,
    queuedAt: row.queued_at,
    claimedAt: row.claimed_at,
    endedAt: row.ended_at,
    queueWaitMs: Math.max(0, row.queue_wait_ms),
    stageMs: JSON.parse(row.stage_ms) as Record<string, number>,
    lastStage: row.stage,
    status: row.status,
    failureCategory: row.failure_category,
    failureCause: row.failure_cause,
    nodes: row.nodes,
    elements: row.elements,
    dofs: row.dofs,
    solver: row.solver,
    analysis: row.analysis,
    exitCode: row.exit_code,
    signal,
    outOfMemory: row.out_of_memory === null ? null : row.out_of_memory === 1,
    runMs: row.run_ms,
    peakMemoryBytes: row.peak_memory_bytes,
    cpuSeconds: row.cpu_seconds,
    cpuAverage:
      row.cpu_seconds === null || row.run_ms === null || row.run_ms === 0
        ? null
        : Number((row.cpu_seconds / (row.run_ms / 1000)).toFixed(3)),
    cpuPeak: row.cpu_peak,
    diskWrittenBytes: row.disk_written_bytes,
  };
}

/** Which tries to list: of one job, of the jobs of one record (a run), or all, before a time. */
export interface TryFilter {
  jobId?: string;
  targetId?: string;
  /** Only tries claimed before this ISO 8601 time, to page on. */
  before?: string;
  limit: number;
}

/** Tries newest first, for the admin (M12.3; M13's dashboard and exports read the same). */
export async function listTries(db: D1Database, filter: TryFilter): Promise<JobTry[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  if (filter.jobId !== undefined) {
    where.push("job_stats.job_id = ?");
    values.push(filter.jobId);
  }
  if (filter.targetId !== undefined) {
    where.push("jobs.target_id = ?");
    values.push(filter.targetId);
  }
  if (filter.before !== undefined) {
    where.push("job_stats.claimed_at < ?");
    values.push(filter.before);
  }
  const { results } = await db
    .prepare(
      `SELECT job_stats.*, jobs.type, jobs.owner_id, jobs.target_id,
              CAST(ROUND((julianday(job_stats.claimed_at) - julianday(job_stats.queued_at)) * 86400000) AS INTEGER)
                AS queue_wait_ms
         FROM job_stats JOIN jobs ON jobs.id = job_stats.job_id
        ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY job_stats.claimed_at DESC, job_stats.id DESC LIMIT ?`,
    )
    .bind(...values, filter.limit)
    .all<TryRow>();
  return results.map(toTry);
}

/** Records the host's load from a check-in. */
export async function recordHostLoad(db: D1Database, host: string, load: HostLoad): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO host_stats
         (host, at, cpu, steal, load1, load5, load15, memory_total_bytes, memory_available_bytes,
          disk_total_bytes, disk_free_bytes, containers)
       VALUES (?, ${NOW}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      host,
      load.cpu ?? null,
      load.steal ?? null,
      load.load1,
      load.load5,
      load.load15,
      load.memoryTotalBytes,
      load.memoryAvailableBytes,
      load.diskTotalBytes,
      load.diskFreeBytes,
      load.containers,
    )
    .run();
}

interface HostRow {
  host: string;
  at: string;
  cpu: number | null;
  steal: number | null;
  load1: number;
  load5: number;
  load15: number;
  memory_total_bytes: number;
  memory_available_bytes: number;
  disk_total_bytes: number;
  disk_free_bytes: number;
  containers: number;
}

/** Most samples one read returns: a day of check-ins every 30 s. */
export const HOST_SAMPLES_PER_READ = 2880;

/** The host's load samples since the given time, oldest first. */
export async function listHostLoad(db: D1Database, since: string): Promise<HostLoadSample[]> {
  const { results } = await db
    .prepare("SELECT * FROM host_stats WHERE at >= ? ORDER BY at, host LIMIT ?")
    .bind(since, HOST_SAMPLES_PER_READ)
    .all<HostRow>();
  return results.map((row) => ({
    host: row.host,
    at: row.at,
    cpu: row.cpu,
    steal: row.steal,
    load1: row.load1,
    load5: row.load5,
    load15: row.load15,
    memoryTotalBytes: row.memory_total_bytes,
    memoryAvailableBytes: row.memory_available_bytes,
    diskTotalBytes: row.disk_total_bytes,
    diskFreeBytes: row.disk_free_bytes,
    containers: row.containers,
  }));
}

/** Removes host load samples older than HOST_STATS_DAYS. Returns how many. */
export async function purgeHostLoad(db: D1Database): Promise<number> {
  const result = await db
    .prepare(`DELETE FROM host_stats WHERE at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${HOST_STATS_DAYS} days')`)
    .run();
  return result.meta.changes;
}
