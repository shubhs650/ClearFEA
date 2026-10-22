// SPDX-License-Identifier: AGPL-3.0-or-later
// The admin dashboard's routes (M13.2, ADR-113, ADR-127): the Overview with the solver host, its
// lanes and queues, its alerts and pause and resume; every user's jobs with their logs, cancel and
// re-queue, each recorded in the event log. A run cancelled or queued again by the admin is in
// runs.test.ts.
import {
  type AdminJob,
  type OverviewResponse,
  validateAdminJobLogResponse,
  validateAdminJobsResponse,
  validateOverviewResponse,
} from "@clearfea/spec";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createJob } from "../src/db/jobs";
import type { Env } from "../src/env";
import { app } from "../src/index";

const TOKEN = "test-worker-token";
const BINDINGS: Env = { ...env, ADMIN_EMAIL: "alice@clearfea.test" };
const VPS: Env = { ...BINDINGS, MACHINES: "vps" };
const ALICE = "00000000-0000-4000-8000-00000000a11c";
const BOB = "00000000-0000-4000-8000-000000000b0b";

function call(
  method: string,
  path: string,
  options: { json?: unknown; cookie?: string; token?: string; bindings?: Env } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.json !== undefined) headers["Content-Type"] = "application/json";
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const body = options.json !== undefined ? JSON.stringify(options.json) : undefined;
  return Promise.resolve(app.request(`http://localhost${path}`, { method, headers, body }, options.bindings ?? BINDINGS));
}

const worker = (path: string, json: unknown) => call("POST", `/internal${path}`, { json, token: TOKEN });
const claim = (workerId: string, jobTypes = ["noop"]) => worker("/jobs/claim", { workerId, jobTypes });

let alice = "";
let bob = "";

async function signIn(login: string, password: string): Promise<string> {
  const response = await call("POST", "/api/session", { json: { login, password } });
  expect(response.status).toBe(200);
  return (response.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
}

async function overview(bindings: Env = BINDINGS): Promise<OverviewResponse> {
  const response = await call("GET", "/api/admin/overview", { cookie: alice, bindings });
  expect(response.status).toBe(200);
  const answer = validateOverviewResponse(await response.json());
  if (!answer.ok) throw new Error(answer.errors.join("; "));
  return answer.value;
}

async function jobs(query = ""): Promise<AdminJob[]> {
  const response = await call("GET", `/api/admin/jobs${query}`, { cookie: alice });
  expect(response.status).toBe(200);
  const answer = validateAdminJobsResponse(await response.json());
  if (!answer.ok) throw new Error(answer.errors.join("; "));
  return answer.value.jobs;
}

async function adminActions(): Promise<unknown[]> {
  const { results } = await env.DB.prepare(
    "SELECT message, job_id, json_extract(detail, '$.action') AS action FROM events WHERE kind = 'admin_action' ORDER BY id",
  ).all();
  return results;
}

const setPaused = (paused: boolean) => call("PUT", "/api/admin/queue-paused", { cookie: alice, json: { paused } });

beforeAll(async () => {
  const statements = env.TEST_SEED.flatMap((file) => file.queries);
  await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
  alice = await signIn("alice", "alice-local");
  bob = await signIn("bob", "bob-local");
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM events"),
    env.DB.prepare("DELETE FROM hosts"),
    env.DB.prepare("DELETE FROM host_stats"),
    env.DB.prepare("DELETE FROM job_stats"),
    env.DB.prepare("DELETE FROM job_logs"),
    env.DB.prepare("DELETE FROM jobs"),
    env.DB.prepare("UPDATE settings SET value = 0 WHERE name = 'queue_paused'"),
  ]);
});

describe("the Overview (M13.2)", () => {
  it("shows each lane's running and queued jobs with their owners and places", async () => {
    const solve = await env.DB.prepare(
      "INSERT INTO jobs (id, owner_id, type, created_at) VALUES ('s1', ?, 'solve', '2026-10-22T10:00:00.000Z')",
    )
      .bind(BOB)
      .run();
    expect(solve.meta.changes).toBe(1);
    const first = await createJob(env.DB, BOB, "noop");
    const second = await createJob(env.DB, ALICE, "noop");
    expect((await claim("vps-light")).status).toBe(200);
    const view = await overview();
    expect(view).toMatchObject({ machines: "local", paused: false, pausedAt: null, host: null, load: null, alerts: [] });
    const [solveLane, lightLane] = view.lanes;
    expect(solveLane?.lane).toBe("solve");
    expect(solveLane?.running).toEqual([]);
    expect(solveLane?.queued.map((j) => [j.id, j.ownerEmail, j.queuePosition])).toEqual([["s1", "bob@clearfea.test", 1]]);
    expect(lightLane?.running.map((j) => [j.id, j.status, j.claimedBy, j.queuePosition])).toEqual([
      [first.id, "claimed", "vps-light", null],
    ]);
    expect(lightLane?.queued.map((j) => [j.id, j.queuePosition])).toEqual([[second.id, 1]]);
  });

  it("shows the solver host's latest load, and alerts when it is missing or silent", async () => {
    expect((await overview(VPS)).alerts.map((a) => [a.kind, a.level])).toEqual([["no_host", "error"]]);
    const load = {
      cpu: 0.5,
      load1: 1,
      load5: 1,
      load15: 1,
      memoryTotalBytes: 24e9,
      memoryAvailableBytes: 20e9,
      diskTotalBytes: 300e9,
      diskFreeBytes: 250e9,
      containers: 1,
    };
    expect((await worker("/hosts/check-in", { host: "vps-1", load })).status).toBe(200);
    const online = await overview(VPS);
    expect(online.host).toMatchObject({ host: "vps-1", online: true });
    expect(online.load).toMatchObject({ host: "vps-1", cpu: 0.5, diskFreeBytes: 250e9 });
    expect(online.alerts).toEqual([]);
    await env.DB.prepare("UPDATE hosts SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 minutes')").run();
    await env.DB.prepare("UPDATE host_stats SET at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-11 minutes')").run();
    const silent = await overview(VPS);
    expect(silent.load).toBeNull();
    expect(silent.alerts).toHaveLength(1);
    expect(silent.alerts[0]?.kind).toBe("host_offline");
    expect(silent.alerts[0]?.message).toContain("Restart the VPS by hand");
  });

  it("pauses the queue so nothing is claimed, records it once, and resumes", async () => {
    const job = await createJob(env.DB, BOB, "noop");
    const paused = await setPaused(true);
    expect(paused.status).toBe(200);
    const view = validateOverviewResponse(await paused.json());
    if (!view.ok) throw new Error(view.errors.join("; "));
    expect(view.value.paused).toBe(true);
    expect(view.value.pausedAt).not.toBeNull();
    expect(view.value.alerts).toEqual([
      {
        kind: "queue_paused",
        level: "warning",
        message: "The queue is paused, so no job starts; 1 job waits. Jobs already running finish. Resume it when you are done.",
      },
    ]);
    expect((await claim("w1")).status).toBe(204);
    // Jobs still queue while it is paused.
    expect((await call("POST", "/api/jobs", { cookie: bob, json: { type: "noop" } })).status).toBe(201);
    expect((await setPaused(true)).status).toBe(200);
    expect((await setPaused(false)).status).toBe(200);
    expect((await overview()).paused).toBe(false);
    const claimed = await claim("w1");
    expect(claimed.status).toBe(200);
    expect(((await claimed.json()) as { job: { id: string } }).job.id).toBe(job.id);
    expect(await adminActions()).toEqual([
      { message: "Paused the queue: no job starts until it is resumed.", job_id: null, action: "queue_pause" },
      { message: "Resumed the queue.", job_id: null, action: "queue_resume" },
    ]);
    expect((await call("PUT", "/api/admin/queue-paused", { cookie: alice, json: { paused: "yes" } })).status).toBe(400);
  });
});

describe("Jobs and runs (M13.2)", () => {
  it("lists every user's jobs newest first with filters, and pages by creation time", async () => {
    await env.DB.batch(
      [
        ["j1", BOB, "noop", "succeeded", "2026-10-20T10:00:00.000Z"],
        ["j2", ALICE, "import", "failed", "2026-10-21T10:00:00.000Z"],
        ["j3", BOB, "solve", "queued", "2026-10-22T10:00:00.000Z"],
      ].map(([id, owner, type, status, at]) =>
        env.DB.prepare("INSERT INTO jobs (id, owner_id, type, status, created_at) VALUES (?, ?, ?, ?, ?)").bind(
          id,
          owner,
          type,
          status,
          at,
        ),
      ),
    );
    expect((await jobs()).map((j) => j.id)).toEqual(["j3", "j2", "j1"]);
    expect((await jobs("?status=active")).map((j) => j.id)).toEqual(["j3"]);
    expect((await jobs("?status=failed")).map((j) => j.id)).toEqual(["j2"]);
    expect((await jobs("?type=noop")).map((j) => j.id)).toEqual(["j1"]);
    expect((await jobs(`?user=${BOB}`)).map((j) => j.id)).toEqual(["j3", "j1"]);
    expect((await jobs("?limit=1&before=2026-10-22T10:00:00Z")).map((j) => j.id)).toEqual(["j2"]);
    expect((await jobs("?status=queued"))[0]).toMatchObject({ lane: "solve", queuePosition: 1, ownerId: BOB });
    for (const query of ["limit=0", "limit=501", "status=lost", "type=party", "before=later"]) {
      expect((await call("GET", `/api/admin/jobs?${query}`, { cookie: alice })).status, query).toBe(400);
    }
  });

  it("reads any user's job log", async () => {
    const job = await createJob(env.DB, BOB, "noop");
    expect((await claim("w1")).status).toBe(200);
    expect((await worker(`/jobs/${job.id}/heartbeat`, { workerId: "w1", stage: "working", log: "line one\n" })).status).toBe(200);
    const response = await call("GET", `/api/admin/jobs/${job.id}/log?after=0`, { cookie: alice });
    expect(response.status).toBe(200);
    const log = validateAdminJobLogResponse(await response.json());
    if (!log.ok) throw new Error(log.errors.join("; "));
    expect(log.value).toEqual({ text: "line one\n", next: 1, more: false });
    expect((await call("GET", "/api/admin/jobs/nope/log", { cookie: alice })).status).toBe(404);
    expect((await call("GET", `/api/admin/jobs/${job.id}/log?after=-1`, { cookie: alice })).status).toBe(400);
  });

  it("cancels and re-queues jobs, records who did, and records no job failure for a cancel", async () => {
    const queued = await createJob(env.DB, BOB, "noop");
    expect((await call("POST", `/api/admin/jobs/${queued.id}/requeue`, { cookie: alice })).status).toBe(409);
    expect((await call("POST", `/api/admin/jobs/${queued.id}/cancel`, { cookie: alice })).status).toBe(200);
    const running = await createJob(env.DB, BOB, "noop");
    expect((await claim("vps-light")).status).toBe(200);
    expect((await call("POST", `/api/admin/jobs/${running.id}/requeue`, { cookie: alice })).status).toBe(200);
    expect((await call("POST", "/api/admin/jobs/nope/cancel", { cookie: alice })).status).toBe(404);
    expect(await adminActions()).toEqual([
      { message: "Cancelled a no-op job (queued, try 1); nothing is charged.", job_id: queued.id, action: "job_cancel" },
      {
        message: "Queued a no-op job again, taking it from vps-light on try 1.",
        job_id: running.id,
        action: "job_requeue",
      },
    ]);
    const { results } = await env.DB.prepare("SELECT kind, level, message FROM events WHERE kind != 'admin_action'").all();
    expect(results).toEqual([
      {
        kind: "job_retried",
        level: "warning",
        message: "A no-op job was queued again after try 1 of 3 stopped (requeued_by_admin).",
      },
    ]);
  });
});

describe("the dashboard's routes (M13.2)", () => {
  it("answer the admin only", async () => {
    const job = await createJob(env.DB, BOB, "noop");
    for (const [method, path, json] of [
      ["GET", "/api/admin/overview", undefined],
      ["PUT", "/api/admin/queue-paused", { paused: true }],
      ["GET", "/api/admin/jobs", undefined],
      ["GET", `/api/admin/jobs/${job.id}/log`, undefined],
      ["POST", `/api/admin/jobs/${job.id}/cancel`, undefined],
      ["POST", `/api/admin/jobs/${job.id}/requeue`, undefined],
    ] as const) {
      expect((await call(method, path, { cookie: bob, json })).status, path).toBe(404);
    }
    expect((await overview()).paused).toBe(false);
    expect((await jobs())[0]?.status).toBe("queued");
  });
});
