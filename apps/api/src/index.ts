// SPDX-License-Identifier: AGPL-3.0-or-later
import { Hono } from "hono";
import { probeDatabase, probeStorage } from "./db/health";
import type { Env } from "./env";
import { internal } from "./internal";

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
    },
    ok ? 200 : 503,
  );
});

app.route("/internal", internal);

export default app;
