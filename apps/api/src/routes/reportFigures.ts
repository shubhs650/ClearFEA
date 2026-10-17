// SPDX-License-Identifier: AGPL-3.0-or-later
// A run's report figures (M7.2, ADR-011): PNGs the browser draws with the viewer, one per support
// and load of the run's setup and one per saved view the report draws, stored for the report job
// (M7.3) to place. The browser captures a whole set at once: it clears the run's figures, then
// sends each one. Shapes: packages/spec/schemas/report.schema.json.

import {
  type ReportFigureKind,
  ReportFigureKindValues,
  type ReportFigureListResponse,
  type ReportFigureResponse,
} from "@clearfea/spec";
import { type Context, Hono } from "hono";
import { deleteFigures, figureKey, listFigures, saveFigure } from "../db/report";
import { getRun } from "../db/runs";
import { listViews } from "../db/views";
import { imageInfo } from "../logo";
import { requireUser, type SessionEnv } from "../session";

export const reportFigures = new Hono<SessionEnv>();

reportFigures.use("*", requireUser);

/** Largest figure accepted: a 1600 × 1000 figure of a busy contour is well under 1 MB. */
export const MAX_FIGURE_BYTES = 5 * 1000 * 1000;

/** Largest width or height accepted, in pixels. */
export const MAX_FIGURE_PIXELS = 4096;

const NOT_FOUND = "There is no run with that id in your account.";

const ITEM = /^[A-Za-z0-9_-]{1,64}$/;

/** The signed-in user's run if it has succeeded, or the response that says why not. */
async function solvedRun(c: Context<SessionEnv>) {
  const run = await getRun(c.env.DB, c.var.userId, c.req.param("id") ?? "");
  if (run === null) return c.json({ error: NOT_FOUND }, 404);
  if (run.status !== "succeeded") {
    return c.json({ error: "A report is made from a solved run, and this run has not succeeded. Run the simulation and try again." }, 409);
  }
  return run;
}

reportFigures.get("/:id/figures", async (c) => {
  const run = await getRun(c.env.DB, c.var.userId, c.req.param("id"));
  if (run === null) return c.json({ error: NOT_FOUND }, 404);
  return c.json({ figures: await listFigures(c.env.DB, c.var.userId, run.id) } satisfies ReportFigureListResponse);
});

/** Removes every figure of the run, before a new set is captured. */
reportFigures.delete("/:id/figures", async (c) => {
  const run = await getRun(c.env.DB, c.var.userId, c.req.param("id"));
  if (run === null) return c.json({ error: NOT_FOUND }, 404);
  const figures = await listFigures(c.env.DB, c.var.userId, run.id);
  await deleteFigures(c.env.DB, c.var.userId, run.id);
  if (figures.length > 0) {
    await c.env.FILES.delete(figures.map((f) => figureKey(c.var.userId, run.id, f.kind, f.item)));
  }
  return c.json({ figures: [] } satisfies ReportFigureListResponse);
});

/**
 * Stores one figure: the PNG as the body, the caption and position in the query. A support or
 * load must be one of the run's frozen setup, a view one of the simulation's saved views.
 */
reportFigures.put("/:id/figures/:kind/:item", async (c) => {
  const kind = c.req.param("kind") as ReportFigureKind;
  const item = c.req.param("item");
  if (!ReportFigureKindValues.includes(kind) || !ITEM.test(item)) {
    return c.json({ error: "A figure is named /figures/support/<id>, /figures/load/<id> or /figures/view/<id>." }, 404);
  }
  const caption = c.req.query("caption") ?? "";
  if (caption.length > 200) return c.json({ error: "The caption is longer than 200 characters. Shorten it." }, 400);
  const rawPosition = c.req.query("position") ?? "";
  const position = Number(rawPosition);
  if (!/^\d+$/.test(rawPosition) || position > 999) {
    return c.json({ error: "?position= must be a whole number from 0 to 999." }, 400);
  }
  // Sent as raw bytes like a logo: a cross-site HTML form cannot send this type without the
  // browser asking first.
  if ((c.req.header("Content-Type") ?? "").split(";")[0]?.trim() !== "application/octet-stream") {
    return c.json({ error: "Send the figure as the request body with Content-Type: application/octet-stream." }, 415);
  }
  const tooLarge = `The figure is larger than ${MAX_FIGURE_BYTES / 1e6} MB.`;
  if (Number(c.req.header("Content-Length") ?? Number.NaN) > MAX_FIGURE_BYTES) return c.json({ error: tooLarge }, 413);
  const run = await solvedRun(c);
  if (run instanceof Response) return run;
  const known =
    kind === "support"
      ? run.spec.supports.some((s) => s.id === item)
      : kind === "load"
        ? run.spec.loads.some((l) => l.id === item)
        : (await listViews(c.env.DB, c.var.userId, run.simulationId)).some((v) => v.id === item);
  if (!known) {
    const what = kind === "view" ? "saved view of this simulation" : `${kind} in this run's setup`;
    return c.json({ error: `There is no ${what} with the id ${item}.` }, 404);
  }
  const content = new Uint8Array(await c.req.arrayBuffer());
  if (content.byteLength > MAX_FIGURE_BYTES) return c.json({ error: tooLarge }, 413);
  const info = imageInfo(content);
  if (info?.contentType !== "image/png") return c.json({ error: "A figure must be a PNG image." }, 400);
  if (info.width > MAX_FIGURE_PIXELS || info.height > MAX_FIGURE_PIXELS) {
    return c.json({ error: `A figure must be at most ${MAX_FIGURE_PIXELS} pixels wide and high.` }, 400);
  }
  await c.env.FILES.put(figureKey(c.var.userId, run.id, kind, item), content, {
    httpMetadata: { contentType: "image/png" },
  });
  const figure = await saveFigure(c.env.DB, c.var.userId, run.id, {
    kind,
    item,
    caption,
    position,
    width: info.width,
    height: info.height,
    sizeBytes: content.byteLength,
  });
  if (figure === null) return c.json({ error: NOT_FOUND }, 404);
  return c.json({ figure } satisfies ReportFigureResponse);
});

reportFigures.get("/:id/figures/:kind/:item", async (c) => {
  const kind = c.req.param("kind") as ReportFigureKind;
  const item = c.req.param("item");
  const run = await getRun(c.env.DB, c.var.userId, c.req.param("id"));
  if (run === null) return c.json({ error: NOT_FOUND }, 404);
  const listed = (await listFigures(c.env.DB, c.var.userId, run.id)).some((f) => f.kind === kind && f.item === item);
  const object = listed ? await c.env.FILES.get(figureKey(c.var.userId, run.id, kind, item)) : null;
  if (object === null) return c.json({ error: "This run has no such figure. Capture the figures under Report." }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(object.size),
      "Cache-Control": "private, no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
