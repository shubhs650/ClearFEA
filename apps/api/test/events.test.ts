// SPDX-License-Identifier: AGPL-3.0-or-later
// The event log (M13.1, ADR-113, ADR-125): password and verification sign-ins and refusals, jobs
// that failed or were queued again, the solver host coming online, going silent and its manager
// restarting, and the admin's read of the log with its filters. Google sign-ins and the admin's
// actions are in googleSignIn.test.ts.
import { type AdminEvent, validateEventsResponse } from "@clearfea/spec";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recordSilentHosts } from "../src/db/events";
import { createJob } from "../src/db/jobs";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { sweepLostJobs } from "../src/jobs/outcome";

const TOKEN = "test-worker-token";
const VERIFY_TOKEN = "v".repeat(40);
const BINDINGS: Env = { ...env, ADMIN_EMAIL: "alice@clearfea.test", VERIFY_TOKEN };
const ALICE = "00000000-0000-4000-8000-000000000a11";
const BOB = "00000000-0000-4000-8000-000000000b0b";

function call(
  method: string,
  path: string,
  options: { json?: unknown; cookie?: string; token?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.json !== undefined) headers["Content-Type"] = "application/json";
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const body = options.json !== undefined ? JSON.stringify(options.json) : undefined;
  return Promise.resolve(app.request(`http://localhost${path}`, { method, headers, body }, BINDINGS));
}

const worker = (path: string, json: unknown) => call("POST", `/internal${path}`, { json, token: TOKEN });

async function signIn(login: string, password: string): Promise<Response> {
  return call("POST", "/api/session", { json: { login, password } });
}

let alice = "";

async function events(query = ""): Promise<AdminEvent[]> {
  const response = await call("GET", `/api/admin/events${query}`, { cookie: alice });
  expect(response.status).toBe(200);
  const answer = validateEventsResponse(await response.json());
  if (!answer.ok) throw new Error(answer.errors.join("; "));
  return answer.value.events;
}

/** The events after the admin's own sign-in, oldest first, as kind, level, user, job, host and message. */
async function log(query = "") {
  return (await events(query))
    .reverse()
    .map((e) => [e.kind, e.level, e.userId, e.jobId, e.host, e.message]);
}

beforeAll(async () => {
  const statements = env.TEST_SEED.flatMap((file) => file.queries);
  await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
  const response = await signIn("alice", "alice-local");
  expect(response.status).toBe(200);
  alice = (response.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM events"),
    env.DB.prepare("DELETE FROM hosts"),
    env.DB.prepare("DELETE FROM job_stats"),
    env.DB.prepare("DELETE FROM ledger_entries WHERE reason != 'grant'"),
    env.DB.prepare("DELETE FROM jobs"),
  ]);
});

describe("sign-ins in the event log (M13.1)", () => {
  it("records password sign-ins and refusals, without the login typed when it names nobody", async () => {
    expect((await signIn("bob", "bob-local")).status).toBe(200);
    expect((await signIn("bob", "wrong")).status).toBe(401);
    expect((await signIn("my-secret-password", "oops")).status).toBe(401);
    expect(await log()).toEqual([
      ["sign_in", "info", BOB, null, null, "bob signed in with a password."],
      ["sign_in_refused", "warning", BOB, null, null, "A password sign-in as bob was refused: wrong password."],
      ["sign_in_refused", "warning", null, null, null, "A password sign-in with an unknown login was refused."],
    ]);
    const stored = await env.DB.prepare("SELECT message || COALESCE(detail, '') AS text FROM events").all<{ text: string }>();
    expect(stored.results.some((r) => r.text.includes("my-secret-password"))).toBe(false);
  });

  it("records the verification account's sign-in and a wrong token", async () => {
    const wrong = await call("POST", "/api/session/verification", { token: "x".repeat(40) });
    expect(wrong.status).toBe(401);
    const right = await call("POST", "/api/session/verification", { token: VERIFY_TOKEN });
    expect(right.status).toBe(200);
    const [refused, signedIn] = (await events()).reverse();
    expect(refused).toMatchObject({ kind: "sign_in_refused", userId: null, detail: { method: "verification_token" } });
    expect(signedIn).toMatchObject({ kind: "sign_in", detail: { method: "verification_token" } });
    await env.DB.prepare("DELETE FROM verification_failures").run();
  });
});

describe("jobs in the event log (M13.1)", () => {
  const fail = (jobId: string, workerId: string, failureCategory: string, failureCause: string) =>
    worker(`/jobs/${jobId}/complete`, {
      workerId,
      status: "failed",
      failureCategory,
      failureCause,
      failureMessage: failureCategory === "user_fault" ? "The setup has no supports." : undefined,
      metering: { billableMs: 1000 },
    });

  async function claim(workerId: string): Promise<string> {
    const response = await worker("/jobs/claim", { workerId, jobTypes: ["noop"] });
    expect(response.status).toBe(200);
    return ((await response.json()) as { job: { id: string } }).job.id;
  }

  it("records a failure through the user's setup as information, and not a success", async () => {
    const first = await createJob(env.DB, BOB, "noop");
    expect(await claim("w1")).toBe(first.id);
    expect((await fail(first.id, "w1", "user_fault", "deck_rejected")).status).toBe(200);
    const second = await createJob(env.DB, BOB, "noop");
    await claim("w1");
    const done = await worker(`/jobs/${second.id}/complete`, {
      workerId: "w1",
      status: "succeeded",
      metering: { billableMs: 1000 },
      result: {},
    });
    expect(done.status).toBe(200);
    const [only, ...others] = await events();
    expect(others).toEqual([]);
    expect(only).toMatchObject({
      kind: "job_failed",
      level: "info",
      userId: BOB,
      jobId: first.id,
      message: "A no-op job failed: the user's setup (deck_rejected).",
      detail: {
        type: "noop",
        attempt: 1,
        worker: "w1",
        category: "user_fault",
        cause: "deck_rejected",
        failureMessage: "The setup has no supports.",
      },
    });
  });

  it("records each try a machine fault ended, and the failure after the last as an error", async () => {
    const job = await createJob(env.DB, BOB, "noop");
    for (const workerId of ["vps-light", "vps-light", "vps-light"]) {
      expect(await claim(workerId)).toBe(job.id);
      expect((await fail(job.id, workerId, "platform_fault", "container_exited")).status).toBe(200);
    }
    expect(await log()).toEqual([
      ["job_retried", "warning", BOB, job.id, null, "A no-op job was queued again after try 1 of 3 stopped (container_exited)."],
      ["job_retried", "warning", BOB, job.id, null, "A no-op job was queued again after try 2 of 3 stopped (container_exited)."],
      ["job_failed", "error", BOB, job.id, null, "A no-op job failed on try 3: a fault in ClearFEA (container_exited)."],
    ]);
    expect(await log("?kind=job_failed&level=error")).toHaveLength(1);
    expect(await log(`?user=${ALICE}`)).toEqual([]);
  });

  it("records a job whose worker went silent", async () => {
    const job = await createJob(env.DB, BOB, "noop");
    await claim("w1");
    await env.DB.prepare(
      "UPDATE jobs SET attempt = 3, heartbeat_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour') WHERE id = ?",
    )
      .bind(job.id)
      .run();
    await sweepLostJobs(BINDINGS);
    expect(await log()).toEqual([
      ["job_failed", "error", BOB, job.id, null, "A no-op job failed on try 3: a fault in ClearFEA (worker_lost)."],
    ]);
  });
});

describe("the solver host in the event log (M13.1)", () => {
  const checkIn = (startedAt: string) =>
    worker("/hosts/check-in", { host: "vps-1", managerVersion: "0.12.0", startedAt });
  const silence = () =>
    env.DB.prepare("UPDATE hosts SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 minutes')").run();

  it("records the first check-in, a manager restart, a silence once and the return", async () => {
    expect((await checkIn("2026-10-22T10:00:00.000Z")).status).toBe(200);
    expect((await checkIn("2026-10-22T10:00:00.000Z")).status).toBe(200);
    expect((await checkIn("2026-10-22T11:00:00.000Z")).status).toBe(200);
    // Silent for less than 120 s: not offline yet.
    expect(await recordSilentHosts(env.DB, 120)).toEqual([]);
    await silence();
    expect(await recordSilentHosts(env.DB, 120)).toEqual(["vps-1"]);
    expect(await recordSilentHosts(env.DB, 120)).toEqual([]);
    // A manager that comes back after a silence is the host online again, not a restart.
    expect((await checkIn("2026-10-22T12:00:00.000Z")).status).toBe(200);
    const kinds = (await events()).reverse().map((e) => [e.kind, e.level, e.host]);
    expect(kinds).toEqual([
      ["host_online", "info", "vps-1"],
      ["manager_started", "info", "vps-1"],
      ["host_offline", "error", "vps-1"],
      ["host_online", "info", "vps-1"],
    ]);
    const [first, restart, offline, back] = (await events()).reverse();
    expect(first?.message).toBe("The solver host vps-1 checked in for the first time (manager 0.12.0).");
    expect(restart?.message).toBe(
      "The compute manager on vps-1 restarted at 2026-10-22T11:00:00.000Z (manager 0.12.0); running jobs carry on in their containers.",
    );
    expect(offline?.message).toMatch(/^The solver host vps-1 has not checked in since .+\. New jobs are refused until it does; restart it by hand\.$/);
    expect(back?.message).toMatch(/^The solver host vps-1 is online again \(manager 0\.12\.0\); it was last heard from at /);
    // Silent again later: a second offline event. (The events move back first, as the silence is
    // made up by moving the last check-in back.)
    await env.DB.prepare("UPDATE events SET at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')").run();
    await silence();
    expect(await recordSilentHosts(env.DB, 120)).toEqual(["vps-1"]);
  });

  it("takes a check-in without a start time, as from an older manager", async () => {
    expect((await worker("/hosts/check-in", { host: "vps-1" })).status).toBe(200);
    expect((await worker("/hosts/check-in", { host: "vps-1" })).status).toBe(200);
    expect((await events()).map((e) => e.kind)).toEqual(["host_online"]);
  });
});

describe("the admin's read of the event log (M13.1)", () => {
  it("answers the admin only, pages by time and refuses bad filters", async () => {
    const bob = await signIn("bob", "bob-local");
    const bobCookie = (bob.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
    expect((await call("GET", "/api/admin/events", { cookie: bobCookie })).status).toBe(404);

    await env.DB.batch(
      ["2026-10-20T10:00:00.000Z", "2026-10-21T10:00:00.000Z", "2026-10-22T10:00:00.000Z"].map((at) =>
        env.DB.prepare("INSERT INTO events (at, kind, level, message) VALUES (?, 'host_online', 'info', ?)").bind(at, at),
      ),
    );
    const timed = "?kind=host_online";
    expect((await events(timed)).map((e) => e.at)).toEqual([
      "2026-10-22T10:00:00.000Z",
      "2026-10-21T10:00:00.000Z",
      "2026-10-20T10:00:00.000Z",
    ]);
    expect((await events(`${timed}&limit=1&before=2026-10-22T10:00:00Z`)).map((e) => e.at)).toEqual([
      "2026-10-21T10:00:00.000Z",
    ]);
    expect((await events(`${timed}&since=2026-10-21T00:00:00Z`)).map((e) => e.at)).toHaveLength(2);
    expect(await events("?level=error")).toEqual([]);

    for (const query of ["limit=0", "limit=501", "kind=party", "level=fatal", "since=soon", "before=later"]) {
      expect((await call("GET", `/api/admin/events?${query}`, { cookie: alice })).status, query).toBe(400);
    }
  });
});
