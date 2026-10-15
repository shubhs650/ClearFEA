// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  validateJobListResponse,
  validateJobResponse,
  validateSessionResponse,
} from "@clearfea/spec";
import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/session/password";
import { issueToken, readToken } from "../src/session/token";

const ALICE = { login: "alice", password: "alice-local" };
const BOB = { login: "bob", password: "bob-local" };

function call(
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string; token?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  return exports.default.fetch(`http://localhost${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

/** Signs in and returns the cookie to send back, as a browser would. */
async function signIn(credentials: { login: string; password: string }): Promise<string> {
  const response = await call("POST", "/api/session", { body: credentials });
  expect(response.status).toBe(200);
  const header = response.headers.get("Set-Cookie") ?? "";
  return header.split(";")[0] ?? "";
}

beforeAll(async () => {
  // The same file `pnpm --filter @clearfea/api db:seed` applies to the local database.
  const statements = env.TEST_SEED.flatMap((file) => file.queries);
  expect(statements).toHaveLength(2);
  await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
});

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM ledger_entries").run();
  await env.DB.prepare("DELETE FROM jobs").run();
});

describe("password hashes", () => {
  it("verify the right password only", async () => {
    const hash = await hashPassword("correct horse");
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("wrong horse", hash)).toBe(false);
  });

  it("never match a malformed hash", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "md5$1$a$b")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2-sha256$999999999$AA==$AA==")).toBe(false);
  });
});

describe("session tokens", () => {
  it("name the user until they expire", async () => {
    const token = await issueToken("secret", "user-1", 1_000);
    expect(await readToken("secret", token, 999)).toBe("user-1");
    expect(await readToken("secret", token, 1_000)).toBeNull();
  });

  it("are refused when altered or signed with another key", async () => {
    const token = await issueToken("secret", "user-1", 1_000);
    expect(await readToken("other", token, 0)).toBeNull();
    expect(await readToken("secret", token.replace("user-1", "user-2"), 0)).toBeNull();
    expect(await readToken("secret", token.replace(".1000.", ".9999."), 0)).toBeNull();
    expect(await readToken("secret", "v1.user-1.1000", 0)).toBeNull();
  });
});

describe("POST /api/session", () => {
  it("signs a seeded user in with a cookie scripts cannot read", async () => {
    const response = await call("POST", "/api/session", { body: ALICE });
    expect(response.status).toBe(200);
    const body = validateSessionResponse(await response.json());
    expect(body.ok && body.value.user).toMatchObject({ login: "alice", name: "Alice (test user)" });
    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(cookie).toMatch(/^clearfea_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it("gives the same answer for a wrong password and an unknown login", async () => {
    const wrong = await call("POST", "/api/session", { body: { login: "alice", password: "nope" } });
    const unknown = await call("POST", "/api/session", { body: { login: "carol", password: "nope" } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.headers.get("Set-Cookie")).toBeNull();
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it("refuses a body that is not sent as JSON", async () => {
    const response = await exports.default.fetch("http://localhost/api/session", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(ALICE),
    });
    expect(response.status).toBe(400);
    expect((await response.json<{ error: string }>()).error).toContain("application/json");
  });

  it("refuses a malformed body with a plain message", async () => {
    const response = await call("POST", "/api/session", { body: { login: "alice" } });
    expect(response.status).toBe(400);
    expect((await response.json<{ error: string }>()).error).toContain("password");
  });
});

describe("GET and DELETE /api/session", () => {
  it("names the signed-in user", async () => {
    const cookie = await signIn(BOB);
    const response = await call("GET", "/api/session", { cookie });
    expect(response.status).toBe(200);
    expect((await response.json<{ user: { login: string } }>()).user.login).toBe("bob");
  });

  it("answers 401 without a cookie or with a forged one", async () => {
    expect((await call("GET", "/api/session")).status).toBe(401);
    const forged = `clearfea_session=${await issueToken("not-the-secret", "00000000-0000-4000-8000-00000000a11c", 4_000_000_000)}`;
    expect((await call("GET", "/api/session", { cookie: forged })).status).toBe(401);
  });

  it("signs out by clearing the cookie", async () => {
    const response = await call("DELETE", "/api/session", { cookie: await signIn(ALICE) });
    expect(response.status).toBe(204);
    expect(response.headers.get("Set-Cookie")).toMatch(/^clearfea_session=;.*Max-Age=0/);
  });
});

describe("/api/jobs", () => {
  it("needs a signed-in user", async () => {
    expect((await call("GET", "/api/jobs")).status).toBe(401);
    expect((await call("POST", "/api/jobs", { body: { type: "noop" } })).status).toBe(401);
    expect((await call("GET", "/api/jobs/anything")).status).toBe(401);
  });

  it("queues a noop job that the worker takes to succeeded", async () => {
    const cookie = await signIn(ALICE);
    const created = await call("POST", "/api/jobs", { cookie, body: { type: "noop" } });
    expect(created.status).toBe(201);
    const checked = validateJobResponse(await created.json());
    if (!checked.ok) throw new Error(checked.errors.join(" "));
    const { job } = checked.value;
    expect(job.status).toBe("queued");

    const token = env.WORKER_TOKEN;
    const body = { workerId: "w1", jobTypes: ["noop"] };
    expect((await call("POST", "/internal/jobs/claim", { token, body })).status).toBe(200);
    await call("POST", `/internal/jobs/${job.id}/complete`, {
      token,
      body: { workerId: "w1", metering: { billableMs: 2500 }, status: "succeeded" },
    });

    const read = await call("GET", `/api/jobs/${job.id}`, { cookie });
    const after = await read.json<{ job: { status: string; finishedAt: string | null } }>();
    expect(after.job.status).toBe("succeeded");
    expect(after.job.finishedAt).not.toBeNull();
  });

  it("only queues noop jobs directly", async () => {
    const cookie = await signIn(ALICE);
    const response = await call("POST", "/api/jobs", { cookie, body: { type: "solve" } });
    expect(response.status).toBe(400);
  });

  it("lists the user's jobs, newest first", async () => {
    const cookie = await signIn(ALICE);
    const first = await (await call("POST", "/api/jobs", { cookie, body: { type: "noop" } })).json<{ job: { id: string } }>();
    await env.DB.prepare("UPDATE jobs SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?")
      .bind(first.job.id)
      .run();
    const second = await (await call("POST", "/api/jobs", { cookie, body: { type: "noop" } })).json<{ job: { id: string } }>();
    const listed = validateJobListResponse(await (await call("GET", "/api/jobs", { cookie })).json());
    if (!listed.ok) throw new Error(listed.errors.join(" "));
    expect(listed.value.jobs.map((job) => job.id)).toEqual([second.job.id, first.job.id]);
  });

  it("does not let one user read or list another user's jobs", async () => {
    const alice = await signIn(ALICE);
    const bob = await signIn(BOB);
    const created = await call("POST", "/api/jobs", { cookie: alice, body: { type: "noop" } });
    const { job } = await created.json<{ job: { id: string } }>();

    expect((await call("GET", `/api/jobs/${job.id}`, { cookie: bob })).status).toBe(404);
    expect((await call("GET", "/api/jobs/no-such-id", { cookie: bob })).status).toBe(404);
    const listed = await (await call("GET", "/api/jobs", { cookie: bob })).json<{ jobs: unknown[] }>();
    expect(listed.jobs).toEqual([]);
    expect((await call("GET", `/api/jobs/${job.id}`, { cookie: alice })).status).toBe(200);
  });

  it("refuses a valid cookie whose user no longer exists", async () => {
    const cookie = `clearfea_session=${await issueToken(env.SESSION_SECRET ?? "", "gone", 4_000_000_000)}`;
    expect((await call("GET", "/api/jobs", { cookie })).status).toBe(401);
  });
});
