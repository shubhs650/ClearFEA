// SPDX-License-Identifier: AGPL-3.0-or-later
// Internal routes used by the job worker (docs/ARCHITECTURE.md sections 6 and 8).
// Authenticated by the shared worker token, never by a user session.
// Request and response shapes are the schemas in packages/spec/schemas/jobs.schema.json.

import {
  type ClaimResponse,
  type CompleteResponse,
  type HeartbeatResponse,
  type Validation,
  validateClaimRequest,
  validateCompleteRequest,
  validateHeartbeatRequest,
} from "@clearfea/spec";
import { Hono } from "hono";
import { claimJob, completeJob, type Job, recordHeartbeat } from "./db/jobs";
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

/** Reads and checks a JSON body; returns the value or a plain-language 400 message. */
async function readBody<T>(
  request: Request,
  validate: (value: unknown) => Validation<T>,
  name: string,
): Promise<{ value: T } | { error: string }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { error: `The request body must be JSON (a ${name}).` };
  }
  const checked = validate(body);
  if (checked.ok) return { value: checked.value };
  return {
    error: `The request body is not a valid ${name} (packages/spec/schemas/jobs.schema.json): ${checked.errors.join(" ")}`,
  };
}

function payload(job: Job) {
  return { id: job.id, type: job.type, targetId: job.targetId };
}

internal.post("/jobs/claim", async (c) => {
  const body = await readBody(c.req.raw, validateClaimRequest, "ClaimRequest");
  if ("error" in body) return c.json({ error: body.error }, 400);
  const job = await claimJob(c.env.DB, body.value.workerId, body.value.jobTypes);
  if (job === null) return c.body(null, 204);
  return c.json({ job: payload(job) } satisfies ClaimResponse);
});

internal.post("/jobs/:id/heartbeat", async (c) => {
  const body = await readBody(c.req.raw, validateHeartbeatRequest, "HeartbeatRequest");
  if ("error" in body) return c.json({ error: body.error }, 400);
  const { workerId, stage = null } = body.value;
  const outcome = await recordHeartbeat(c.env.DB, workerId, c.req.param("id"), stage);
  if (!outcome.found) return c.json({ error: "This worker holds no job with that id." }, 404);
  return c.json({ action: outcome.action } satisfies HeartbeatResponse);
});

internal.post("/jobs/:id/complete", async (c) => {
  const body = await readBody(c.req.raw, validateCompleteRequest, "CompleteRequest");
  if ("error" in body) return c.json({ error: body.error }, 400);
  const request = body.value;
  const completion =
    request.status === "succeeded"
      ? { status: request.status, result: request.result ?? null }
      : {
          status: request.status,
          failureCategory: request.failureCategory,
          failureCause: request.failureCause,
        };
  const job = await completeJob(c.env.DB, request.workerId, c.req.param("id"), completion);
  if (job === null) {
    return c.json({ error: "This worker holds no active job with that id; it may have been cancelled." }, 409);
  }
  return c.json({ job: { ...payload(job), status: job.status } } satisfies CompleteResponse);
});
