// SPDX-License-Identifier: AGPL-3.0-or-later
// What one user, and everyone together, may queue (M11.3, ADR-112), and the one place the launcher
// runs from a request: after a route that queued a job. Every route that queues a job checks
// `queueRefusal` first and is wrapped in `launchesMachines`.

import type { JobType } from "@clearfea/spec";
import type { Context, MiddlewareHandler } from "hono";
import { laneOf, queueCounts } from "../db/jobs";
import { cloudMachines } from "../db/machines";
import { queueLimits } from "../db/settings";
import type { Env } from "../env";
import { ensureMachines } from "../launcher";
import { VERIFICATION_USER_ID } from "../session/verification";

const LANE_WORK = { solve: "runs", light: "imports, meshes and reports" } as const;

/**
 * Why a job of this type may not be queued for the user now, in plain words, or null when it
 * may. Checked before the job is queued, not in one statement with it, so two requests at the
 * same moment can each pass and queue one job over a limit; the limits only keep the queue fair.
 * The daily run count leaves out the verification account, whose quick live check alone starts
 * about 30 runs.
 */
export async function queueRefusal(env: Env, userId: string, type: JobType): Promise<string | null> {
  const lane = laneOf(type);
  const [limits, counts] = await Promise.all([queueLimits(env.DB), queueCounts(env.DB, userId, lane)]);
  if (counts.allWaiting >= limits.totalCap) {
    return `The solver queue is full: ${counts.allWaiting} jobs are waiting. Try again in a few minutes.`;
  }
  if (counts.userWaiting >= limits.waitingPerUser) {
    return `You already have ${counts.userWaiting} ${LANE_WORK[lane]} waiting to start, the most one account may queue. Wait for one to start, or cancel one, then try again.`;
  }
  if (type === "solve" && userId !== VERIFICATION_USER_ID && counts.runsToday >= limits.runsPerDay) {
    return `You have started ${counts.runsToday} runs today, the most one account may start in a day. Runs can be started again after midnight UTC.`;
  }
  return null;
}

/** The refusal as the API's answer: 429, since waiting is what fixes it. */
export function refused(c: Context, problem: string): Response {
  return c.json({ error: problem }, 429);
}

/**
 * Runs after a route that queues a job: on cloud machines the launcher then starts a machine for
 * it, after the answer has gone (M10.7, ADR-100). Only these routes and the per-minute cron run
 * the launcher (M11.3, ADR-112); polls and other changes never do.
 */
export const launchesMachines: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  await next();
  if (c.res.status >= 400 || !cloudMachines(c.env)) return;
  let context: typeof c.executionCtx;
  try {
    context = c.executionCtx;
  } catch {
    return; // no execution context: app.request in tests, where nothing may reach AWS
  }
  context.waitUntil(
    ensureMachines(c.env).catch((error) => console.error("The launcher failed after a request:", error)),
  );
};
