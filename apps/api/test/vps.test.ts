// SPDX-License-Identifier: AGPL-3.0-or-later
// API VPS mode (M12.4, ADR-120): the solver host's check-ins, the refusal while it is silent, the
// queue position per lane, and the wallet that shows usage only (ADR-106 item 6).
import { validateAdminResponse, validateHostCheckInResponse, validateJobResponse, validateWalletResponse } from "@clearfea/spec";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { latestHost } from "../src/db/hosts";
import { createJob } from "../src/db/jobs";
import { machineMode } from "../src/db/machines";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { HOST_OFFLINE } from "../src/jobs/limits";
import { balanceRefuses } from "../src/selfHosting";

const BOB = "00000000-0000-4000-8000-000000000b0b";
const TOKEN = "test-worker-token";
const VPS: Env = { ...env, MACHINES: "vps", ADMIN_EMAIL: "alice@clearfea.test" };

/** The app with MACHINES=vps, as the live site will run from M12.7. */
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
  return Promise.resolve(app.request(`http://localhost${path}`, { method, headers, body }, options.bindings ?? VPS));
}

function checkIn(host: string, managerVersion?: string): Promise<Response> {
  return call("POST", "/internal/hosts/check-in", { json: { host, managerVersion }, token: TOKEN });
}

/** Moves the host's last check-in this many seconds into the past. */
async function silent(host: string, seconds: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE hosts SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${seconds} seconds') WHERE name = ?`,
  )
    .bind(host)
    .run();
}

let alice = "";

beforeAll(async () => {
  const statements = env.TEST_SEED.flatMap((file) => file.queries);
  await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
  const response = await call("POST", "/api/session", { json: { login: "alice", password: "alice-local" } });
  expect(response.status).toBe(200);
  alice = (response.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
});

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM jobs"), env.DB.prepare("DELETE FROM hosts")]);
});

describe("machine modes (M12.4)", () => {
  it("reads MACHINES as cloud, vps or local", () => {
    expect(machineMode({ MACHINES: "vps" })).toBe("vps");
    expect(machineMode({ MACHINES: " VPS " })).toBe("vps");
    expect(machineMode({ MACHINES: "cloud" })).toBe("cloud");
    expect(machineMode({ MACHINES: undefined })).toBe("local");
    expect(machineMode({ MACHINES: "aws" })).toBe("local");
  });

  it("lets no balance refuse work on the solver host or when self-hosted (ADR-106 item 6, ADR-084)", () => {
    expect(balanceRefuses({ MACHINES: "vps" })).toBe(false);
    expect(balanceRefuses({ SELF_HOSTED: "true" })).toBe(false);
    expect(balanceRefuses({ MACHINES: "cloud" })).toBe(true);
    expect(balanceRefuses({})).toBe(true);
  });
});

describe("host check-ins (M12.4)", () => {
  it("need the worker token and a host name", async () => {
    expect((await call("POST", "/internal/hosts/check-in", { json: { host: "vps-1" } })).status).toBe(401);
    expect((await call("POST", "/internal/hosts/check-in", { json: {}, token: TOKEN })).status).toBe(400);
    expect((await checkIn("vps 1")).status).toBe(400);
  });

  it("are recorded, and a check-in after a silence starts a new run of them", async () => {
    const answer = validateHostCheckInResponse(await (await checkIn("vps-1", "0.1.0")).json());
    expect(answer.ok && answer.value).toEqual({ intervalSeconds: 30 });
    const first = await latestHost(env.DB);
    expect(first).toMatchObject({ host: "vps-1", online: true, managerVersion: "0.1.0" });

    await env.DB.prepare("UPDATE hosts SET first_seen_at = '2026-01-01T00:00:00.000Z'").run();
    await checkIn("vps-1", "0.1.1");
    expect(await latestHost(env.DB)).toMatchObject({ firstSeenAt: "2026-01-01T00:00:00.000Z", managerVersion: "0.1.1" });

    await silent("vps-1", 121);
    expect((await latestHost(env.DB))?.online).toBe(false);
    await checkIn("vps-1", "0.1.1");
    const back = await latestHost(env.DB);
    expect(back?.online).toBe(true);
    expect(back?.firstSeenAt).not.toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("refusal while the solver host is silent (M12.4, ADR-106 item 3)", () => {
  it("refuses every job when no host ever checked in or the last check-in is over 2 minutes old", async () => {
    const never = await call("POST", "/api/jobs", { json: { type: "noop" }, cookie: alice });
    expect(never.status).toBe(503);
    expect(await never.json()).toEqual({ error: HOST_OFFLINE });

    await checkIn("vps-1");
    expect((await call("POST", "/api/jobs", { json: { type: "noop" }, cookie: alice })).status).toBe(201);

    await silent("vps-1", 119);
    expect((await call("POST", "/api/jobs", { json: { type: "noop" }, cookie: alice })).status).toBe(201);

    await silent("vps-1", 121);
    const offline = await call("POST", "/api/jobs", { json: { type: "noop" }, cookie: alice });
    expect(offline.status).toBe(503);
    expect(await offline.json()).toEqual({ error: HOST_OFFLINE });
  });

  it("refuses nothing for the host on the local worker", async () => {
    const local = await call("POST", "/api/jobs", { json: { type: "noop" }, cookie: alice, bindings: env });
    expect(local.status).toBe(201);
  });
});

describe("queue position on the solver host (M12.4)", () => {
  it("counts the queued jobs of the job's own lane, whatever their machine size", async () => {
    await checkIn("vps-1");
    // Ahead of Alice's job: one of Bob's runs (solve lane) and one of his meshes (light lane).
    const solve = await createJob(env.DB, BOB, "solve");
    const mesh = await createJob(env.DB, BOB, "mesh");
    const response = await call("POST", "/api/jobs", { json: { type: "noop" }, cookie: alice });
    const mine = ((await response.json()) as { job: { id: string } }).job.id;
    await env.DB.batch(
      [solve.id, mesh.id, mine].map((id, i) =>
        env.DB.prepare("UPDATE jobs SET created_at = ? WHERE id = ?").bind(`2026-01-01T00:00:0${i}.000Z`, id),
      ),
    );

    const onHost = validateJobResponse(await (await call("GET", `/api/jobs/${mine}`, { cookie: alice })).json());
    if (!onHost.ok) throw new Error(onHost.errors.join(" "));
    expect(onHost.value.wait?.queuePosition).toBe(2);

    // Locally the place is among the jobs of the same machine size: all three share the default.
    const local = validateJobResponse(
      await (await call("GET", `/api/jobs/${mine}`, { cookie: alice, bindings: env })).json(),
    );
    if (!local.ok) throw new Error(local.errors.join(" "));
    expect(local.value.wait?.queuePosition).toBe(3);
  });
});

describe("wallet and admin page on the solver host (M12.4)", () => {
  it("say the wallet shows usage only", async () => {
    const onHost = validateWalletResponse(await (await call("GET", "/api/wallet", { cookie: alice })).json());
    expect(onHost.ok && onHost.value.usageOnly).toBe(true);
    const local = validateWalletResponse(await (await call("GET", "/api/wallet", { cookie: alice, bindings: env })).json());
    expect(local.ok && local.value.usageOnly).toBe(false);
  });

  it("show the solver host to the admin", async () => {
    const before = validateAdminResponse(await (await call("GET", "/api/admin", { cookie: alice })).json());
    if (!before.ok) throw new Error(before.errors.join(" "));
    expect(before.value.machines).toBe("vps");
    expect(before.value.solverHost).toBeNull();

    await checkIn("vps-1", "0.1.0");
    const after = validateAdminResponse(await (await call("GET", "/api/admin", { cookie: alice })).json());
    if (!after.ok) throw new Error(after.errors.join(" "));
    expect(after.value.solverHost).toMatchObject({ host: "vps-1", online: true, managerVersion: "0.1.0" });
  });
});
