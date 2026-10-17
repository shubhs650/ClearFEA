// SPDX-License-Identifier: AGPL-3.0-or-later
import type { HealthResponse } from "@clearfea/spec";
import { Hono } from "hono";
import { probeDatabase, probeStorage } from "./db/health";
import type { Env } from "./env";
import { internal } from "./internal";
import { geometries } from "./routes/geometries";
import { jobs } from "./routes/jobs";
import { materials } from "./routes/materials";
import { meshes } from "./routes/meshes";
import { projects } from "./routes/projects";
import { reportBranding } from "./routes/reportBranding";
import { reportFigures } from "./routes/reportFigures";
import { runs } from "./routes/runs";
import { session } from "./routes/session";
import { simulations } from "./routes/simulations";

const app = new Hono<{ Bindings: Env }>();

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
app.route("/api/report-branding", reportBranding);
app.route("/internal", internal);

export default app;
