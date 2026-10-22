// SPDX-License-Identifier: AGPL-3.0-or-later
// Server protections (M11.3, ADR-112): queue limits per user and in total, one job per user per
// lane at a time, the daily run count, and the per-user request rate.
import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createJob } from "../src/db/jobs";
import { app } from "../src/index";
import { queueRefusal } from "../src/jobs/limits";
import { RATE_LIMITED_MESSAGE } from "../src/session";
import { VERIFICATION_USER_ID } from "../src/session/verification";

const ALICE = "00000000-0000-4000-8000-00000000a11c";
const BOB = "00000000-0000-4000-8000-000000000b0b";
const TOKEN = "test-worker-token";

function call(method: string, path: string, options: { json?: unknown; cookie?: string; token?: string } = {}) {
  const headers: Record<string, string> = {};
  if (options.json !== undefined) headers["Content-Type"] = "application/json";
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  return exports.default.fetch(`http://localhost${path}`, {
    method,
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
  });
}

async function signIn(login: string, password: string): Promise<string> {
  const response = await call("POST", "/api/session", { json: { login, password } });
  expect(response.status).toBe(200);
  return (response.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
}

async function claim(workerId: string, jobTypes: string[] = ["noop"]): Promise<string | null> {
  const response = await call("POST", "/internal/jobs/claim", { json: { workerId, jobTypes }, token: TOKEN });
  if (response.status === 204) return null;
  return (await response.json<{ job: { id: string } }>()).job.id;
}

async function setting(name: string, value: number): Promise<void> {
  await env.DB.prepare("UPDATE settings SET value = ? WHERE name = ?").bind(value, name).run();
}

/** Makes `ids` the oldest jobs, in this order, since several may share a millisecond. */
async function inOrder(...ids: string[]): Promise<void> {
  await env.DB.batch(
    ids.map((id, i) =>
      env.DB.prepare("UPDATE jobs SET created_at = ? WHERE id = ?").bind(`2026-01-01T00:00:0${i}.000Z`, id),
    ),
  );
}

let alice = "";

beforeAll(async () => {
  const statements = env.TEST_SEED.flatMap((file) => file.queries);
  await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
  alice = await signIn("alice", "alice-local");
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM jobs"),
    env.DB.prepare("UPDATE settings SET value = 2 WHERE name = 'queue_waiting_per_user'"),
    env.DB.prepare("UPDATE settings SET value = 1 WHERE name = 'queue_running_per_user'"),
    env.DB.prepare("UPDATE settings SET value = 30 WHERE name = 'runs_per_user_per_day'"),
    env.DB.prepare("UPDATE settings SET value = 20 WHERE name = 'queue_total_cap'"),
  ]);
});

describe("queue limits (M11.3)", () => {
  it("start at the values the maintainer accepted", () => {
    const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith("0027_"));
    const sql = migration?.queries.join("\n") ?? "";
    for (const row of [
      "('queue_waiting_per_user', 2)",
      "('queue_running_per_user', 1)",
      "('runs_per_user_per_day', 30)",
      "('queue_total_cap', 20)",
    ]) {
      expect(sql).toContain(row);
    }
  });

  it("refuse a third waiting job in a lane, and take one again once a job has started", async () => {
    for (let i = 0; i < 2; i++) {
      expect((await call("POST", "/api/jobs", { json: { type: "noop" }, cookie: alice })).status).toBe(201);
    }
    const third = await call("POST", "/api/jobs", { json: { type: "noop" }, cookie: alice });
    expect(third.status).toBe(429);
    expect(await third.json()).toEqual({
      error:
        "You already have 2 imports, meshes and reports waiting to start, the most one account may queue. Wait for one to start, or cancel one, then try again.",
    });
    // The other lane is counted on its own.
    expect(await queueRefusal(env, ALICE, "solve")).toBeNull();
    expect(await claim("w1")).not.toBeNull();
    expect((await call("POST", "/api/jobs", { json: { type: "noop" }, cookie: alice })).status).toBe(201);
  });

  it("refuse any job once the whole queue is full", async () => {
    await setting("queue_total_cap", 3);
    for (let i = 0; i < 2; i++) await createJob(env.DB, BOB, "noop");
    await createJob(env.DB, BOB, "solve");
    const response = await call("POST", "/api/jobs", { json: { type: "noop" }, cookie: alice });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "The solver queue is full: 3 jobs are waiting. Try again in a few minutes.",
    });
  });

  it("count the runs a user started today, except the verification account's", async () => {
    await setting("runs_per_user_per_day", 2);
    await setting("queue_running_per_user", 5);
    for (let i = 0; i < 2; i++) {
      await createJob(env.DB, ALICE, "solve");
      expect(await claim(`w${i}`, ["solve"])).not.toBeNull();
    }
    expect(await queueRefusal(env, ALICE, "solve")).toBe(
      "You have started 2 runs today, the most one account may start in a day. Runs can be started again after midnight UTC.",
    );
    // Imports, meshes and reports are not runs.
    expect(await queueRefusal(env, ALICE, "mesh")).toBeNull();
    // Yesterday's runs do not count.
    await env.DB.prepare("UPDATE jobs SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')").run();
    expect(await queueRefusal(env, ALICE, "solve")).toBeNull();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO users (id, login, name) VALUES (?, 'verification', 'Verification')",
    )
      .bind(VERIFICATION_USER_ID)
      .run();
    for (let i = 0; i < 2; i++) {
      await createJob(env.DB, VERIFICATION_USER_ID, "solve");
      expect(await claim(`v${i}`, ["solve"])).not.toBeNull();
    }
    expect(await queueRefusal(env, VERIFICATION_USER_ID, "solve")).toBeNull();
  });
});

describe("one job per user per lane at a time (M11.3)", () => {
  it("passes over a user's next job while one of theirs runs in its lane, for another user's", async () => {
    const first = await createJob(env.DB, ALICE, "noop");
    const second = await createJob(env.DB, ALICE, "noop");
    const bobs = await createJob(env.DB, BOB, "noop");
    await inOrder(first.id, second.id, bobs.id);
    expect(await claim("w1")).toBe(first.id);
    expect(await claim("w2")).toBe(bobs.id);
    expect(await claim("w3")).toBeNull();
    // A job in the other lane is not held back.
    const solve = await createJob(env.DB, ALICE, "solve");
    expect(await claim("w3", ["solve"])).toBe(solve.id);
    // Once the first has ended, the second is taken.
    await env.DB.prepare("UPDATE jobs SET status = 'succeeded' WHERE id = ?").bind(first.id).run();
    expect(await claim("w4")).toBe(second.id);
  });

  it("follows the setting", async () => {
    await setting("queue_running_per_user", 2);
    const first = await createJob(env.DB, ALICE, "noop");
    const second = await createJob(env.DB, ALICE, "noop");
    await inOrder(first.id, second.id);
    expect(await claim("w1")).toBe(first.id);
    expect(await claim("w2")).toBe(second.id);
  });
});

describe("the request rate (M11.3)", () => {
  it("refuses a signed-in user's request over the limit, with when to try again", async () => {
    const keys: string[] = [];
    const limiter = {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: keys.length <= 1 };
      },
    };
    const withLimit = { ...env, API_RATE_LIMIT: limiter };
    expect((await app.request("/api/jobs", { headers: { Cookie: alice } }, withLimit)).status).toBe(200);
    const over = await app.request("/api/jobs", { headers: { Cookie: alice } }, withLimit);
    expect(over.status).toBe(429);
    expect(over.headers.get("Retry-After")).toBe("60");
    expect(await over.json()).toEqual({ error: RATE_LIMITED_MESSAGE });
    // Counted once per request, by user, also on a path that several routers share.
    await app.request("/api/runs/unknown/report", { headers: { Cookie: alice } }, withLimit);
    expect(keys).toEqual([ALICE, ALICE, ALICE]);
  });
});
