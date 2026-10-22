// SPDX-License-Identifier: AGPL-3.0-or-later
// The admin page's routes (M10.3, ADR-097): the allowlist of Google addresses that may sign in,
// the users, the cloud machine sizes switched on (M10.6, ADR-099), and the solver machines and
// their monthly hours cap (M10.7, ADR-100), and the statistics of each try of a job and of the solver
// host's load (M12.3, ADR-109), and the event log, where each change made here is recorded (M13.1,
// ADR-113, ADR-125), and the dashboard's Overview with pause and resume, and every user's jobs with
// their logs, cancel and re-queue (M13.2, ADR-127), and every setting and each month's costs
// (M13.3, ADR-128). Only the admin (ADMIN_EMAIL) reaches them; to
// anyone else they answer as if they did not exist. Shapes: packages/spec/schemas/admin.schema.json.

import {
  type AdminAlert,
  type AdminEvent,
  type AdminJob,
  type AdminJobLogResponse,
  type AdminJobResponse,
  type AdminJobsResponse,
  type AdminResponse,
  type CostsResponse,
  type EventsResponse,
  type HostLoadResponse,
  type JobTriesResponse,
  type OverviewResponse,
  type SettingsResponse,
  validateAddAllowedRequest,
  validateSetMachineHoursCapRequest,
  validateSetQueuePausedRequest,
  validateSetSettingRequest,
  validateSwitchCloudSizeRequest,
} from "@clearfea/spec";
import { Hono, type MiddlewareHandler } from "hono";
import { readBody } from "../body";
import { addAllowed, isAdminEmail, listAllowed, listUsers, normalEmail, removeAllowed } from "../db/allowlist";
import { adminJob, laneJobs, listAdminJobs } from "../db/adminJobs";
import { currentMonth, monthCosts } from "../db/costs";
import { lastPausedAt, listEvents, recordAdminAction } from "../db/events";
import { latestHost } from "../db/hosts";
import { jobForAdmin, readJobLog } from "../db/jobs";
import { listCloudSizes, machineMode, switchCloudSize } from "../db/machines";
import {
  listSettings,
  queuePaused,
  SETTINGS,
  type SettingDefinition,
  setMachineHoursCap,
  setQueuePaused,
  setSetting,
} from "../db/settings";
import { latestHostLoad, listHostLoad, listTries } from "../db/stats";
import { getUser } from "../db/users";
import type { Env } from "../env";
import { cancelAsAdmin, requeueAsAdmin } from "../jobs/outcome";
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

/**
 * What the admin should act on (M13.2, ADR-127), shown on the dashboard only (Shubham,
 * 2026-10-22): no solver host, a silent one, a paused queue. M13.5 adds more.
 */
function alerts(overview: Omit<OverviewResponse, "alerts">): AdminAlert[] {
  const list: AdminAlert[] = [];
  if (overview.machines === "vps" && overview.host === null) {
    list.push({
      kind: "no_host",
      level: "error",
      message:
        "No solver host has checked in yet, so new jobs are refused. Start the compute manager on the VPS (docs/DEPLOYMENT.md).",
    });
  } else if (overview.machines === "vps" && overview.host !== null && !overview.host.online) {
    list.push({
      kind: "host_offline",
      level: "error",
      message: `The solver host ${overview.host.host} has not checked in since ${overview.host.lastSeenAt}, so new jobs are refused and queued work waits. Restart the VPS by hand (docs/DEPLOYMENT.md); nothing starts a new one.`,
    });
  }
  if (overview.paused) {
    const waiting = overview.lanes.reduce((sum, lane) => sum + lane.queued.length, 0);
    list.push({
      kind: "queue_paused",
      level: "warning",
      message: `The queue is paused, so no job starts; ${waiting === 1 ? "1 job waits" : `${waiting} jobs wait`}. Jobs already running finish. Resume it when you are done.`,
    });
  }
  return list;
}

async function overview(env: Env): Promise<OverviewResponse> {
  const [paused, host, lanes] = await Promise.all([queuePaused(env.DB), latestHost(env.DB), laneJobs(env.DB)]);
  const [pausedAt, load] = await Promise.all([
    paused ? lastPausedAt(env.DB) : null,
    host === null ? null : latestHostLoad(env.DB, host.host),
  ]);
  const view = { machines: machineMode(env), paused, pausedAt, host, load, lanes };
  return { ...view, alerts: alerts(view) };
}

/** The solver host, its lanes and their queues, pause, and the alerts (M13.2). */
admin.get("/overview", async (c) => c.json(await overview(c.env)));

/** Pauses or resumes the queue (ADR-127): while paused no job starts; running jobs finish. */
admin.put("/queue-paused", async (c) => {
  const body = await readBody(c.req.raw, validateSetQueuePausedRequest, "SetQueuePausedRequest", "admin.schema.json");
  if ("error" in body) return c.json({ error: body.error }, 400);
  const { paused } = body.value;
  // Pausing a paused queue changes nothing, so it is not recorded twice.
  if (await setQueuePaused(c.env.DB, paused)) {
    await recordAdminAction(
      c.env.DB,
      c.var.userId,
      paused ? "Paused the queue: no job starts until it is resumed." : "Resumed the queue.",
      { action: paused ? "queue_pause" : "queue_resume" },
    );
  }
  return c.json(await overview(c.env));
});

const JOB_STATUSES: AdminJob["status"][] = [
  "queued",
  "claimed",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "stopped_at_limit",
];
const JOB_TYPES: AdminJob["type"][] = ["noop", "import", "mesh", "solve", "report"];

/** Most jobs one read returns, and how many by default. */
const MAX_JOBS = 500;
const DEFAULT_JOBS = 100;

/**
 * Every user's jobs, newest first (M13.2): of one status (?status=, or ?status=active for queued,
 * claimed and running), type (?type=) or user (?user=), created before ?before= (to page on), at
 * most ?limit=.
 */
admin.get("/jobs", async (c) => {
  const limitText = c.req.query("limit");
  const limit = limitText === undefined ? DEFAULT_JOBS : Number(limitText);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_JOBS) {
    return c.json({ error: `Ask for 1 to ${MAX_JOBS} jobs with ?limit=.` }, 400);
  }
  const status = c.req.query("status");
  if (status !== undefined && status !== "active" && !JOB_STATUSES.includes(status as AdminJob["status"])) {
    return c.json({ error: `Give ?status= as active or one of ${JOB_STATUSES.join(", ")}.` }, 400);
  }
  const type = c.req.query("type");
  if (type !== undefined && !JOB_TYPES.includes(type as AdminJob["type"])) {
    return c.json({ error: `Give ?type= as one of ${JOB_TYPES.join(", ")}.` }, 400);
  }
  const beforeText = c.req.query("before");
  const before = isoTime(beforeText);
  if (beforeText !== undefined && before === null) {
    return c.json({ error: "Give ?before= as an ISO 8601 time, such as 2026-10-22T12:00:00Z." }, 400);
  }
  const jobs = await listAdminJobs(c.env.DB, {
    statuses:
      status === undefined
        ? undefined
        : status === "active"
          ? ["queued", "claimed", "running"]
          : [status as AdminJob["status"]],
    type: type as AdminJob["type"] | undefined,
    userId: c.req.query("user"),
    before: before ?? undefined,
    limit,
  });
  return c.json({ jobs } satisfies AdminJobsResponse);
});

const NO_JOB = "There is no job with that id. Reload the dashboard.";

/** Any user's job's log after chunk ?after= (0 for the whole log), for support. */
admin.get("/jobs/:id/log", async (c) => {
  const after = Number(c.req.query("after") ?? "0");
  if (!Number.isInteger(after) || after < 0) {
    return c.json({ error: "?after= must be a whole number of log chunks, 0 or more." }, 400);
  }
  const job = await jobForAdmin(c.env.DB, c.req.param("id"));
  if (job === null) return c.json({ error: NO_JOB }, 404);
  const log = await readJobLog(c.env.DB, job.ownerId, job.id, after);
  return c.json(log satisfies AdminJobLogResponse);
});

const JOB_NAME: Record<AdminJob["type"], string> = {
  noop: "no-op job",
  import: "import",
  mesh: "mesh job",
  solve: "solve",
  report: "report job",
};

/** Ends a queued, claimed or running job of any user, uncharged, and records who did. */
admin.post("/jobs/:id/cancel", async (c) => {
  const job = await jobForAdmin(c.env.DB, c.req.param("id"));
  if (job === null) return c.json({ error: NO_JOB }, 404);
  if (job.status !== "queued" && job.status !== "claimed" && job.status !== "running") {
    return c.json({ error: "The job has already ended, so there is nothing to cancel." }, 409);
  }
  const ended = await cancelAsAdmin(c.env, job);
  if (ended === null) return c.json({ error: "The job changed while you cancelled it. Reload and try again." }, 409);
  await recordAdminAction(
    c.env.DB,
    c.var.userId,
    `Cancelled a ${JOB_NAME[job.type]} (${job.status}, try ${job.attempt}); nothing is charged.`,
    { action: "job_cancel", jobId: job.id, owner: job.ownerId, status: job.status, attempt: job.attempt },
    job.id,
  );
  return c.json({ job: (await adminJob(c.env.DB, job.id)) as AdminJob } satisfies AdminJobResponse);
});

/** Takes a claimed or running job from its worker and queues it again, uncharged. */
admin.post("/jobs/:id/requeue", async (c) => {
  const job = await jobForAdmin(c.env.DB, c.req.param("id"));
  if (job === null) return c.json({ error: NO_JOB }, 404);
  if (job.status !== "claimed" && job.status !== "running") {
    return c.json(
      {
        error:
          job.status === "queued"
            ? "The job is already queued."
            : "The job has ended, so it cannot be queued again; its owner can run it again.",
      },
      409,
    );
  }
  if (job.stopRequested !== null) {
    return c.json({ error: "The job is being stopped as its owner or its stop limit asked, so cancel it instead." }, 409);
  }
  const requeued = await requeueAsAdmin(c.env, job);
  if (requeued === null) return c.json({ error: "The job changed while you queued it again. Reload and try again." }, 409);
  await recordAdminAction(
    c.env.DB,
    c.var.userId,
    `Queued a ${JOB_NAME[job.type]} again, taking it from ${job.claimedBy ?? "its worker"} on try ${job.attempt}.`,
    { action: "job_requeue", jobId: job.id, owner: job.ownerId, worker: job.claimedBy, attempt: job.attempt },
    job.id,
  );
  return c.json({ job: (await adminJob(c.env.DB, job.id)) as AdminJob } satisfies AdminJobResponse);
});

/** A stored value as the dashboard shows it, such as "5 GiB" or "17 USD". */
function shown(definition: SettingDefinition, value: number): string {
  return `${Number((value / definition.scale).toPrecision(6))} ${definition.unit}`;
}

const settingsView = async (db: D1Database): Promise<SettingsResponse> => ({ settings: await listSettings(db) });

/** Every setting the dashboard edits, with its stored value and what it allows (M13.3, ADR-128). */
admin.get("/settings", async (c) => c.json(await settingsView(c.env.DB)));

/** Changes one setting and records the change; an unchanged value records nothing. */
admin.put("/settings/:name", async (c) => {
  const definition = SETTINGS.find((entry) => entry.name === c.req.param("name"));
  if (definition === undefined) return c.json({ error: "There is no setting of that name. Reload the dashboard." }, 404);
  const body = await readBody(c.req.raw, validateSetSettingRequest, "SetSettingRequest", "admin.schema.json");
  const { value } = "error" in body ? { value: Number.NaN } : body.value;
  if (!Number.isInteger(value) || value < definition.min || value > definition.max) {
    return c.json(
      {
        error: `Give "${definition.label}" a value from ${shown(definition, definition.min)} to ${shown(definition, definition.max)}. Nothing was changed.`,
      },
      400,
    );
  }
  const previous = await setSetting(c.env.DB, definition.name, value);
  if (previous !== null) {
    await recordAdminAction(
      c.env.DB,
      c.var.userId,
      `Changed "${definition.label}" from ${shown(definition, previous)} to ${shown(definition, value)}.`,
      { action: "setting", name: definition.name, from: previous, to: value },
    );
  }
  return c.json(await settingsView(c.env.DB));
});

/** One calendar month's (UTC) usage and the beta's monthly costs, ?month=YYYY-MM, this month by default. */
admin.get("/costs", async (c) => {
  const month = c.req.query("month") ?? currentMonth();
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return c.json({ error: "Give ?month= as a year and month, such as 2026-10." }, 400);
  }
  return c.json((await monthCosts(c.env.DB, month)) satisfies CostsResponse);
});
