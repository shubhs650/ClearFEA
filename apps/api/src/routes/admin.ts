// SPDX-License-Identifier: AGPL-3.0-or-later
// The admin page's routes (M10.3, ADR-097): the allowlist of Google addresses that may sign in,
// the users, the cloud machine sizes switched on (M10.6, ADR-099), and the solver machines and
// their monthly hours cap (M10.7, ADR-100), and the statistics of each try of a job and of the solver
// host's load (M12.3, ADR-109). Only the admin (ADMIN_EMAIL) reaches them; to anyone else they answer as if
// they did not exist. Shapes: packages/spec/schemas/admin.schema.json.

import {
  type AdminResponse,
  type HostLoadResponse,
  type JobTriesResponse,
  validateAddAllowedRequest,
  validateSetMachineHoursCapRequest,
  validateSwitchCloudSizeRequest,
} from "@clearfea/spec";
import { Hono, type MiddlewareHandler } from "hono";
import { readBody } from "../body";
import { addAllowed, isAdminEmail, listAllowed, listUsers, normalEmail, removeAllowed } from "../db/allowlist";
import { latestHost } from "../db/hosts";
import { listCloudSizes, machineMode, switchCloudSize } from "../db/machines";
import { setMachineHoursCap } from "../db/settings";
import { listHostLoad, listTries } from "../db/stats";
import { getUser } from "../db/users";
import type { Env } from "../env";
import { solverMachines } from "../launcher";
import { requireUser, type SessionEnv } from "../session";

export const admin = new Hono<SessionEnv>();

const NOT_FOUND = "There is no such page.";

/** Refuses everyone but the admin, with the same 404 an unknown address gets. */
const requireAdmin: MiddlewareHandler<SessionEnv> = async (c, next) => {
  const user = await getUser(c.env.DB, c.var.userId);
  if (user === null || !isAdminEmail(user.email, c.env.ADMIN_EMAIL)) return c.json({ error: NOT_FOUND }, 404);
  await next();
};

admin.use("*", requireUser, requireAdmin);

async function view(db: D1Database, env: Env): Promise<AdminResponse> {
  const adminEmail = env.ADMIN_EMAIL ?? "";
  const [allowed, users, cloudSizes, machines, solverHost] = await Promise.all([
    listAllowed(db),
    listUsers(db),
    listCloudSizes(db),
    solverMachines(env),
    latestHost(db),
  ]);
  const invited = new Set(allowed.map((a) => a.email));
  return {
    adminEmail: normalEmail(adminEmail),
    allowed,
    users: users.map((u) => ({
      ...u,
      allowed: u.email !== null && (invited.has(normalEmail(u.email)) || isAdminEmail(u.email, adminEmail)),
    })),
    machines: machineMode(env),
    cloudSizes,
    solverMachines: machines,
    solverHost,
  };
}

admin.get("/", async (c) => c.json(await view(c.env.DB, c.env)));

admin.post("/allowed", async (c) => {
  const body = await readBody(c.req.raw, validateAddAllowedRequest, "AddAllowedRequest", "admin.schema.json");
  if ("error" in body) {
    return c.json({ error: "Type one email address, such as colleague@gmail.com, and try again." }, 400);
  }
  if (isAdminEmail(body.value.email, c.env.ADMIN_EMAIL)) {
    return c.json({ error: "That is the admin's own address, which can always sign in. Nothing was added." }, 400);
  }
  await addAllowed(c.env.DB, body.value.email);
  return c.json(await view(c.env.DB, c.env));
});

admin.delete("/allowed/:email", async (c) => {
  const removed = await removeAllowed(c.env.DB, c.req.param("email"));
  if (!removed) return c.json({ error: "That address is not on the list. Reload the admin page." }, 404);
  return c.json(await view(c.env.DB, c.env));
});

admin.put("/machine-sizes/:name", async (c) => {
  const body = await readBody(c.req.raw, validateSwitchCloudSizeRequest, "SwitchCloudSizeRequest", "admin.schema.json");
  if ("error" in body) return c.json({ error: body.error }, 400);
  const outcome = await switchCloudSize(c.env.DB, c.req.param("name"), body.value.enabled);
  if (outcome === "not_cloud") {
    return c.json({ error: "There is no cloud machine size of that name. Reload the admin page." }, 404);
  }
  if (outcome === "default") {
    return c.json(
      { error: "The default size runs every import, mesh and report, so it stays on. Nothing was changed." },
      400,
    );
  }
  return c.json(await view(c.env.DB, c.env));
});

admin.put("/machine-hours-cap", async (c) => {
  const body = await readBody(
    c.req.raw,
    validateSetMachineHoursCapRequest,
    "SetMachineHoursCapRequest",
    "admin.schema.json",
  );
  if ("error" in body) {
    return c.json({ error: "Type a whole number of hours from 0 to 744, such as 60, and try again." }, 400);
  }
  await setMachineHoursCap(c.env.DB, body.value.hours);
  return c.json(await view(c.env.DB, c.env));
});

/** Most tries one read of the statistics returns, and how many by default. */
const MAX_TRIES = 500;
const DEFAULT_TRIES = 100;

/** An ISO 8601 UTC time as the database stores them, or null for anything else. */
function isoTime(text: string | undefined): string | null {
  if (text === undefined) return null;
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/**
 * The statistics of jobs' tries, newest first (M12.3, ADR-109): of one job (?job=), of the jobs of
 * one record such as a run (?target=), or of every job, paged with ?before= (a claim time) and
 * ?limit= (up to 500).
 */
admin.get("/stats/jobs", async (c) => {
  const limitText = c.req.query("limit");
  const limit = limitText === undefined ? DEFAULT_TRIES : Number(limitText);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_TRIES) {
    return c.json({ error: `Ask for 1 to ${MAX_TRIES} tries with ?limit=.` }, 400);
  }
  const beforeText = c.req.query("before");
  const before = isoTime(beforeText);
  if (beforeText !== undefined && before === null) {
    return c.json({ error: "Give ?before= as an ISO 8601 time, such as 2026-10-22T12:00:00Z." }, 400);
  }
  const tries = await listTries(c.env.DB, {
    jobId: c.req.query("job"),
    targetId: c.req.query("target"),
    before: before ?? undefined,
    limit,
  });
  return c.json({ tries } satisfies JobTriesResponse);
});

/** The solver host's load samples since ?since= (default the last hour), oldest first, at most a day's. */
admin.get("/stats/host", async (c) => {
  const sinceText = c.req.query("since");
  const since = sinceText === undefined ? new Date(Date.now() - 3600_000).toISOString() : isoTime(sinceText);
  if (since === null) return c.json({ error: "Give ?since= as an ISO 8601 time, such as 2026-10-22T12:00:00Z." }, 400);
  return c.json({ samples: await listHostLoad(c.env.DB, since) } satisfies HostLoadResponse);
});
