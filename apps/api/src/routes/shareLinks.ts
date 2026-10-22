// SPDX-License-Identifier: AGPL-3.0-or-later
// Read-only share links of runs (M8.7, ADR-083). The owner makes, reads and revokes a run's link
// under /api/runs/:id/share; anyone holding the link reads the run's results under
// /api/shared/:token without signing in, and nothing else: no other run, no setup, no files
// beyond what the result view draws, and nothing that changes data. A revoked, replaced or
// mistyped token answers like one that never existed. Shapes: simulation.schema.json.

import type {
  CreatedShareLinkResponse,
  ShareLinkResponse,
  SharedRunResponse,
  SharedRunView,
} from "@clearfea/spec";
import { type Context, Hono } from "hono";
import type { Env } from "../env";
import { geometryKey } from "../db/geometries";
import { getProject } from "../db/projects";
import { getRun, type Run } from "../db/runs";
import { createShareLink, getShareLink, newShareToken, resolveShareLink, revokeShareLink } from "../db/shareLinks";
import { getSimulation } from "../db/simulations";
import { requireUser, type SessionEnv } from "../session";
import { projectUnitSystem } from "./projects";
import { resultFiles } from "./runs";

/** The owner's routes, mounted under /api/runs. */
export const shareLinks = new Hono<SessionEnv>();

shareLinks.use("*", requireUser);

const NOT_FOUND = "There is no run with that id in your account.";

shareLinks.get("/:id/share", async (c) => {
  const runId = c.req.param("id");
  if ((await getRun(c.env.DB, c.var.userId, runId)) === null) return c.json({ error: NOT_FOUND }, 404);
  return c.json({ share: await getShareLink(c.env.DB, c.var.userId, runId) } satisfies ShareLinkResponse);
});

/** Makes a new link for a succeeded run; the run's earlier link stops working. */
shareLinks.post("/:id/share", async (c) => {
  const run = await getRun(c.env.DB, c.var.userId, c.req.param("id"));
  if (run === null) return c.json({ error: NOT_FOUND }, 404);
  if (run.status !== "succeeded") {
    const why =
      run.status === "solving"
        ? "The run is still solving. Share it when it has finished."
        : "The run failed, so it has no results to share. Fix what its message says and run again.";
    return c.json({ error: why }, 409);
  }
  const token = newShareToken();
  const share = await createShareLink(c.env.DB, c.var.userId, run.id, token);
  if (share === null) return c.json({ error: NOT_FOUND }, 404);
  return c.json({ share, token } satisfies CreatedShareLinkResponse, 201);
});

/** Revokes the run's link; anyone who opens it afterwards is told it does not work. */
shareLinks.delete("/:id/share", async (c) => {
  const runId = c.req.param("id");
  if ((await getRun(c.env.DB, c.var.userId, runId)) === null) return c.json({ error: NOT_FOUND }, 404);
  await revokeShareLink(c.env.DB, c.var.userId, runId);
  return c.json({ share: null } satisfies ShareLinkResponse);
});

/** The routes a link opens, mounted under /api/shared; no sign-in. */
export const shared = new Hono<{ Bindings: Env }>();

export const LINK_NOT_WORKING =
  "This share link does not work: it was revoked by the person who shared it, or it is not complete. Ask them for a new link.";

/** The succeeded run the link's token opens, read as its owner, or the 404 that says it does not work. */
async function sharedRun(c: Context<{ Bindings: Env }>): Promise<Run | Response> {
  const link = await resolveShareLink(c.env.DB, c.req.param("token") ?? "");
  const run = link === null ? null : await getRun(c.env.DB, link.ownerId, link.runId);
  if (run === null || run.status !== "succeeded" || run.result === null) {
    return c.json({ error: LINK_NOT_WORKING }, 404);
  }
  return run;
}

function sharedView(run: Run): SharedRunView {
  if (run.result === null) throw new Error("A shared run has a result.");
  return {
    id: run.id,
    spec: run.spec,
    mesh: run.mesh,
    software: run.software,
    status: "succeeded",
    result: run.result,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
  };
}

shared.get("/:token", async (c) => {
  const run = await sharedRun(c);
  if (run instanceof Response) return run;
  const simulation = await getSimulation(c.env.DB, run.ownerId, run.simulationId);
  // The unit system of the simulation's own project (ADR-114).
  const project = simulation === null ? null : await getProject(c.env.DB, run.ownerId, simulation.projectId);
  return c.json({
    run: sharedView(run),
    simulationName: simulation?.name ?? "Simulation",
    unitSystem: projectUnitSystem(project),
  } satisfies SharedRunResponse);
});

/** The faces and bodies of the run's geometry, which the viewer names and hides bodies by. */
shared.get("/:token/topology", async (c) => {
  const run = await sharedRun(c);
  if (run instanceof Response) return run;
  const object = await c.env.FILES.get(geometryKey(run.ownerId, run.spec.geometryId, "topology.json"));
  if (object === null) {
    return c.json({ error: "The geometry of this run is missing from storage, so its faces cannot be named." }, 500);
  }
  return new Response(object.body, {
    headers: { "Content-Type": "application/json", "Content-Length": String(object.size) },
  });
});

shared.get("/:token/surface", async (c) => {
  const run = await sharedRun(c);
  return run instanceof Response ? run : resultFiles.file(c.env.FILES, run, "surface.bin");
});

shared.get("/:token/fields", async (c) => {
  const run = await sharedRun(c);
  return run instanceof Response ? run : resultFiles.file(c.env.FILES, run, "fields.bin");
});

shared.get("/:token/mesh", async (c) => {
  const run = await sharedRun(c);
  return run instanceof Response ? run : resultFiles.mesh(c.env.FILES, run);
});

shared.get("/:token/nodes", async (c) => {
  const run = await sharedRun(c);
  return run instanceof Response ? run : resultFiles.nodes(c.env.FILES, run, c.req.query("field"));
});
