// SPDX-License-Identifier: AGPL-3.0-or-later
// Internal routes used by the job worker (docs/ARCHITECTURE.md sections 6 and 8).
// Authenticated by the shared worker token, never by a user session.
// Request and response shapes are the schemas in packages/spec/schemas/jobs.schema.json.

import {
  type ClaimResponse,
  type CompleteRequest,
  type CompleteResponse,
  type HeartbeatResponse,
  type HostCheckInResponse,
  validateClaimRequest,
  validateCompleteRequest,
  validateContainerStats,
  validateHeartbeatRequest,
  validateHostCheckIn,
  validateImportResult,
  validateMeshResult,
  validateReportJobResult,
  validateSolveResult,
  type WorkerImage,
} from "@clearfea/spec";
import { Hono } from "hono";
import { chargeFor, type JobCharge } from "./billing/cost";
import { outOfMemoryFault } from "./billing/estimate";
import { readBody } from "./body";
import {
  appendJobLog,
  type Completion,
  claimJob,
  completeJob,
  getClaimedJob,
  type Job,
  recordHeartbeat,
} from "./db/jobs";
import { recordJobFailed } from "./db/events";
import { HOST_CHECK_IN_SECONDS, recordCheckIn } from "./db/hosts";
import { machineSizeExists } from "./db/machines";
import { getRun } from "./db/runs";
import { endTry, modelSize, recordContainerStats, recordHostLoad, recordStage, startTry } from "./db/stats";
import { recordContact } from "./db/workerStarts";
import type { Env } from "./env";
import { jobFiles, transfers } from "./jobs/files";
import { WORKER_IMAGE_TAG, workerImage, workerImageKey } from "./jobs/workerImage";
import { finalMachineFault, OUT_OF_MEMORY, recordOutcome, retryJob, sweepLostJobs } from "./jobs/outcome";

export const internal = new Hono<{ Bindings: Env }>();

const SCHEMA = "jobs.schema.json";

async function sha256(text: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
}

internal.use("*", async (c, next) => {
  const expected = c.env.WORKER_TOKEN;
  if (!expected) {
    return c.json(
      {
        error:
          "The API has no worker token configured. Copy apps/api/.dev.vars.example to apps/api/.dev.vars and restart the API.",
      },
      503,
    );
  }
  const header = c.req.header("Authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  // Compare digests so the comparison takes the same time whatever the input length.
  const match = crypto.subtle.timingSafeEqual(await sha256(given), await sha256(expected));
  if (!match) {
    return c.json(
      { error: "The worker token is missing or wrong. Check CLEARFEA_WORKER_TOKEN on the worker." },
      401,
    );
  }
  await next();
});

/**
 * Largest file a job may upload through the pass-through route: 5 GiB, the most one R2 PUT
 * stores. A modal run at its element limit writes about 1 GB of raw output (M9.1).
 */
export const MAX_JOB_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;

function payload(job: Job) {
  return { id: job.id, type: job.type, targetId: job.targetId };
}

internal.post("/jobs/claim", async (c) => {
  const body = await readBody(c.req.raw, validateClaimRequest, "ClaimRequest", SCHEMA);
  if ("error" in body) return c.json({ error: body.error }, 400);
  const { workerId } = body.value;
  // A machine the launcher started is alive while it asks (M10.7, ADR-100).
  await recordContact(c.env.DB, workerId);
  // A job this worker still holds was lost when it restarted (it asks only when it holds none),
  // so it is failed first and never left solving (M8.4). Silent workers' jobs are failed by the
  // per-minute cron only (M11.3, ADR-112).
  await sweepLostJobs(c.env, workerId);
  const { machineSize } = body.value;
  if (machineSize !== undefined && !(await machineSizeExists(c.env.DB, machineSize))) {
    return c.json(
      { error: `There is no machine size called ${machineSize}. Set CLEARFEA_MACHINE_SIZE to one in machine_sizes.` },
      400,
    );
  }
  const job = await claimJob(c.env.DB, workerId, body.value.jobTypes, body.value.software ?? null, machineSize ?? null);
  if (job === null) return c.body(null, 204);
  await startTry(c.env.DB, job);
  const origin = new URL(c.req.url).origin;
  return c.json({
    job: { ...payload(job), params: job.params, transfers: await transfers(job, workerId, origin, c.env) },
  } satisfies ClaimResponse);
});

/**
 * The solver host's compute manager says it is up (M12.4, ADR-120), at start and every
 * HOST_CHECK_IN_SECONDS. With MACHINES=vps, new jobs are refused while no host has checked in for
 * 2 minutes. Accepted in every mode, so a manager can be pointed at any API.
 */
internal.post("/hosts/check-in", async (c) => {
  const body = await readBody(c.req.raw, validateHostCheckIn, "HostCheckIn", SCHEMA);
  if ("error" in body) return c.json({ error: body.error }, 400);
  // Coming online and a restart of the manager are events (M13.1, ADR-125).
  await recordCheckIn(c.env.DB, body.value.host, body.value.managerVersion ?? null, body.value.startedAt ?? null);
  // Its load, kept 14 days for support (M12.3, ADR-109).
  if (body.value.load !== undefined) await recordHostLoad(c.env.DB, body.value.host, body.value.load);
  return c.json({ intervalSeconds: HOST_CHECK_IN_SECONDS } satisfies HostCheckInResponse);
});

/**
 * The worker image the solver host should run (M12.5, ADR-110, ADR-131): the deployed one, or the
 * one in ?tag= when the host pins a tag to roll back. Asked by the host's image updater, which
 * loads it between jobs.
 */
internal.get("/worker-image", async (c) => {
  const answer = await workerImage(c.env, new URL(c.req.url).origin, c.req.query("tag"));
  if ("error" in answer) return c.json({ error: answer.error }, answer.status);
  return c.json(answer.image satisfies WorkerImage);
});

/** The archive itself, when the API cannot presign R2 links (`make dev`). */
internal.get("/worker-image/archive", async (c) => {
  const tag = c.req.query("tag") ?? "";
  if (!WORKER_IMAGE_TAG.test(tag)) return c.json({ error: "Name the image in ?tag=." }, 400);
  const object = await c.env.FILES.get(workerImageKey(tag));
  if (object === null) return c.json({ error: `The worker image ${tag} is not in storage.` }, 404);
  return c.body(object.body, 200, {
    "Content-Type": "application/gzip",
    "Content-Length": String(object.size),
  });
});

/** The job's file with this name and direction, if the worker in ?worker= holds the job. */
async function heldFile(
  db: D1Database,
  jobId: string,
  name: string,
  workerId: string | undefined,
  direction: "download" | "upload",
) {
  if (!workerId) return { error: "Name the worker in ?worker= on file transfers." } as const;
  const job = await getClaimedJob(db, workerId, jobId);
  if (job === null) return { error: "This worker holds no active job with that id." } as const;
  const file = jobFiles(job).find((f) => f.name === name && f.direction === direction);
  if (file === undefined) return { error: `This job has no ${direction} named ${name}.` } as const;
  return { file } as const;
}

internal.get("/jobs/:id/files/:name", async (c) => {
  const held = await heldFile(
    c.env.DB,
    c.req.param("id"),
    c.req.param("name"),
    c.req.query("worker"),
    "download",
  );
  if ("error" in held) return c.json({ error: held.error }, 404);
  const object = await c.env.FILES.get(held.file.key);
  if (object === null) return c.json({ error: `${held.file.name} is missing from storage.` }, 404);
  return c.body(object.body, 200, {
    "Content-Type": "application/octet-stream",
    "Content-Length": String(object.size),
  });
});

internal.put("/jobs/:id/files/:name", async (c) => {
  const held = await heldFile(
    c.env.DB,
    c.req.param("id"),
    c.req.param("name"),
    c.req.query("worker"),
    "upload",
  );
  if ("error" in held) return c.json({ error: held.error }, 404);
  const length = Number(c.req.header("Content-Length") ?? Number.NaN);
  if (!(length <= MAX_JOB_UPLOAD_BYTES)) {
    return c.json(
      { error: `Send Content-Length; uploads are limited to ${MAX_JOB_UPLOAD_BYTES} bytes.` },
      413,
    );
  }
  // Streamed, not buffered: raw output at the element limits is up to about 1 GB (M9.1).
  const body = c.req.raw.body;
  if (body === null) return c.json({ error: "Send the file as the request body." }, 400);
  await c.env.FILES.put(held.file.key, body);
  return c.json({ stored: held.file.name });
});

/** The result check of each job type whose result a record depends on. */
const resultChecks: Partial<Record<Job["type"], (result: unknown) => { ok: boolean }>> = {
  import: validateImportResult,
  mesh: validateMeshResult,
  solve: validateSolveResult,
  report: validateReportJobResult,
};

/**
 * The completion to record. A succeeded import, mesh, solve or report job whose result or output files are
 * not what its contract says becomes a platform fault, so a geometry or mesh never turns
 * ready on outputs the viewer or a later job cannot read.
 */
async function checkedCompletion(
  env: Env,
  job: Job,
  request: CompleteRequest,
): Promise<Completion> {
  if (request.status === "stopped") {
    // The handler checks that the job was asked to stop before it gets here.
    return { status: job.stopRequested ?? "cancelled" };
  }
  if (request.status === "failed") {
    return {
      status: "failed",
      failureCategory: request.failureCategory,
      failureCause: request.failureCause,
      failureMessage: request.failureMessage ?? null,
    };
  }
  const result = request.result ?? null;
  const check = resultChecks[job.type];
  if (check !== undefined) {
    const fault = (failureCause: string): Completion => ({
      status: "failed",
      failureCategory: "platform_fault",
      failureCause,
      failureMessage: null,
    });
    if (!check(result).ok) return fault("invalid_result");
    const uploads = jobFiles(job).filter((f) => f.direction === "upload");
    const stored = await Promise.all(uploads.map((f) => env.FILES.head(f.key)));
    if (stored.some((object) => object === null)) return fault("outputs_missing");
  }
  return { status: "succeeded", result };
}

/** A machine size's memory as the Run panel names it: GiB, or MiB below one GiB. */
function memory(bytes: number): string {
  return bytes >= 2 ** 30 ? `${Number((bytes / 2 ** 30).toFixed(1))} GiB` : `${Math.round(bytes / 2 ** 20)} MiB`;
}

/**
 * A solve job that ran out of memory, with who pays decided here rather than by the worker
 * (DECISIONS "Failed runs", ADR-082): the user when they chose a size against the estimate, the
 * platform when it picked or would have accepted the size. Other completions pass unchanged.
 */
async function withMemoryFault(
  db: D1Database,
  job: Job,
  completion: Completion,
  peakMemoryBytes: number | null,
): Promise<Completion> {
  if (job.type !== "solve" || completion.status !== "failed" || completion.failureCause !== OUT_OF_MEMORY) {
    return completion;
  }
  const run = job.targetId === null ? null : await getRun(db, job.ownerId, job.targetId);
  const estimate = run?.estimate ?? null;
  const category = outOfMemoryFault(estimate, job.machineSize);
  const size = estimate?.sizes.find((s) => s.size === job.machineSize);
  const on = size === undefined ? `the ${job.machineSize} machine size` : `the ${size.size} machine size (${memory(size.memoryBytes)})`;
  // The peak the worker measured, or the container limit the kernel stopped it at (M12.2, ADR-108).
  const peak = peakMemoryBytes === null ? "" : ` It used ${memory(peakMemoryBytes)} at its peak.`;
  const failureMessage =
    category === "user_fault"
      ? `The run ran out of memory on ${on}, which was chosen although the estimate needs more memory than it has, so the time it used is charged.${peak} ${
          estimate?.recommended
            ? `Run it again on the recommended size, ${estimate.recommended}, or larger.`
            : "Run it again on the largest size, or make the mesh coarser or use linear elements."
        }`
      : `The run ran out of memory on ${on}, which by ClearFEA's estimate has enough memory, so the estimate was too low and the time is not charged.${peak} Run it again on a larger size; if it fails again, report it.`;
  return { ...completion, failureCategory: category, failureMessage };
}

internal.post("/jobs/:id/heartbeat", async (c) => {
  const body = await readBody(c.req.raw, validateHeartbeatRequest, "HeartbeatRequest", SCHEMA);
  if ("error" in body) return c.json({ error: body.error }, 400);
  const { workerId, stage = null, log = "" } = body.value;
  const jobId = c.req.param("id");
  const [outcome] = await Promise.all([
    recordHeartbeat(c.env.DB, workerId, jobId, stage),
    recordContact(c.env.DB, workerId),
  ]);
  if (!outcome.found) return c.json({ error: "This worker holds no job with that id." }, 404);
  await Promise.all([appendJobLog(c.env.DB, jobId, log), recordStage(c.env.DB, workerId, jobId, stage)]);
  return c.json({ action: outcome.action } satisfies HeartbeatResponse);
});

internal.post("/jobs/:id/complete", async (c) => {
  const body = await readBody(c.req.raw, validateCompleteRequest, "CompleteRequest", SCHEMA);
  if ("error" in body) return c.json({ error: body.error }, 400);
  const request = body.value;
  const gone = "This worker holds no active job with that id; it may have been cancelled.";
  const held = await getClaimedJob(c.env.DB, request.workerId, c.req.param("id"));
  if (held === null) return c.json({ error: gone }, 409);
  if (request.status === "stopped" && held.stopRequested === null) {
    return c.json({ error: "Nobody asked this job to stop. Report how it ended instead." }, 409);
  }
  const checked = await checkedCompletion(c.env, held, request);
  // A machine fault with tries left queues the job again, uncharged (M12.2, ADR-108).
  const requeued = await retryJob(c.env, held, checked);
  if (requeued !== null) {
    return c.json({ job: { ...payload(requeued), status: requeued.status } } satisfies CompleteResponse);
  }
  const { billableMs, peakMemoryBytes = null } = request.metering;
  const completion = await withMemoryFault(c.env.DB, held, finalMachineFault(held, checked), peakMemoryBytes);
  // A metered job costs its measured time at the rate it was queued with (ADR-033).
  const charge: JobCharge | null =
    held.ratePerHour === null ? null : chargeFor(billableMs, held.ratePerHour, completion);
  const job = await completeJob(c.env.DB, request.workerId, held.id, completion, billableMs, charge, peakMemoryBytes);
  if (job === null) return c.json({ error: gone }, 409);
  await endTry(c.env.DB, request.workerId, job, completion, await modelSize(c.env.DB, job, completion));
  await recordJobFailed(c.env.DB, held, completion);
  await recordOutcome(c.env, job, completion, charge);
  return c.json({ job: { ...payload(job), status: job.status } } satisfies CompleteResponse);
});

/**
 * What the compute manager measured of a job's container, once it has ended (M12.3, ADR-109):
 * added to the worker's latest try of the job still without it. The job need not be held any
 * more: it has usually completed, and may already be queued again.
 */
internal.post("/jobs/:id/stats", async (c) => {
  const body = await readBody(c.req.raw, validateContainerStats, "ContainerStats", SCHEMA);
  if ("error" in body) return c.json({ error: body.error }, 400);
  const recorded = await recordContainerStats(c.env.DB, c.req.param("id"), body.value);
  if (!recorded) return c.json({ error: "This worker has no try of that job waiting for its statistics." }, 404);
  return c.body(null, 204);
});
