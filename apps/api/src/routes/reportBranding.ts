// SPDX-License-Identifier: AGPL-3.0-or-later
// The signed-in user's company name and logo, printed on every report of theirs (M7.1, ADR-074).
// Shapes: packages/spec/schemas/report.schema.json.

import { type ReportBrandingResponse, validateSaveReportBrandingRequest } from "@clearfea/spec";
import { Hono } from "hono";
import { readBody } from "../body";
import { getBranding, logoKey, saveCompanyName, saveLogo } from "../db/report";
import { imageInfo } from "../logo";
import { requireUser, type SessionEnv } from "../session";

export const reportBranding = new Hono<SessionEnv>();

reportBranding.use("*", requireUser);

/** Largest logo accepted; a logo prints a few centimetres wide. */
export const MAX_LOGO_BYTES = 1000 * 1000;

reportBranding.get("/", async (c) => {
  return c.json({ branding: await getBranding(c.env.DB, c.var.userId) } satisfies ReportBrandingResponse);
});

reportBranding.put("/", async (c) => {
  const body = await readBody(
    c.req.raw,
    validateSaveReportBrandingRequest,
    "SaveReportBrandingRequest",
    "report.schema.json",
  );
  if ("error" in body) return c.json({ error: body.error }, 400);
  const branding = await saveCompanyName(c.env.DB, c.var.userId, body.value.companyName);
  return c.json({ branding } satisfies ReportBrandingResponse);
});

reportBranding.post("/logo", async (c) => {
  // Sent as raw bytes like a STEP upload: a cross-site HTML form cannot send this type without
  // the browser asking first.
  if ((c.req.header("Content-Type") ?? "").split(";")[0]?.trim() !== "application/octet-stream") {
    return c.json({ error: "Send the logo as the request body with Content-Type: application/octet-stream." }, 415);
  }
  const tooLarge = `The logo is larger than ${MAX_LOGO_BYTES / 1e6} MB. Save it smaller (a few hundred pixels wide is plenty) and upload it again.`;
  const declared = Number(c.req.header("Content-Length") ?? Number.NaN);
  if (declared > MAX_LOGO_BYTES) return c.json({ error: tooLarge }, 413);
  const content = new Uint8Array(await c.req.arrayBuffer());
  if (content.byteLength > MAX_LOGO_BYTES) return c.json({ error: tooLarge }, 413);
  const info = imageInfo(content);
  if (info === null) {
    return c.json({ error: "The logo must be a PNG or JPEG image. Save it in one of those formats and upload it again." }, 400);
  }
  await c.env.FILES.put(logoKey(c.var.userId), content, { httpMetadata: { contentType: info.contentType } });
  const branding = await saveLogo(c.env.DB, c.var.userId, { ...info, sizeBytes: content.byteLength });
  return c.json({ branding } satisfies ReportBrandingResponse);
});

reportBranding.get("/logo", async (c) => {
  const { logo } = await getBranding(c.env.DB, c.var.userId);
  const object = logo === null ? null : await c.env.FILES.get(logoKey(c.var.userId));
  if (logo === null || object === null) return c.json({ error: "You have not uploaded a logo." }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": logo.contentType,
      "Content-Length": String(object.size),
      "Cache-Control": "private, no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

reportBranding.delete("/logo", async (c) => {
  await c.env.FILES.delete(logoKey(c.var.userId));
  const branding = await saveLogo(c.env.DB, c.var.userId, null);
  return c.json({ branding } satisfies ReportBrandingResponse);
});
