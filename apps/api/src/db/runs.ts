// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs (docs/ARCHITECTURE.md section 4, ADR-030). Functions used on behalf of a user take the
// user id and filter on owner_id. recordRunOutcome is called for a job the worker holds, and
// touches only that job's own run. A run's spec and mesh are written once, at creation; its
// versions and file list are completed once, when its job ends (ADR-032). Its machine size and
// cost are its solve job's, fixed when the job is queued and when it ends (ADR-033); its
// estimate is written once, at creation (ADR-049). Its pin and the removal of its raw solver
// output are about storage, not its inputs, and change later (M8.6, ADR-086).

import type {
  ElementOrder,
  JobStatus,
  RunCost,
  RunEstimate,
  RunMachine,
  Quantity,
  RunFileName,
  RunMesh,
  RunSoftware,
  RunStatus,
  SimulatedMachine,
  SimulationSpec,
  SolveParams,
  SolveResult,
} from "@clearfea/spec";
import { getJob, type Job, newJob } from "./jobs";
import { RETENTION_DAYS_SQL } from "./settings";

export interface Run {
  id: string;
  ownerId: string;
  simulationId: string;
  meshId: string;
  spec: SimulationSpec;
  /** The mesh as it was made; meshes do not change once ready. */
  mesh: RunMesh;
  software: RunSoftware;
  files: RunFileName[];
  /** From the solve job: its machine size and rate, and once it has ended, its cost (ADR-033). */
  machine: RunMachine | null;
  /** The estimate made when the run started; null for runs from before M2.12. */
  estimate: RunEstimate | null;
  cost: RunCost | null;
  status: RunStatus;
  problem: string | null;
  result: SolveResult | null;
  jobId: string;
  /** The solve job's status and stage, for the stage line the owner sees. */
  jobStatus: JobStatus;
  jobStage: string | null;
  /** When the worker took the solve job, and the time since then when the run was read (M8.2). */
  jobClaimedAt: string | null;
  jobElapsedMs: number | null;
  /** Whether the run has been asked to stop and its worker has not stopped yet (M8.2). */
  stopRequested: boolean;
  createdAt: string;
  finishedAt: string | null;
  /** True when the owner pinned the run, so its raw solver output is kept (M8.6). */
  pinned: boolean;
  /** When the storage sweep removed the run's raw solver output; null while it is kept. */
  rawRemovedAt: string | null;
  /** When the retention period of the run's raw output ends, or null (see rawOutputKeptUntil). */
  keptUntil: string | null;
  /** The run this one solved again to regenerate its raw output. */
  rerunOf: string | null;
}

/** The run's raw solver output: what the sweep removes after the retention period (ADR-086). */
export const RAW_OUTPUT: readonly RunFileName[] = ["results.frd", "results.dat"];

/** True when the run's job stored raw output and it has not been removed. */
export function hasRawOutput(run: Pick<Run, "files" | "rawRemovedAt">): boolean {
  return run.rawRemovedAt === null && run.files.some((f) => RAW_OUTPUT.includes(f));
}

/**
 * When the run's raw output stops being kept: the run's end plus the retention days. Null while
 * the run solves, when it is pinned, or when it has no raw output to remove.
 */
export function rawOutputKeptUntil(
  run: Pick<Run, "files" | "rawRemovedAt" | "pinned" | "finishedAt">,
  retentionDays: number,
): string | null {
  if (run.pinned || run.finishedAt === null || !hasRawOutput(run)) return null;
  return new Date(Date.parse(run.finishedAt) + retentionDays * DAY_MS).toISOString();
}

const DAY_MS = 86_400_000;

interface RunRow {
  id: string;
  owner_id: string;
  simulation_id: string;
  mesh_id: string;
  spec: string;
  software: string | null;
  files: string | null;
  estimate: string | null;
  status: RunStatus;
  problem: string | null;
  result: string | null;
  job_id: string;
  job_status: JobStatus;
  job_stage: string | null;
  job_claimed_at: string | null;
  job_elapsed_ms: number | null;
  job_stop_requested: string | null;
  job_machine_size: string | null;
  job_rate_per_hour: number | null;
  job_billed_seconds: number | null;
  job_cost: number | null;
  job_charged: number;
  mesh_size: string;
  mesh_order: ElementOrder;
  mesh_nodes: number | null;
  mesh_elements: number | null;
  created_at: string;
  finished_at: string | null;
  pinned: number;
  raw_removed_at: string | null;
  rerun_of: string | null;
  retention_days: number;
}

function toRun(row: RunRow): Run {
  return {
    id: row.id,
    ownerId: row.owner_id,
    simulationId: row.simulation_id,
    meshId: row.mesh_id,
    spec: JSON.parse(row.spec),
    mesh: {
      size: JSON.parse(row.mesh_size) as Quantity,
      order: row.mesh_order,
      nodeCount: row.mesh_nodes,
      elementCount: row.mesh_elements,
    },
    software: { ...UNKNOWN_SOFTWARE, ...(row.software === null ? {} : JSON.parse(row.software)) },
    files: row.files === null ? [] : JSON.parse(row.files),
    machine:
      row.job_machine_size === null || row.job_rate_per_hour === null
        ? null
        : { size: row.job_machine_size, ratePerHour: row.job_rate_per_hour },
    estimate: row.estimate === null ? null : JSON.parse(row.estimate),
    cost:
      row.job_billed_seconds === null || row.job_cost === null
        ? null
        : { billedSeconds: row.job_billed_seconds, amount: row.job_cost, charged: row.job_charged === 1 },
    // The runs table keeps 'failed' for every run that ended without results; the job says
    // whether its owner cancelled it (M8.2, ADR-085).
    status: row.status === "failed" && row.job_status === "cancelled" ? "cancelled" : row.status,
    problem: row.problem,
    result: row.result === null ? null : JSON.parse(row.result),
    jobId: row.job_id,
    jobStatus: row.job_status,
    jobStage: row.job_stage,
    jobClaimedAt: row.job_claimed_at,
    jobElapsedMs: row.job_elapsed_ms,
    stopRequested: row.job_stop_requested !== null && (row.job_status === "claimed" || row.job_status === "running"),
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    pinned: row.pinned === 1,
    rawRemovedAt: row.raw_removed_at,
    keptUntil: null,
    rerunOf: row.rerun_of,
  };
}

function toRunWithRetention(row: RunRow): Run {
  const run = toRun(row);
  return { ...run, keptUntil: rawOutputKeptUntil(run, row.retention_days) };
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

const SELECT = `SELECT runs.*, jobs.status AS job_status, jobs.stage AS job_stage,
                       jobs.claimed_at AS job_claimed_at, jobs.stop_requested AS job_stop_requested,
                       CASE WHEN jobs.claimed_at IS NULL THEN NULL
                            ELSE MAX(0, CAST(ROUND((julianday('now') - julianday(jobs.claimed_at)) * 86400000) AS INTEGER))
                       END AS job_elapsed_ms,
                       jobs.machine_size AS job_machine_size, jobs.rate_per_hour AS job_rate_per_hour,
                       jobs.billed_seconds AS job_billed_seconds, jobs.cost AS job_cost,
                       EXISTS (SELECT 1 FROM ledger_entries l WHERE l.job_id = jobs.id) AS job_charged,
                       meshes.size AS mesh_size, meshes.element_order AS mesh_order,
                       meshes.node_count AS mesh_nodes, meshes.element_count AS mesh_elements,
                       ${RETENTION_DAYS_SQL} AS retention_days
                  FROM runs JOIN jobs ON jobs.id = runs.job_id JOIN meshes ON meshes.id = runs.mesh_id`;

/** Versions not known: runs from before M1.10, or before the solving worker has reported. */
const UNKNOWN_SOFTWARE: RunSoftware = { clearfea: null, deckFormat: null, calculix: null, gmsh: null, occt: null };

/** The files of a run in R2. */
export type RunFile = RunFileName;

export function runKey(ownerId: string, runId: string, file: RunFile): string {
  return `owners/${ownerId}/runs/${runId}/${file}`;
}

/**
 * Records a run with its frozen spec and estimate and queues its solve job on the machine size
 * named, in one batch so a run never exists without its job. The run is inserted only while the
 * mesh is the user's and ready and the size exists; returns null otherwise. The caller has
 * checked that the simulation is the user's and that the mesh is the simulation's current one.
 */
export async function createRun(
  db: D1Database,
  userId: string,
  request: {
    simulationId: string;
    meshId: string;
    spec: SimulationSpec;
    machine: SimulatedMachine;
    estimate: RunEstimate;
    /** The run whose frozen spec and mesh this one solves again (M8.6). */
    rerunOf?: string;
  },
): Promise<{ run: Run; job: Job } | null> {
  const id = crypto.randomUUID();
  const params: SolveParams = { meshId: request.meshId, spec: request.spec, machine: request.machine };
  const job = newJob(db, userId, "solve", id, { ...params }, request.machine.size);
  const [, inserted] = await db.batch([
    job.statement,
    db
      .prepare(
        // The mesh's versions come from its own job's MeshResult.
        `INSERT INTO runs (id, owner_id, simulation_id, mesh_id, spec, job_id, estimate, rerun_of, software)
         SELECT ?, ?, ?, meshes.id, ?, ?, ?, ?,
                json_object('gmsh', json_extract(jobs.result, '$.software.gmsh'),
                            'occt', json_extract(jobs.result, '$.software.occt'))
           FROM meshes LEFT JOIN jobs ON jobs.id = meshes.job_id
          WHERE meshes.id = ? AND meshes.owner_id = ? AND meshes.status = 'ready'
            AND EXISTS (SELECT 1 FROM jobs queued WHERE queued.id = ? AND queued.owner_id = ?)`,
      )
      .bind(
        id,
        userId,
        request.simulationId,
        JSON.stringify(request.spec),
        job.id,
        JSON.stringify(request.estimate),
        request.rerunOf ?? null,
        request.meshId,
        userId,
        job.id,
        userId,
      ),
  ]);
  if (inserted?.meta.changes !== 1) {
    // The mesh stopped being ready, or the size was removed, in between; the queued job (if
    // any) must not run without its run.
    await db.prepare("DELETE FROM jobs WHERE id = ? AND owner_id = ? AND status = 'queued'").bind(job.id, userId).run();
    return null;
  }
  const [run, queued] = await Promise.all([getRun(db, userId, id), getJob(db, userId, job.id)]);
  if (run === null || queued === null) throw new Error("Inserting the run returned no row.");
  return { run, job: queued };
}

export async function getRun(db: D1Database, userId: string, runId: string): Promise<Run | null> {
  const row = await db
    .prepare(`${SELECT} WHERE runs.id = ? AND runs.owner_id = ?`)
    .bind(runId, userId)
    .first<RunRow>();
  return row === null ? null : toRunWithRetention(row);
}

/** The simulation's runs, newest first. */
export async function listRuns(db: D1Database, userId: string, simulationId: string, limit = 20): Promise<Run[]> {
  const { results } = await db
    .prepare(
      `${SELECT} WHERE runs.simulation_id = ? AND runs.owner_id = ?
        ORDER BY runs.created_at DESC, runs.id DESC LIMIT ?`,
    )
    .bind(simulationId, userId, limit)
    .all<RunRow>();
  return results.map(toRunWithRetention);
}

export type RunOutcome =
  | { status: "succeeded"; result: SolveResult }
  | { status: "failed" | "cancelled" | "stopped_at_limit"; problem: string };

/**
 * Applies a finished solve job to its run: the outcome, the files the job stored and the
 * versions of the worker that claimed it. Only the run's own job may change it.
 */
export async function recordRunOutcome(
  db: D1Database,
  job: Job,
  outcome: RunOutcome,
  files: readonly RunFileName[],
): Promise<void> {
  if (job.targetId === null) return;
  const succeeded = outcome.status === "succeeded";
  const worker = job.software;
  await db
    .prepare(
      `UPDATE runs SET status = ?, problem = ?, result = ?, files = ?, finished_at = ${NOW},
              software = json_set(COALESCE(software, '{}'),
                                  '$.clearfea', ?, '$.deckFormat', ?, '$.calculix', ?)
        WHERE id = ? AND owner_id = ? AND job_id = ? AND status = 'solving'`,
    )
    .bind(
      // Every run that ended without results is 'failed' in the table (ADR-085).
      succeeded ? "succeeded" : "failed",
      succeeded ? null : outcome.problem,
      succeeded ? JSON.stringify(outcome.result) : null,
      JSON.stringify(files),
      worker?.clearfea ?? null,
      worker?.deckFormat ?? null,
      worker?.calculix ?? null,
      job.targetId,
      job.ownerId,
      job.id,
    )
    .run();
}

/**
 * Pins or unpins the user's run (M8.6, ADR-086). A pin is refused (false) once the raw output
 * is gone, since there is nothing left to keep; unpinning always works.
 */
export async function setRunPinned(db: D1Database, userId: string, runId: string, pinned: boolean): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE runs SET pinned = ? WHERE id = ? AND owner_id = ? AND (? = 0 OR raw_removed_at IS NULL)`,
    )
    .bind(pinned ? 1 : 0, runId, userId, pinned ? 1 : 0)
    .run();
  return result.meta.changes === 1;
}

/** What cancelling a run did (M8.2). */
export type CancelOutcome = "ended" | "asked" | "finished";

/** What the owner is told about a run cancelled before the worker took it. */
const CANCELLED_QUEUED = "You cancelled the run before the solver started, so nothing was charged. Run it again for results.";

/**
 * Cancels the user's solving run, in one batch: a run whose job is still queued ends at once,
 * uncharged; a run whose job a worker holds is marked to stop, and the worker's next heartbeat
 * tells it to (it then reports the time it used, which is charged). Returns which happened, or
 * "finished" when the run had already ended (or is not the user's).
 */
export async function cancelRun(db: D1Database, userId: string, runId: string): Promise<CancelOutcome> {
  const job = "(SELECT job_id FROM runs WHERE id = ? AND owner_id = ?)";
  const [ended, , asked] = await db.batch([
    db
      .prepare(
        `UPDATE jobs
            SET status = 'cancelled', stop_requested = 'cancelled', stop_requested_at = ${NOW},
                finished_at = ${NOW}, billable_ms = 0,
                billed_seconds = CASE WHEN rate_per_hour IS NULL THEN NULL ELSE 0 END,
                cost = CASE WHEN rate_per_hour IS NULL THEN NULL ELSE 0 END
          WHERE id = ${job} AND owner_id = ? AND status = 'queued'`,
      )
      .bind(runId, userId, userId),
    db
      .prepare(
        `UPDATE runs SET status = 'failed', problem = ?, files = '[]', finished_at = ${NOW}
          WHERE id = ? AND owner_id = ? AND status = 'solving'
            AND EXISTS (SELECT 1 FROM jobs WHERE jobs.id = runs.job_id AND jobs.status = 'cancelled')`,
      )
      .bind(CANCELLED_QUEUED, runId, userId),
    db
      .prepare(
        `UPDATE jobs SET stop_requested = 'cancelled', stop_requested_at = ${NOW}
          WHERE id = ${job} AND owner_id = ? AND status IN ('claimed', 'running') AND stop_requested IS NULL`,
      )
      .bind(runId, userId, userId),
  ]);
  if ((ended?.meta.changes ?? 0) > 0) return "ended";
  if ((asked?.meta.changes ?? 0) > 0) return "asked";
  return "finished";
}
