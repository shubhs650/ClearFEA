// SPDX-License-Identifier: AGPL-3.0-or-later
import type { HealthResponse } from "@clearfea/spec";
import { Hono } from "hono";
import { probeDatabase, probeStorage } from "./db/health";
import { sweepStorage } from "./db/storage";
import type { Env } from "./env";
import { internal } from "./internal";
import { sweepLostJobs } from "./jobs/outcome";
import { geometries } from "./routes/geometries";
import { jobs } from "./routes/jobs";
import { materials } from "./routes/materials";
import { meshes } from "./routes/meshes";
import { projects } from "./routes/projects";
import { reportBranding } from "./routes/reportBranding";
import { reportFigures } from "./routes/reportFigures";
import { reports } from "./routes/reports";
import { runs } from "./routes/runs";
import { session } from "./routes/session";
import { shared, shareLinks } from "./routes/shareLinks";
import { simulations } from "./routes/simulations";
import { storage } from "./routes/storage";
import { wallet } from "./routes/wallet";

export const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", async (c) => {
  const [database, storage] = await Promise.all([
    probeDatabase(c.env.DB),
    probeStorage(c.env.FILES),
  ]);
  const ok = database.ok && storage.ok;
  return c.json(
    {
      status: ok ? "ok" : "degraded",
      database: database.ok ? "ok" : database.problem,
      storage: storage.ok ? "ok" : storage.problem,
      commit: c.env.CLEARFEA_COMMIT || "development",
    } satisfies HealthResponse,
    ok ? 200 : 503,
  );
});

app.route("/api/session", session);
app.route("/api/jobs", jobs);
app.route("/api/project", projects);
app.route("/api/geometries", geometries);
app.route("/api/simulations", simulations);
app.route("/api/materials", materials);
app.route("/api/meshes", meshes);
app.route("/api/runs", runs);
app.route("/api/runs", reportFigures);
app.route("/api/runs", reports);
app.route("/api/runs", shareLinks);
app.route("/api/shared", shared);
app.route("/api/report-branding", reportBranding);
app.route("/api/wallet", wallet);
app.route("/api/storage", storage);
app.route("/internal", internal);

/**
 * The daily storage sweep (M8.6, ADR-086), run by the cron trigger in wrangler.jsonc: removes
 * raw solver output past its retention period and charges storage above the free allowance.
 * It also fails jobs whose worker is lost (M8.4), which every worker's claim does as well.
 */
async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
  const lost = await sweepLostJobs(env);
  if (lost > 0) console.log(`Failed ${lost} jobs whose worker stopped checking in.`);
  const summary = await sweepStorage(env.DB, env.FILES, new Date(controller.scheduledTime));
  console.log(
    `Storage sweep for ${summary.day}: removed the raw output of ${summary.removed} runs, charged ${summary.charged} users.`,
  );
}

export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Env>;
