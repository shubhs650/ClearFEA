// SPDX-License-Identifier: AGPL-3.0-or-later
// The signed-in user's jobs. Shapes: packages/spec/schemas/jobs.schema.json.
// Only a noop job can be queued here; later job types are created by the routes
// for the records they work on (geometries, meshes, runs).

import {
  type JobListResponse,
  type JobResponse,
  type JobView,
  type MachineWaitResponse,
  validateCreateJobRequest,
} from "@clearfea/spec";
import { Hono } from "hono";
import { readBody } from "../body";
import { createJob, getJob, type Job, listJobs } from "../db/jobs";
import { machineStarting } from "../launcher";
import { requireUser, type SessionEnv } from "../session";

export const jobs = new Hono<SessionEnv>();

jobs.use("*", requireUser);

function view(job: Job): JobView {
  return {
    id: job.id,
    type: job.type,
    targetId: job.targetId,
    status: job.status,
    stage: job.stage,
    failureCategory: job.failureCategory,
    failureCause: job.failureCause,
    failureMessage: job.failureMessage,
    createdAt: job.createdAt,
    claimedAt: job.claimedAt,
    finishedAt: job.finishedAt,
  };
}

jobs.post("/", async (c) => {
  const body = await readBody(
    c.req.raw,
    validateCreateJobRequest,
    "CreateJobRequest",
    "jobs.schema.json",
  );
  if ("error" in body) return c.json({ error: body.error }, 400);
  const job = await createJob(c.env.DB, c.var.userId, body.value.type);
  return c.json({ job: view(job) } satisfies JobResponse, 201);
});

jobs.get("/", async (c) => {
  const list = await listJobs(c.env.DB, c.var.userId);
  return c.json({ jobs: list.map(view) } satisfies JobListResponse);
});

// Whether a queued job of the user waits for a solver machine to start (M10.10, ADR-103).
jobs.get("/machine-wait", async (c) => {
  return c.json({ machineStarting: await machineStarting(c.env, c.var.userId) } satisfies MachineWaitResponse);
});

jobs.get("/:id", async (c) => {
  const job = await getJob(c.env.DB, c.var.userId, c.req.param("id"));
  // Another user's job answers exactly like a missing one, so ids reveal nothing.
  if (job === null) return c.json({ error: "There is no job with that id in your account." }, 404);
  return c.json({ job: view(job) } satisfies JobResponse);
});
