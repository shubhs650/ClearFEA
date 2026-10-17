// SPDX-License-Identifier: AGPL-3.0-or-later
// The signed-in user's runs, their solver logs (M1.8, ADR-030), the viewer's result files
// (M1.9, ADR-031) and the solver input and log to view or download (M1.10, ADR-032). Runs are
// started through POST /api/simulations/:id/runs; a solving run's progress is in its view and
// POST /api/runs/:id/cancel cancels it (M8.2, ADR-084). Shapes: simulation.schema.json.

import type { RunLogResponse, RunProgress, RunResponse, RunView } from "@clearfea/spec";
import { type Context, Hono } from "hono";
import { billedSeconds, costOf } from "../billing/cost";
import { readJobLog } from "../db/jobs";
import { meshKey } from "../db/meshes";
import { cancelRun, getRun, type Run, type RunFile, runKey } from "../db/runs";
import { requireUser, type SessionEnv } from "../session";

export const runs = new Hono<SessionEnv>();

runs.use("*", requireUser);

const NOT_FOUND = "There is no run with that id in your account.";

/**
 * A solving run's progress: what its time so far costs at its own rate, billed as metering
 * bills it (per started second). It counts from the claim, a little before the worker's
 * billable phase starts, so it is at most a second or so above what the run will be charged
 * for that time.
 */
function progressOf(run: Run): RunProgress | null {
  if (run.status !== "solving") return null;
  const elapsed = run.jobClaimedAt === null ? null : run.jobElapsedMs;
  return {
    startedAt: run.jobClaimedAt,
    elapsedMs: elapsed,
    costSoFar: elapsed === null || run.machine === null ? null : costOf(billedSeconds(elapsed), run.machine.ratePerHour),
    cancelling: run.stopRequested,
  };
}

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
    progress: progressOf(run),
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

/**
 * Cancels a solving run (M8.2, ADR-084). One still waiting for the worker ends at once and costs
 * nothing; one the worker is on is stopped at its next heartbeat, and the time it used is charged
 * when the worker reports it. Answers the run as it is now; cancelling twice changes nothing.
 */
runs.post("/:id/cancel", async (c) => {
  const run = await getRun(c.env.DB, c.var.userId, c.req.param("id"));
  if (run === null) return c.json({ error: NOT_FOUND }, 404);
  if (run.status !== "solving") {
    return c.json({ error: "The run has already finished, so there is nothing to cancel." }, 409);
  }
  await cancelRun(c.env.DB, c.var.userId, run.id);
  const now = await getRun(c.env.DB, c.var.userId, run.id);
  if (now === null) return c.json({ error: NOT_FOUND }, 404);
  return c.json({ run: runView(now) } satisfies RunResponse);
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

/** The signed-in user's run if it has succeeded, or the response that says why not. */
async function succeededRun(c: Context<SessionEnv>): Promise<Run | Response> {
  const run = await getRun(c.env.DB, c.var.userId, c.req.param("id") ?? "");
  if (run === null) return c.json({ error: NOT_FOUND }, 404);
  if (run.status !== "succeeded") {
    const why =
      run.status === "solving"
        ? "The run is still solving. Results appear when it has finished."
        : run.status === "cancelled"
          ? "The run was cancelled, so it has no results to show. Run it again for results."
          : "The run failed, so it has no results to show. Fix what its message says and run again.";
    return c.json({ error: why }, 409);
  }
  return run;
}

const missing = (file: string) =>
  Response.json(
    { error: `The result file ${file} of this run is missing from storage. Run the simulation again.` },
    { status: 500 },
  );

const binary = (body: ReadableStream, size: number) =>
  new Response(body, {
    headers: { "Content-Type": "application/octet-stream", "Content-Length": String(size) },
  });

const RESULT_HEADER = 16;
const RESULT_FIELD = 36;

/**
 * The viewer's files of a succeeded run, read from its owner's storage. The owner's routes below
 * and the share link's (routes/shareLinks.ts, M8.7) serve the same files through these.
 */
export const resultFiles = {
  /** One of the run's viewer files: surface.bin or fields.bin. */
  async file(files: R2Bucket, run: Run, file: RunFile): Promise<Response> {
    const object = await files.get(runKey(run.ownerId, run.id, file));
    if (object === null) return missing(file);
    return binary(object.body, object.size);
  },

  /**
   * The run's volume mesh (packages/spec/volume-mesh.md): the mesh it was solved on, which runs
   * share and never change (ADR-047), for cut planes (M3.4, ADR-053).
   */
  async mesh(files: R2Bucket, run: Run): Promise<Response> {
    const object = await files.get(meshKey(run.ownerId, run.meshId, "mesh.bin"));
    if (object === null) return missing("mesh.bin");
    return binary(object.body, object.size);
  },

  /**
   * Result values at every node of the run's mesh (packages/spec/result-fields.md, vertex v is
   * node v of mesh.bin), for cut planes (M3.4, ADR-053). With a field name the reply is a
   * result-fields file holding that one field, read from storage by range, so the viewer fetches
   * only what it draws: on the largest models the whole file is hundreds of megabytes.
   */
  async nodes(files: R2Bucket, run: Run, name: string | undefined): Promise<Response> {
    if (!run.files.includes("nodes.bin")) {
      return Response.json(
        {
          error:
            "This run was solved before ClearFEA kept results inside the body, so it cannot be cut. Run the simulation again to use a cut plane.",
        },
        { status: 404 },
      );
    }
    const key = runKey(run.ownerId, run.id, "nodes.bin");
    if (name === undefined) {
      const object = await files.get(key);
      if (object === null) return missing("nodes.bin");
      return binary(object.body, object.size);
    }
    const head = await files.get(key, { range: { offset: 0, length: RESULT_HEADER } });
    if (head === null) return missing("nodes.bin");
    const header = new DataView(await head.arrayBuffer());
    const nodes = header.getUint32(8, true);
    const count = header.getUint32(12, true);
    const tableBytes = count * RESULT_FIELD;
    const table = await files.get(key, { range: { offset: RESULT_HEADER, length: tableBytes } });
    if (table === null) return missing("nodes.bin");
    const rows = new Uint8Array(await table.arrayBuffer());
    let offset = RESULT_HEADER + tableBytes;
    for (let k = 0; k < count; k++) {
      const row = rows.subarray(k * RESULT_FIELD, (k + 1) * RESULT_FIELD);
      const components = new DataView(row.buffer, row.byteOffset + 32, 4).getUint32(0, true);
      const length = nodes * components * 4;
      const rowName = new TextDecoder().decode(row.subarray(0, 16)).replace(/\0+$/, "");
      if (rowName !== name) {
        offset += length;
        continue;
      }
      const values = await files.get(key, { range: { offset, length } });
      if (values === null) return missing("nodes.bin");
      // The same layout with a one-row table: header, this field's row, its values.
      const prefix = new Uint8Array(RESULT_HEADER + RESULT_FIELD);
      prefix.set(new Uint8Array(header.buffer));
      new DataView(prefix.buffer).setUint32(12, 1, true);
      prefix.set(row, RESULT_HEADER);
      const reader = values.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(prefix);
        },
        async pull(controller) {
          const chunk = await reader.read();
          if (chunk.done) controller.close();
          else controller.enqueue(chunk.value);
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
      });
      return binary(body, prefix.length + length);
    }
    return Response.json({ error: `This run has no result field named ${name}.` }, { status: 404 });
  },
};

/** Serves one of a finished run's viewer files; a run that has not succeeded has none. */
async function viewerFile(c: Context<SessionEnv>, file: RunFile): Promise<Response> {
  const run = await succeededRun(c);
  return run instanceof Response ? run : resultFiles.file(c.env.FILES, run, file);
}

/** The mesh's outer surface, in the display mesh format (packages/spec/display-mesh.md). */
runs.get("/:id/surface", (c) => viewerFile(c, "surface.bin"));

/** Result values at each surface vertex (packages/spec/result-fields.md). */
runs.get("/:id/fields", (c) => viewerFile(c, "fields.bin"));

/** The volume mesh the run was solved on, for cut planes (M3.4, ADR-053). */
runs.get("/:id/mesh", async (c) => {
  const run = await succeededRun(c);
  return run instanceof Response ? run : resultFiles.mesh(c.env.FILES, run);
});

/** Result values at every node of the run's mesh, whole or with ?field=<name> one field. */
runs.get("/:id/nodes", async (c) => {
  const run = await succeededRun(c);
  return run instanceof Response ? run : resultFiles.nodes(c.env.FILES, run, c.req.query("field"));
});

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
