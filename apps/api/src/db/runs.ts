// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs (docs/ARCHITECTURE.md section 4, ADR-030). Functions used on behalf of a user take the
// user id and filter on owner_id. recordRunOutcome is called for a job the worker holds, and
// touches only that job's own run. A run's spec and mesh are written once, at creation.

import type { JobStatus, RunStatus, SimulationSpec, SolveResult } from "@clearfea/spec";
import { getJob, type Job, newJob } from "./jobs";

export interface Run {
  id: string;
  ownerId: string;
  simulationId: string;
  meshId: string;
  spec: SimulationSpec;
  status: RunStatus;
  problem: string | null;
  result: SolveResult | null;
  jobId: string;
  /** The solve job's status and stage, for the stage line the owner sees. */
  jobStatus: JobStatus;
  jobStage: string | null;
  createdAt: string;
  finishedAt: string | null;
}

interface RunRow {
  id: string;
  owner_id: string;
  simulation_id: string;
  mesh_id: string;
  spec: string;
  status: RunStatus;
  problem: string | null;
  result: string | null;
  job_id: string;
  job_status: JobStatus;
  job_stage: string | null;
  created_at: string;
  finished_at: string | null;
}

function toRun(row: RunRow): Run {
  return {
    id: row.id,
    ownerId: row.owner_id,
    simulationId: row.simulation_id,
    meshId: row.mesh_id,
    spec: JSON.parse(row.spec),
    status: row.status,
    problem: row.problem,
    result: row.result === null ? null : JSON.parse(row.result),
    jobId: row.job_id,
    jobStatus: row.job_status,
    jobStage: row.job_stage,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

const SELECT = `SELECT runs.*, jobs.status AS job_status, jobs.stage AS job_stage
                  FROM runs JOIN jobs ON jobs.id = runs.job_id`;

/** The files of a run in R2. */
export type RunFile = "deck.inp" | "solver.log" | "results.frd" | "results.dat";

export function runKey(ownerId: string, runId: string, file: RunFile): string {
  return `owners/${ownerId}/runs/${runId}/${file}`;
}

/**
 * Records a run with its frozen spec and queues its solve job, in one batch so a run never
 * exists without its job. The run is inserted only while the mesh is the user's and ready;
 * returns null otherwise. The caller has checked that the simulation is the user's and that
 * the mesh is the simulation's current one.
 */
export async function createRun(
  db: D1Database,
  userId: string,
  request: { simulationId: string; meshId: string; spec: SimulationSpec },
): Promise<{ run: Run; job: Job } | null> {
  const id = crypto.randomUUID();
  const job = newJob(db, userId, "solve", id, { meshId: request.meshId, spec: request.spec });
  const [, inserted] = await db.batch([
    job.statement,
    db
      .prepare(
        `INSERT INTO runs (id, owner_id, simulation_id, mesh_id, spec, job_id)
         SELECT ?, ?, ?, id, ?, ? FROM meshes WHERE id = ? AND owner_id = ? AND status = 'ready'`,
      )
      .bind(id, userId, request.simulationId, JSON.stringify(request.spec), job.id, request.meshId, userId),
  ]);
  if (inserted?.meta.changes !== 1) {
    // The mesh stopped being ready in between; the queued job must not run without its run.
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
  return row === null ? null : toRun(row);
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
  return results.map(toRun);
}

export type RunOutcome = { status: "succeeded"; result: SolveResult } | { status: "failed"; problem: string };

/** Applies a finished solve job to its run. Only the run's own job may change it. */
export async function recordRunOutcome(db: D1Database, job: Job, outcome: RunOutcome): Promise<void> {
  if (job.targetId === null) return;
  const succeeded = outcome.status === "succeeded";
  await db
    .prepare(
      `UPDATE runs SET status = ?, problem = ?, result = ?, finished_at = ${NOW}
        WHERE id = ? AND owner_id = ? AND job_id = ? AND status = 'solving'`,
    )
    .bind(
      outcome.status,
      succeeded ? null : outcome.problem,
      succeeded ? JSON.stringify(outcome.result) : null,
      job.targetId,
      job.ownerId,
      job.id,
    )
    .run();
}
