// SPDX-License-Identifier: AGPL-3.0-or-later
// The signed-in user's geometries: STEP upload, the import's outputs, and unit confirmation
// (M1.2). Shapes: packages/spec/schemas/geometry.schema.json.

import {
  type GeometryListResponse,
  type GeometryResponse,
  type GeometryStatus,
  type GeometryView,
  unitsTable,
  validateConfirmUnitRequest,
} from "@clearfea/spec";
import { Hono } from "hono";
import { readBody } from "../body";
import {
  confirmUnit,
  createGeometry,
  type Geometry,
  type GeometryFile,
  geometryKey,
  getGeometry,
  listGeometries,
} from "../db/geometries";
import { jobWait } from "../jobs/wait";
import { requireUser, type SessionEnv } from "../session";

export const geometries = new Hono<SessionEnv>();

geometries.use("*", requireUser);

/**
 * Largest STEP file accepted: Cloudflare refuses request bodies above 100 MB on the site's plan
 * (ADR-095 item 4). The file is streamed to storage, so the Worker's memory is no limit.
 */
export const MAX_STEP_BYTES = 100 * 1000 * 1000;

const NOT_FOUND = "There is no geometry with that id in your account.";

/** Statuses in which topology.json and the display mesh exist and are current. */
const READ: readonly GeometryStatus[] = ["needs_unit", "unconfirmed", "ready"];

function view(geometry: Geometry): GeometryView {
  return {
    id: geometry.id,
    name: geometry.name,
    sizeBytes: geometry.sizeBytes,
    status: geometry.status,
    problem: geometry.problem,
    declaredUnit: geometry.declaredUnit,
    detectedUnit: geometry.detectedUnit,
    unitProblem: geometry.unitProblem,
    readingFactor: geometry.readingFactor,
    scaling: geometry.scaling,
    confirmedUnit: geometry.confirmedUnit,
    unitLocked: geometry.unitLocked,
    bodyCount: geometry.bodyCount,
    faceCount: geometry.faceCount,
    size: geometry.size,
    bbox: geometry.bbox,
    createdAt: geometry.createdAt,
  };
}

/** The file's own name without any folder part, or null if nothing usable is left. */
function fileName(raw: string | undefined): string | null {
  const name = (raw ?? "").split(/[\\/]/).pop()?.trim() ?? "";
  return name.length > 0 && name.length <= 255 ? name : null;
}

/** The first chunks of a body, at least ``bytes`` long unless the body is shorter. */
async function readStart(reader: ReadableStreamDefaultReader<Uint8Array>, bytes: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (length < bytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.byteLength;
  }
  const start = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    start.set(chunk, at);
    at += chunk.byteLength;
  }
  return start;
}

/** The whole body again: the chunks already read, then the rest from the reader. */
function rejoined(start: Uint8Array, reader: ReadableStreamDefaultReader<Uint8Array>): ReadableStream<Uint8Array> {
  let first = true;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (first) {
        first = false;
        if (start.byteLength > 0) {
          controller.enqueue(start);
          return;
        }
      }
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function looksLikeStep(head: Uint8Array): boolean {
  const text = new TextDecoder().decode(head).replace(/^[﻿\s]+/, "");
  return text.startsWith("ISO-10303-21");
}

geometries.post("/", async (c) => {
  // A cross-site HTML form cannot send this type without the browser asking first, which
  // the API never allows (the same reason JSON bodies must say application/json).
  if ((c.req.header("Content-Type") ?? "").split(";")[0]?.trim() !== "application/octet-stream") {
    return c.json(
      { error: "Send the STEP file as the request body with Content-Type: application/octet-stream." },
      415,
    );
  }
  const name = fileName(c.req.query("name"));
  if (name === null) {
    return c.json({ error: "Give the file's name in ?name=, for example ?name=bracket.step." }, 400);
  }
  const declared = Number(c.req.header("Content-Length") ?? Number.NaN);
  if (!(Number.isInteger(declared) && declared >= 0)) {
    return c.json({ error: "Send the file's size in bytes as Content-Length." }, 411);
  }
  if (declared > MAX_STEP_BYTES) {
    return c.json({ error: `The file is larger than ${MAX_STEP_BYTES / 1e6} MB, the most ClearFEA accepts.` }, 413);
  }
  // Streamed to storage, not read into memory: a Worker has 128 MB (ADR-095 item 4). Only the
  // first bytes are read here, to check that this is a STEP file before anything is stored.
  const reader = (c.req.raw.body ?? new ReadableStream<Uint8Array>()).getReader();
  const start = await readStart(reader, 64);
  if (!looksLikeStep(start.subarray(0, 64))) {
    await reader.cancel();
    return c.json(
      {
        error:
          "This is not a STEP file: it does not start with ISO-10303-21. Export the part from your CAD system as STEP (.step or .stp).",
      },
      400,
    );
  }
  const id = crypto.randomUUID();
  const key = geometryKey(c.var.userId, id, "model.step");
  try {
    await c.env.FILES.put(key, rejoined(start, reader).pipeThrough(new FixedLengthStream(declared)));
  } catch {
    await c.env.FILES.delete(key);
    return c.json(
      { error: "The upload ended before the whole file arrived, or was longer than its Content-Length. Upload it again." },
      400,
    );
  }
  const { geometry } = await createGeometry(c.env.DB, c.var.userId, {
    id,
    name,
    sizeBytes: declared,
  });
  return c.json({ geometry: view(geometry) } satisfies GeometryResponse, 201);
});

geometries.get("/", async (c) => {
  const list = await listGeometries(c.env.DB, c.var.userId);
  return c.json({ geometries: list.map(view) } satisfies GeometryListResponse);
});

geometries.get("/:id", async (c) => {
  const geometry = await getGeometry(c.env.DB, c.var.userId, c.req.param("id"));
  // Another user's geometry answers exactly like a missing one, so ids reveal nothing.
  if (geometry === null) return c.json({ error: NOT_FOUND }, 404);
  const wait = await jobWait(c.env, c.var.userId, geometry.status === "importing" ? geometry.importJobId : null);
  return c.json({ geometry: view(geometry), ...(wait && { wait }) } satisfies GeometryResponse);
});

async function output(
  c: { env: SessionEnv["Bindings"]; var: SessionEnv["Variables"] },
  geometryId: string,
  file: GeometryFile,
  contentType: string,
): Promise<Response> {
  const geometry = await getGeometry(c.env.DB, c.var.userId, geometryId);
  if (geometry === null) return Response.json({ error: NOT_FOUND }, { status: 404 });
  if (!READ.includes(geometry.status)) {
    const why =
      geometry.status === "importing"
        ? "The file is still being imported. Try again when the import has finished."
        : "The import failed, so there is nothing to show. Upload the file again.";
    return Response.json({ error: why }, { status: 409 });
  }
  const object = await c.env.FILES.get(geometryKey(c.var.userId, geometry.id, file));
  if (object === null) {
    return Response.json(
      { error: `The ${file} of this geometry is missing from storage. Upload the file again.` },
      { status: 500 },
    );
  }
  return new Response(object.body, {
    headers: { "Content-Type": contentType, "Content-Length": String(object.size) },
  });
}

geometries.get("/:id/topology", (c) => output(c, c.req.param("id"), "topology.json", "application/json"));

geometries.get("/:id/display", (c) =>
  output(c, c.req.param("id"), "display.bin", "application/octet-stream"),
);

geometries.post("/:id/unit", async (c) => {
  const body = await readBody(
    c.req.raw,
    validateConfirmUnitRequest,
    "ConfirmUnitRequest",
    "geometry.schema.json",
  );
  if ("error" in body) return c.json({ error: body.error }, 400);
  const lengths = unitsTable.kinds.length?.units ?? {};
  const { unit } = body.value;
  if (!Object.hasOwn(lengths, unit)) {
    return c.json(
      { error: `${unit} is not a length unit. Use one of: ${Object.keys(lengths).join(", ")}.` },
      400,
    );
  }
  const geometry = await getGeometry(c.env.DB, c.var.userId, c.req.param("id"));
  if (geometry === null) return c.json({ error: NOT_FOUND }, 404);
  const change = await confirmUnit(c.env.DB, c.var.userId, geometry, unit);
  if (change.kind === "notAllowed") {
    const why =
      geometry.status === "importing"
        ? "The file is still being imported. Choose the unit when the import has finished."
        : "The import failed, so there is no geometry to set a unit on. Upload the file again.";
    return c.json({ error: why }, 409);
  }
  if (change.kind === "locked") {
    return c.json(
      {
        error: `This geometry is used by a simulation, so its unit stays ${geometry.confirmedUnit}: changing it would move every face the simulation refers to. Upload the file again to use it in a different unit.`,
      },
      409,
    );
  }
  return c.json({ geometry: view(change.geometry) } satisfies GeometryResponse);
});
