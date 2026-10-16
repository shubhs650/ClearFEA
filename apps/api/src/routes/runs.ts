// SPDX-License-Identifier: AGPL-3.0-or-later
// The signed-in user's runs, their solver logs (M1.8, ADR-030), the viewer's result files
// (M1.9, ADR-031) and the solver input and log to view or download (M1.10, ADR-032). Runs are
// started through POST /api/simulations/:id/runs. Shapes: simulation.schema.json.

import type { RunLogResponse, RunResponse, RunView } from "@clearfea/spec";
import { type Context, Hono } from "hono";
import { readJobLog } from "../db/jobs";
import { getRun, type Run, type RunFile, runKey } from "../db/runs";
import { requireUser, type SessionEnv } from "../session";

export const runs = new Hono<SessionEnv>();

runs.use("*", requireUser);

const NOT_FOUND = "There is no run with that id in your account.";

export function runView(run: Run): RunView {
  return {
    id: run.id,
    simulationId: run.simulationId,
    meshId: run.meshId,
    spec: run.spec,
    mesh: run.mesh,
    software: run.software,
    files: run.files,
    machine: run.machine,
    estimate: run.estimate,
    cost: run.cost,
    status: run.status,
    stage: run.status !== "solving" ? null : run.jobStatus === "queued" ? "queued" : run.jobStage,
    problem: run.problem,
    result: run.result,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
  };
}

runs.get("/:id", async (c) => {
  const run = await getRun(c.env.DB, c.var.userId, c.req.param("id"));
  // Another user's run answers exactly like a missing one, so ids reveal nothing.
  if (run === null) return c.json({ error: NOT_FOUND }, 404);
  return c.json({ run: runView(run) } satisfies RunResponse);
});

/** The solver log written after chunk ?after= (0 for the whole log), for polling while it runs. */
runs.get("/:id/log", async (c) => {
  const raw = c.req.query("after") ?? "0";
  const after = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(after)) {
    return c.json({ error: "?after= must be a whole number of log chunks, 0 or more." }, 400);
  }
  const run = await getRun(c.env.DB, c.var.userId, c.req.param("id"));
  if (run === null) return c.json({ error: NOT_FOUND }, 404);
  const log = await readJobLog(c.env.DB, c.var.userId, run.jobId, after);
  return c.json(log satisfies RunLogResponse);
});

/** Serves one of a finished run's viewer files; a run that has not succeeded has none. */
async function viewerFile(c: Context<SessionEnv>, file: RunFile): Promise<Response> {
  const run = await getRun(c.env.DB, c.var.userId, c.req.param("id") ?? "");
  if (run === null) return c.json({ error: NOT_FOUND }, 404);
  if (run.status !== "succeeded") {
    const why =
      run.status === "solving"
        ? "The run is still solving. Results appear when it has finished."
        : "The run failed, so it has no results to show. Fix what its message says and run again.";
    return c.json({ error: why }, 409);
  }
  const object = await c.env.FILES.get(runKey(c.var.userId, run.id, file));
  if (object === null) {
    return c.json(
      { error: `The result file ${file} of this run is missing from storage. Run the simulation again.` },
      500,
    );
  }
  return c.body(object.body, 200, {
    "Content-Type": "application/octet-stream",
    "Content-Length": String(object.size),
  });
}

/** The mesh's outer surface, in the display mesh format (packages/spec/display-mesh.md). */
runs.get("/:id/surface", (c) => viewerFile(c, "surface.bin"));

/** Result values at each surface vertex (packages/spec/result-fields.md). */
runs.get("/:id/fields", (c) => viewerFile(c, "fields.bin"));

/** The run's files the owner may read as text. */
const TEXT_FILES: readonly string[] = ["deck.inp", "solver.log"] satisfies RunFile[];

/**
 * The run's solver input or solver log as plain text, shown in the browser, or with ?download=1
 * saved as a file. Both exist for a failed run too once the solver has started.
 */
runs.get("/:id/files/:name", async (c) => {
  const name = c.req.param("name") as RunFile;
  if (!TEXT_FILES.includes(name)) {
    return c.json({ error: "Only deck.inp and solver.log of a run can be viewed or downloaded." }, 404);
  }
  const run = await getRun(c.env.DB, c.var.userId, c.req.param("id"));
  if (run === null) return c.json({ error: NOT_FOUND }, 404);
  if (run.status === "solving") {
    return c.json({ error: "The run is still solving. Its input and log are stored when it has finished." }, 409);
  }
  if (!run.files.includes(name)) {
    return c.json(
      { error: `This run has no ${name}: it stopped before the solver started. Its message says what to fix.` },
      404,
    );
  }
  const object = await c.env.FILES.get(runKey(c.var.userId, run.id, name));
  if (object === null) {
    return c.json({ error: `The file ${name} of this run is missing from storage. Run the simulation again.` }, 500);
  }
  const filename = `clearfea-run-${run.id.slice(0, 8)}-${name}`;
  const disposition = c.req.query("download") === "1" ? "attachment" : "inline";
  return c.body(object.body, 200, {
    // Plain text that is never sniffed as HTML: the deck carries names the user typed.
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
    "Content-Disposition": `${disposition}; filename="${filename}"`,
    "Content-Length": String(object.size),
  });
});
