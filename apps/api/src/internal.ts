// SPDX-License-Identifier: AGPL-3.0-or-later
// Internal routes used by the job worker (docs/ARCHITECTURE.md sections 6 and 8).
// Authenticated by the shared worker token, never by a user session.
// Request bodies are checked by hand until packages/spec holds their schemas (M0.6).

import { Hono } from "hono";
import {
  claimJob,
  completeJob,
  type Completion,
  FAILURE_CATEGORIES,
  type FailureCategory,
  JOB_TYPES,
  type Job,
  type JobType,
  recordHeartbeat,
} from "./db/jobs";
import type { Env } from "./env";

export const internal = new Hono<{ Bindings: Env }>();

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

type Body = Record<string, unknown>;

async function readBody(request: Request): Promise<Body | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Body)
      : null;
  } catch {
    return null;
  }
}

function workerIdOf(body: Body): string | null {
  const id = body.workerId;
  return typeof id === "string" && id.length > 0 && id.length <= 200 ? id : null;
}

function isJobType(value: unknown): value is JobType {
  return typeof value === "string" && (JOB_TYPES as readonly string[]).includes(value);
}

function payload(job: Job) {
  return { id: job.id, type: job.type, targetId: job.targetId };
}

const BAD_WORKER_ID = "The request needs a workerId string (1 to 200 characters).";

internal.post("/jobs/claim", async (c) => {
  const body = await readBody(c.req.raw);
  const workerId = body && workerIdOf(body);
  if (!body || !workerId) return c.json({ error: BAD_WORKER_ID }, 400);
  const types = body.jobTypes;
  if (!Array.isArray(types) || !types.every(isJobType)) {
    return c.json({ error: `jobTypes must be a list drawn from: ${JOB_TYPES.join(", ")}.` }, 400);
  }
  const job = await claimJob(c.env.DB, workerId, types);
  if (job === null) return c.body(null, 204);
  return c.json({ job: payload(job) });
});

internal.post("/jobs/:id/heartbeat", async (c) => {
  const body = await readBody(c.req.raw);
  const workerId = body && workerIdOf(body);
  if (!body || !workerId) return c.json({ error: BAD_WORKER_ID }, 400);
  const stage = body.stage ?? null;
  if (stage !== null && typeof stage !== "string") {
    return c.json({ error: "stage must be a string or null." }, 400);
  }
  const outcome = await recordHeartbeat(c.env.DB, workerId, c.req.param("id"), stage);
  if (!outcome.found) return c.json({ error: "This worker holds no job with that id." }, 404);
  return c.json({ action: outcome.action });
});

function completionOf(body: Body): Completion | string {
  if (body.status === "succeeded") return { status: "succeeded", result: body.result ?? null };
  if (body.status === "failed") {
    const category = body.failureCategory;
    const cause = body.failureCause;
    if (
      typeof category !== "string" ||
      !(FAILURE_CATEGORIES as readonly string[]).includes(category)
    ) {
      return `failureCategory must be one of: ${FAILURE_CATEGORIES.join(", ")}.`;
    }
    if (typeof cause !== "string" || cause.length === 0) {
      return "failureCause must be a non-empty string.";
    }
    return { status: "failed", failureCategory: category as FailureCategory, failureCause: cause };
  }
  return "status must be succeeded or failed.";
}

internal.post("/jobs/:id/complete", async (c) => {
  const body = await readBody(c.req.raw);
  const workerId = body && workerIdOf(body);
  if (!body || !workerId) return c.json({ error: BAD_WORKER_ID }, 400);
  const completion = completionOf(body);
  if (typeof completion === "string") return c.json({ error: completion }, 400);
  const job = await completeJob(c.env.DB, workerId, c.req.param("id"), completion);
  if (job === null) {
    return c.json({ error: "This worker holds no active job with that id; it may have been cancelled." }, 409);
  }
  return c.json({ job: { ...payload(job), status: job.status } });
});
