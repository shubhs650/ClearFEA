// SPDX-License-Identifier: AGPL-3.0-or-later
// Internal routes used by the job worker (docs/ARCHITECTURE.md sections 6 and 8).
// Authenticated by the shared worker token, never by a user session.
// Request and response shapes are the schemas in packages/spec/schemas/jobs.schema.json.

import {
  type ClaimResponse,
  type CompleteRequest,
  type CompleteResponse,
  type HeartbeatResponse,
  validateClaimRequest,
  validateCompleteRequest,
  validateHeartbeatRequest,
  validateImportResult,
  validateMeshResult,
  validateSolveResult,
} from "@clearfea/spec";
import { Hono } from "hono";
import { readBody } from "./body";
import { recordImportOutcome } from "./db/geometries";
import {
  appendJobLog,
  type Completion,
  claimJob,
  completeJob,
  getClaimedJob,
  type Job,
  recordHeartbeat,
} from "./db/jobs";
import { recordMeshOutcome } from "./db/meshes";
import { recordRunOutcome } from "./db/runs";
import type { Env } from "./env";
import { jobFiles, transfers } from "./jobs/files";

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

/** Largest file a job may upload through the pass-through route. */
export const MAX_JOB_UPLOAD_BYTES = 200 * 1024 * 1024;

function payload(job: Job) {
  return { id: job.id, type: job.type, targetId: job.targetId };
}

internal.post("/jobs/claim", async (c) => {
  const body = await readBody(c.req.raw, validateClaimRequest, "ClaimRequest", SCHEMA);
  if ("error" in body) return c.json({ error: body.error }, 400);
  const { workerId } = body.value;
  const job = await claimJob(c.env.DB, workerId, body.value.jobTypes);
  if (job === null) return c.body(null, 204);
  const origin = new URL(c.req.url).origin;
  return c.json({
    job: { ...payload(job), params: job.params, transfers: transfers(job, workerId, origin) },
  } satisfies ClaimResponse);
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
  await c.env.FILES.put(held.file.key, await c.req.arrayBuffer());
  return c.json({ stored: held.file.name });
});

/** The result check of each job type whose result a record depends on. */
const resultChecks: Partial<Record<Job["type"], (result: unknown) => { ok: boolean }>> = {
  import: validateImportResult,
  mesh: validateMeshResult,
  solve: validateSolveResult,
};

/**
 * The completion to record. A succeeded import, mesh or solve job whose result or output files are
 * not what its contract says becomes a platform fault, so a geometry or mesh never turns
 * ready on outputs the viewer or a later job cannot read.
 */
async function checkedCompletion(
  env: Env,
  job: Job,
  request: CompleteRequest,
): Promise<Completion> {
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

function validatedImportResult(result: unknown) {
  const checked = validateImportResult(result);
  if (!checked.ok) throw new Error("checkedCompletion lets only valid import results through.");
  return checked.value;
}

function validatedMeshResult(result: unknown) {
  const checked = validateMeshResult(result);
  if (!checked.ok) throw new Error("checkedCompletion lets only valid mesh results through.");
  return checked.value;
}

function validatedSolveResult(result: unknown) {
  const checked = validateSolveResult(result);
  if (!checked.ok) throw new Error("checkedCompletion lets only valid solve results through.");
  return checked.value;
}

/** What the owner is told about a failed job: the worker's message when it is their fault. */
function problem(completion: Completion & { status: "failed" }, ours: string): string {
  if (completion.failureCategory === "user_fault" && completion.failureMessage) {
    return completion.failureMessage;
  }
  return ours.replace("{cause}", completion.failureCause);
}

const IMPORT_FAULT =
  "The import stopped because of a fault in ClearFEA, not in your file ({cause}). Upload the file again; if it fails again, report it.";
const RUN_FAULT =
  "The run stopped because of a fault in ClearFEA, not in your setup ({cause}). The solver log shows what happened. Run it again; if it fails again, report it.";
const MESH_FAULT =
  "Meshing stopped because of a fault in ClearFEA, not in your setup ({cause}). Generate the mesh again; if it fails again, report it.";

internal.post("/jobs/:id/heartbeat", async (c) => {
  const body = await readBody(c.req.raw, validateHeartbeatRequest, "HeartbeatRequest", SCHEMA);
  if ("error" in body) return c.json({ error: body.error }, 400);
  const { workerId, stage = null, log = "" } = body.value;
  const jobId = c.req.param("id");
  const outcome = await recordHeartbeat(c.env.DB, workerId, jobId, stage);
  if (!outcome.found) return c.json({ error: "This worker holds no job with that id." }, 404);
  await appendJobLog(c.env.DB, jobId, log);
  return c.json({ action: outcome.action } satisfies HeartbeatResponse);
});

internal.post("/jobs/:id/complete", async (c) => {
  const body = await readBody(c.req.raw, validateCompleteRequest, "CompleteRequest", SCHEMA);
  if ("error" in body) return c.json({ error: body.error }, 400);
  const request = body.value;
  const gone = "This worker holds no active job with that id; it may have been cancelled.";
  const held = await getClaimedJob(c.env.DB, request.workerId, c.req.param("id"));
  if (held === null) return c.json({ error: gone }, 409);
  const completion = await checkedCompletion(c.env, held, request);
  const job = await completeJob(c.env.DB, request.workerId, held.id, completion);
  if (job === null) return c.json({ error: gone }, 409);
  if (job.type === "import") {
    await recordImportOutcome(
      c.env.DB,
      job,
      completion.status === "succeeded"
        ? { status: "succeeded", result: validatedImportResult(completion.result) }
        : { status: "failed", problem: problem(completion, IMPORT_FAULT) },
    );
  }
  if (job.type === "mesh") {
    await recordMeshOutcome(
      c.env.DB,
      job,
      completion.status === "succeeded"
        ? { status: "succeeded", result: validatedMeshResult(completion.result) }
        : { status: "failed", problem: problem(completion, MESH_FAULT) },
    );
  }
  if (job.type === "solve") {
    await recordRunOutcome(
      c.env.DB,
      job,
      completion.status === "succeeded"
        ? { status: "succeeded", result: validatedSolveResult(completion.result) }
        : { status: "failed", problem: problem(completion, RUN_FAULT) },
    );
  }
  return c.json({ job: { ...payload(job), status: job.status } } satisfies CompleteResponse);
});
