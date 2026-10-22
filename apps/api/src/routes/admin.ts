// SPDX-License-Identifier: AGPL-3.0-or-later
// The admin page's routes (M10.3, ADR-097): the allowlist of Google addresses that may sign in,
// the users, the cloud machine sizes switched on (M10.6, ADR-099), and the solver machines and
// their monthly hours cap (M10.7, ADR-100), and the statistics of each try of a job and of the solver
// host's load (M12.3, ADR-109), and the event log, where each change made here is recorded (M13.1,
// ADR-113, ADR-125). Only the admin (ADMIN_EMAIL) reaches them; to anyone else they answer as if
// they did not exist. Shapes: packages/spec/schemas/admin.schema.json.

import {
  type AdminEvent,
  type AdminResponse,
  type EventsResponse,
  type HostLoadResponse,
  type JobTriesResponse,
  validateAddAllowedRequest,
  validateSetMachineHoursCapRequest,
  validateSwitchCloudSizeRequest,
} from "@clearfea/spec";
import { Hono, type MiddlewareHandler } from "hono";
import { readBody } from "../body";
import { addAllowed, isAdminEmail, listAllowed, listUsers, normalEmail, removeAllowed } from "../db/allowlist";
import { listEvents, recordAdminAction } from "../db/events";
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
  const email = normalEmail(body.value.email);
  await recordAdminAction(c.env.DB, c.var.userId, `Invited ${email}.`, { action: "allowlist_add", email });
  return c.json(await view(c.env.DB, c.env));
});

admin.delete("/allowed/:email", async (c) => {
  const removed = await removeAllowed(c.env.DB, c.req.param("email"));
  if (!removed) return c.json({ error: "That address is not on the list. Reload the admin page." }, 404);
  const email = normalEmail(c.req.param("email"));
  await recordAdminAction(c.env.DB, c.var.userId, `Removed ${email} from the invited addresses and ended their sessions.`, {
    action: "allowlist_remove",
    email,
  });
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
  const size = c.req.param("name");
  const { enabled } = body.value;
  await recordAdminAction(c.env.DB, c.var.userId, `Switched the ${size} machine size ${enabled ? "on" : "off"}.`, {
    action: "machine_size",
    size,
    enabled,
  });
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
  const { hours } = body.value;
  await recordAdminAction(c.env.DB, c.var.userId, `Set the monthly machine-hours cap to ${hours} h.`, {
    action: "machine_hours_cap",
    hours,
  });
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

const EVENT_KINDS: AdminEvent["kind"][] = [
  "sign_in",
  "sign_in_refused",
  "job_failed",
  "job_retried",
  "host_online",
  "host_offline",
  "manager_started",
  "admin_action",
];
const EVENT_LEVELS: AdminEvent["level"][] = ["info", "warning", "error"];

/** Most events one read returns, and how many by default. */
const MAX_EVENTS = 500;
const DEFAULT_EVENTS = 100;

/**
 * The event log, newest first (M13.1, ADR-113, ADR-125): of one kind (?kind=), level (?level=) or
 * user (?user=), from ?since= and before ?before= (times, which also page on), at most ?limit=.
 */
admin.get("/events", async (c) => {
  const limitText = c.req.query("limit");
  const limit = limitText === undefined ? DEFAULT_EVENTS : Number(limitText);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_EVENTS) {
    return c.json({ error: `Ask for 1 to ${MAX_EVENTS} events with ?limit=.` }, 400);
  }
  const kind = c.req.query("kind");
  if (kind !== undefined && !EVENT_KINDS.includes(kind as AdminEvent["kind"])) {
    return c.json({ error: `Give ?kind= as one of ${EVENT_KINDS.join(", ")}.` }, 400);
  }
  const level = c.req.query("level");
  if (level !== undefined && !EVENT_LEVELS.includes(level as AdminEvent["level"])) {
    return c.json({ error: `Give ?level= as one of ${EVENT_LEVELS.join(", ")}.` }, 400);
  }
  const times: Record<"since" | "before", string | undefined> = { since: undefined, before: undefined };
  for (const name of ["since", "before"] as const) {
    const text = c.req.query(name);
    const time = isoTime(text);
    if (text !== undefined && time === null) {
      return c.json({ error: `Give ?${name}= as an ISO 8601 time, such as 2026-10-22T12:00:00Z.` }, 400);
    }
    times[name] = time ?? undefined;
  }
  const events = await listEvents(c.env.DB, { kind, level, userId: c.req.query("user"), ...times, limit });
  return c.json({ events } satisfies EventsResponse);
});
