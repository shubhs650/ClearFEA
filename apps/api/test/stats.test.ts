// SPDX-License-Identifier: AGPL-3.0-or-later
// Statistics for support (M12.3, ADR-109, ADR-123): one row per try of a job, from its claim
// through its heartbeats to its end, with what the compute manager measured of its container;
// the solver host's load from its check-ins; and the admin's reads of both.
import { validateHostLoadResponse, validateJobTriesResponse, type JobTry } from "@clearfea/spec";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createJob } from "../src/db/jobs";
import { modelSize, purgeHostLoad } from "../src/db/stats";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { sweepLostJobs } from "../src/jobs/outcome";

const TOKEN = "test-worker-token";
const BINDINGS: Env = { ...env, ADMIN_EMAIL: "alice@clearfea.test" };
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

async function claim(workerId: string, jobTypes: string[] = ["noop"]): Promise<string> {
  const response = await worker("/jobs/claim", { workerId, jobTypes });
  expect(response.status).toBe(200);
  return ((await response.json()) as { job: { id: string } }).job.id;
}

const beat = (jobId: string, workerId: string, stage: string) =>
  worker(`/jobs/${jobId}/heartbeat`, { workerId, stage });

/** Puts the try's current stage this many seconds into the past, as if heartbeats had come since. */
async function inStageFor(jobId: string, seconds: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE job_stats SET stage_started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${seconds} seconds')
      WHERE job_id = ? AND ended_at IS NULL`,
  )
    .bind(jobId)
    .run();
}

const CONTAINER = {
  host: "vps-1",
  lane: "light",
  image: `sha256:${"a".repeat(64)}`,
  exitCode: 0,
  outOfMemory: false,
  runMs: 20000,
  samples: 4,
  peakMemoryBytes: 512 * 2 ** 20,
  cpuSeconds: 10,
  cpuPeak: 0.9,
  diskWrittenBytes: 4096,
};

let alice = "";

async function tries(query = ""): Promise<JobTry[]> {
  const response = await call("GET", `/api/admin/stats/jobs${query}`, { cookie: alice });
  expect(response.status).toBe(200);
  const answer = validateJobTriesResponse(await response.json());
  if (!answer.ok) throw new Error(answer.errors.join("; "));
  return answer.value.tries;
}

beforeAll(async () => {
  const statements = env.TEST_SEED.flatMap((file) => file.queries);
  await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
  const response = await call("POST", "/api/session", { json: { login: "alice", password: "alice-local" } });
  expect(response.status).toBe(200);
  alice = (response.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM job_stats"),
    env.DB.prepare("DELETE FROM host_stats"),
    env.DB.prepare("DELETE FROM ledger_entries"),
    env.DB.prepare("DELETE FROM jobs"),
  ]);
});

describe("a try's statistics (M12.3)", () => {
  it("follow a job from its claim through its stages to its end and its container", async () => {
    const created = await createJob(env.DB, BOB, "noop");
    await env.DB.prepare("UPDATE jobs SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 seconds') WHERE id = ?")
      .bind(created.id)
      .run();
    const jobId = await claim("vps-1-light");
    await inStageFor(jobId, 3);
    await beat(jobId, "vps-1-light", "downloading");
    await inStageFor(jobId, 2);
    // The same stage again writes nothing: its time keeps running.
    await beat(jobId, "vps-1-light", "downloading");
    await beat(jobId, "vps-1-light", "noop");
    await inStageFor(jobId, 5);
    const running = (await tries())[0];
    expect(running).toMatchObject({ attempt: 1, workerId: "vps-1-light", lastStage: "noop", endedAt: null, status: null });

    const done = await worker(`/jobs/${jobId}/complete`, {
      workerId: "vps-1-light",
      status: "succeeded",
      metering: { billableMs: 10000 },
      result: {},
    });
    expect(done.status).toBe(200);
    expect((await worker(`/jobs/${jobId}/stats`, { workerId: "vps-1-light", ...CONTAINER })).status).toBe(204);

    const [one, ...others] = await tries();
    expect(others).toEqual([]);
    expect(one).toMatchObject({
      jobId,
      jobType: "noop",
      ownerId: BOB,
      attempt: 1,
      status: "succeeded",
      lastStage: "noop",
      host: "vps-1",
      lane: "light",
      exitCode: 0,
      signal: null,
      outOfMemory: false,
      runMs: 20000,
      peakMemoryBytes: 512 * 2 ** 20,
      cpuSeconds: 10,
      cpuAverage: 0.5,
      cpuPeak: 0.9,
      diskWrittenBytes: 4096,
    });
    expect(one?.queueWaitMs).toBeGreaterThanOrEqual(6000);
    expect(one?.queueWaitMs).toBeLessThan(30000);
    // Heartbeats in tests come within milliseconds, so each stage holds the time set above.
    expect(Object.keys(one?.stageMs ?? {})).toEqual(["starting", "downloading", "noop"]);
    expect(one?.stageMs.starting).toBeGreaterThanOrEqual(3000);
    expect(one?.stageMs.downloading).toBeGreaterThanOrEqual(2000);
    expect(one?.stageMs.noop).toBeGreaterThanOrEqual(5000);
    for (const ms of Object.values(one?.stageMs ?? {})) expect(ms).toBeLessThan(10000);

    // The container's statistics come once per try.
    expect((await worker(`/jobs/${jobId}/stats`, { workerId: "vps-1-light", ...CONTAINER })).status).toBe(404);
    expect((await worker(`/jobs/${jobId}/stats`, { workerId: "vps-1-light" })).status).toBe(400);
  });

  it("keep one row per try when a job is queued again, each with its own wait", async () => {
    await createJob(env.DB, BOB, "noop");
    const jobId = await claim("vps-1-light");
    await worker(`/jobs/${jobId}/complete`, {
      workerId: "vps-1-light",
      status: "failed",
      failureCategory: "platform_fault",
      failureCause: "container_exited",
      metering: { billableMs: 1000 },
    });
    // As a re-queue after a platform fault does it (M12.2): the same job waits again.
    await env.DB.prepare("UPDATE jobs SET status = 'queued', claimed_by = NULL, claimed_at = NULL, heartbeat_at = NULL WHERE id = ?")
      .bind(jobId)
      .run();
    await env.DB.prepare(
      "UPDATE job_stats SET ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 seconds') WHERE job_id = ?",
    )
      .bind(jobId)
      .run();
    expect(await claim("vps-2-light")).toBe(jobId);
    // The first container's statistics, sent after the re-queue, still go to the first try.
    const killed = { ...CONTAINER, exitCode: 137, outOfMemory: true };
    expect((await worker(`/jobs/${jobId}/stats`, { workerId: "vps-1-light", ...killed })).status).toBe(204);

    const [second, first] = await tries(`?job=${jobId}`);
    expect(first).toMatchObject({
      attempt: 1,
      status: "failed",
      failureCategory: "platform_fault",
      failureCause: "container_exited",
      exitCode: 137,
      signal: 9,
      outOfMemory: true,
    });
    expect(second).toMatchObject({ attempt: 2, workerId: "vps-2-light", status: null, host: null });
    expect(second?.queuedAt).toBe(first?.endedAt);
    expect(second?.queueWaitMs).toBeGreaterThanOrEqual(3000);
  });

  it("end with the job when its worker is lost", async () => {
    await createJob(env.DB, BOB, "noop");
    const jobId = await claim("vps-1-light");
    await beat(jobId, "vps-1-light", "noop");
    await env.DB.prepare("UPDATE jobs SET heartbeat_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").bind(jobId).run();
    expect(await sweepLostJobs(BINDINGS)).toBe(1);
    expect((await tries())[0]).toMatchObject({ status: "failed", failureCause: "worker_lost", lastStage: "noop" });
  });

  it("name the model's size, unknowns and solver", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO projects (id, owner_id, name) VALUES ('p-stats', ?, 'P')").bind(BOB),
      env.DB.prepare(
        "INSERT INTO geometries (id, owner_id, project_id, name, size_bytes) VALUES ('g-stats', ?, 'p-stats', 'g.step', 1)",
      ).bind(BOB),
      env.DB.prepare(
        `INSERT INTO meshes (id, owner_id, geometry_id, size, element_order, status, node_count, element_count)
         VALUES ('m-stats', ?, 'g-stats', '{"value":5,"unit":"mm"}', 2, 'ready', 1000, 500)`,
      ).bind(BOB),
    ]);
    const solve = (spec: Record<string, unknown>) =>
      createJob(env.DB, BOB, "solve", null, { meshId: "m-stats", spec: { version: 1, ...spec } });
    const succeeded = { status: "succeeded", result: {} } as const;
    expect(await modelSize(env.DB, await solve({ analysis: "linear_static", solver: "spooles" }), succeeded)).toEqual({
      nodes: 1000,
      elements: 500,
      dofs: 3000,
      solver: "spooles",
      analysis: "linear_static",
    });
    // A spec saved before ADR-063 names no solver: PaStiX's default.
    expect(await modelSize(env.DB, await solve({ analysis: "steady_thermal" }), succeeded)).toMatchObject({
      dofs: 1000,
      solver: "pastix",
    });
    const mesh = await createJob(env.DB, BOB, "mesh");
    expect(await modelSize(env.DB, mesh, { status: "succeeded", result: { nodes: 40, elements: 12 } })).toEqual({
      nodes: 40,
      elements: 12,
      dofs: null,
      solver: null,
      analysis: null,
    });
    expect((await modelSize(env.DB, mesh, { status: "cancelled" })).nodes).toBeNull();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM jobs"),
      env.DB.prepare("DELETE FROM meshes WHERE id = 'm-stats'"),
      env.DB.prepare("DELETE FROM geometries WHERE id = 'g-stats'"),
      env.DB.prepare("DELETE FROM projects WHERE id = 'p-stats'"),
    ]);
  });
});

describe("the solver host's load (M12.3)", () => {
  const load = {
    cpu: 0.75,
    steal: 0.02,
    load1: 6.1,
    load5: 5.2,
    load15: 4.0,
    memoryTotalBytes: 24 * 2 ** 30,
    memoryAvailableBytes: 6 * 2 ** 30,
    diskTotalBytes: 150 * 10 ** 9,
    diskFreeBytes: 90 * 10 ** 9,
    containers: 2,
  };

  it("is kept from each check-in that carries it, for 14 days", async () => {
    expect((await worker("/hosts/check-in", { host: "vps-1" })).status).toBe(200);
    expect((await worker("/hosts/check-in", { host: "vps-1", load })).status).toBe(200);
    const { cpu, steal, ...first } = load;
    expect((await worker("/hosts/check-in", { host: "vps-1", load: first })).status).toBe(200);
    expect((await worker("/hosts/check-in", { host: "vps-1", load: { ...load, cpu: 2 } })).status).toBe(400);

    const response = await call("GET", "/api/admin/stats/host", { cookie: alice });
    const answer = validateHostLoadResponse(await response.json());
    if (!answer.ok) throw new Error(answer.errors.join("; "));
    const samples = answer.value.samples;
    expect(samples.length).toBeGreaterThanOrEqual(1);
    expect(samples[0]).toMatchObject({ host: "vps-1", load1: 6.1, containers: 2 });

    await env.DB.prepare("UPDATE host_stats SET at = strftime('%Y-%m-%dT%H:%M:%fZ', at, '-15 days')").run();
    expect((await call("GET", "/api/admin/stats/host", { cookie: alice }).then((r) => r.json())) as unknown).toEqual({
      samples: [],
    });
    expect(await purgeHostLoad(env.DB)).toBeGreaterThanOrEqual(1);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM host_stats").first<{ n: number }>())?.n).toBe(0);
  });
});

describe("the admin's statistics routes (M12.3)", () => {
  it("answer the admin only, and check their queries", async () => {
    const bob = await call("POST", "/api/session", { json: { login: "bob", password: "bob-local" } });
    const bobCookie = (bob.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
    expect((await call("GET", "/api/admin/stats/jobs", { cookie: bobCookie })).status).toBe(404);
    expect((await call("GET", "/api/admin/stats/host", { cookie: bobCookie })).status).toBe(404);
    expect((await call("GET", "/api/admin/stats/jobs?limit=0", { cookie: alice })).status).toBe(400);
    expect((await call("GET", "/api/admin/stats/jobs?before=yesterday", { cookie: alice })).status).toBe(400);
    expect((await call("GET", "/api/admin/stats/host?since=soon", { cookie: alice })).status).toBe(400);
  });

  it("list tries newest first, by run and page by page", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const created = await createJob(env.DB, BOB, "noop", `target-${i}`);
      ids.push(created.id);
      await claim(`w${i}`);
      // One job of a user runs at a time in a lane, so each ends before the next is claimed.
      await worker(`/jobs/${created.id}/complete`, { workerId: `w${i}`, status: "succeeded", metering: { billableMs: 1 }, result: {} });
      await env.DB.prepare("UPDATE job_stats SET claimed_at = ? WHERE job_id = ?")
        .bind(`2026-10-22T10:00:0${i}.000Z`, created.id)
        .run();
    }
    expect((await tries()).map((t) => t.jobId)).toEqual([...ids].reverse());
    expect((await tries("?target=target-1")).map((t) => t.jobId)).toEqual([ids[1]]);
    expect((await tries("?limit=1&before=2026-10-22T10:00:02Z")).map((t) => t.jobId)).toEqual([ids[1]]);
  });
});
