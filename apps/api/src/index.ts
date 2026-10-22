// SPDX-License-Identifier: AGPL-3.0-or-later
import type { HealthResponse } from "@clearfea/spec";
import { Hono } from "hono";
import { probeDatabase, probeStorage } from "./db/health";
import { HOST_STATS_DAYS, purgeHostLoad } from "./db/stats";
import { sweepStorage } from "./db/storage";
import type { Env } from "./env";
import { internal } from "./internal";
import { authMode, configurationProblem } from "./session";
import { googleAuth } from "./session/google";
import { sweepLostJobs } from "./jobs/outcome";
import { ensureMachines } from "./launcher";
import { admin } from "./routes/admin";
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

// Better Auth's own routes for Google sign-in (M10.3, ADR-097): the start, Google's callback,
// the session and sign-out. Only in "google" mode; locally the seeded password logins are used.
app.on(["GET", "POST"], "/api/auth/*", (c) => {
  if (authMode(c.env) !== "google") {
    return c.json({ error: "Google sign-in is off on this API (AUTH_MODE is not google). Sign in with a local test login." }, 404);
  }
  const problem = configurationProblem(c.env);
  if (problem !== null) return c.json({ error: problem }, 503);
  return googleAuth(c.env).handler(c.req.raw);
});

app.route("/api/session", session);
app.route("/api/admin", admin);
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
 * The cron trigger that runs each minute (wrangler.jsonc); any other runs the daily sweep. Not
 * exported: workerd takes every named export of the main module as a handler.
 */
const EVERY_MINUTE = "* * * * *";

/**
 * The cron triggers in wrangler.jsonc. Each minute: fail jobs whose worker is lost (M8.4), the
 * only place that looks for them over all workers (M11.3, ADR-112), and on cloud machines start
 * a machine again for work left waiting (M10.7, ADR-100). Daily, and on any other call such as `make dev`'s hourly one: the
 * storage sweep (M8.6, ADR-086), which removes raw solver output past its retention period and
 * charges storage above the free allowance, after the lost-job sweep, then removes the solver
 * host's load samples past 14 days (M12.3, ADR-109).
 */
async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
  const lost = await sweepLostJobs(env);
  if (lost > 0) console.log(`Failed ${lost} jobs whose worker stopped checking in.`);
  if (controller.cron === EVERY_MINUTE) {
    await ensureMachines(env);
    return;
  }
  const summary = await sweepStorage(env.DB, env.FILES, new Date(controller.scheduledTime));
  console.log(
    `Storage sweep for ${summary.day}: removed the raw output of ${summary.removed} runs, charged ${summary.charged} users.`,
  );
  const purged = await purgeHostLoad(env.DB);
  if (purged > 0) console.log(`Removed ${purged} solver host load samples older than ${HOST_STATS_DAYS} days.`);
}

export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Env>;
