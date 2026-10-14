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
import { requireUser, type SessionEnv } from "../session";

export const geometries = new Hono<SessionEnv>();

geometries.use("*", requireUser);

/**
 * Largest STEP file accepted. Cloudflare Workers refuse request bodies above 100 MB, so in
 * the cloud larger files must go straight to storage (ARCHITECTURE.md section 8).
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
    confirmedUnit: geometry.confirmedUnit,
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
  const tooLarge = `The file is larger than ${MAX_STEP_BYTES / 1e6} MB, the most ClearFEA accepts.`;
  if (declared > MAX_STEP_BYTES) return c.json({ error: tooLarge }, 413);
  const content = new Uint8Array(await c.req.arrayBuffer());
  if (content.byteLength > MAX_STEP_BYTES) return c.json({ error: tooLarge }, 413);
  if (!looksLikeStep(content.subarray(0, 64))) {
    return c.json(
      {
        error:
          "This is not a STEP file: it does not start with ISO-10303-21. Export the part from your CAD system as STEP (.step or .stp).",
      },
      400,
    );
  }
  const id = crypto.randomUUID();
  await c.env.FILES.put(geometryKey(c.var.userId, id, "model.step"), content);
  const { geometry } = await createGeometry(c.env.DB, c.var.userId, {
    id,
    name,
    sizeBytes: content.byteLength,
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
  return c.json({ geometry: view(geometry) } satisfies GeometryResponse);
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
  return c.json({ geometry: view(change.geometry) } satisfies GeometryResponse);
});
