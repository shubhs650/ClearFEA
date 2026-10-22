// SPDX-License-Identifier: AGPL-3.0-or-later
import { JobTypeValues } from "@clearfea/spec";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createJob, getJob } from "../src/db/jobs";
import { jobWait, retryAfter } from "../src/jobs/wait";

const TOKEN = "test-worker-token";

function post(path: string, body: unknown, token: string | null = TOKEN): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return exports.default.fetch(`http://localhost/internal${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function claim(workerId = "w1", jobTypes = ["noop"]) {
  return post("/jobs/claim", { workerId, jobTypes });
}

beforeEach(async () => {
  // Storage persists across tests within a file, so start each test from a known state.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM ledger_entries"),
    env.DB.prepare("DELETE FROM jobs"),
    env.DB.prepare(
      "INSERT OR IGNORE INTO users (id, login, name) VALUES ('alice', 'alice', 'Alice'), ('bob', 'bob', 'Bob')",
    ),
  ]);
});

describe("internal job routes", () => {
  it("refuses requests without the worker token", async () => {
    expect((await post("/jobs/claim", { workerId: "w1", jobTypes: ["noop"] }, null)).status).toBe(
      401,
    );
    expect((await post("/jobs/claim", { workerId: "w1", jobTypes: ["noop"] }, "wrong")).status).toBe(
      401,
    );
  });

  it("returns 204 when nothing is queued", async () => {
    expect((await claim()).status).toBe(204);
  });

  it("takes a noop job from queued to succeeded", async () => {
    const created = await createJob(env.DB, "alice", "noop");
    expect(created.status).toBe("queued");

    const claimed = await claim();
    expect(claimed.status).toBe(200);
    expect(await claimed.json()).toEqual({
      job: { id: created.id, type: "noop", targetId: null, params: null, transfers: [] },
    });
    expect((await getJob(env.DB, "alice", created.id))?.status).toBe("claimed");

    const beat = await post(`/jobs/${created.id}/heartbeat`, { workerId: "w1", stage: "noop" });
    expect(await beat.json()).toEqual({ action: "continue" });
    expect((await getJob(env.DB, "alice", created.id))?.status).toBe("running");

    const done = await post(`/jobs/${created.id}/complete`, {
      workerId: "w1",
      metering: { billableMs: 2500 },
      status: "succeeded",
      result: { message: "nothing to do" },
    });
    expect(done.status).toBe(200);
    const job = await getJob(env.DB, "alice", created.id);
    expect(job?.status).toBe("succeeded");
    expect(job?.result).toEqual({ message: "nothing to do" });
    expect(job?.finishedAt).not.toBeNull();
  });

  it("gives a worker that names its machine size only that size's jobs, and the default size the unsized ones (M10.6)", async () => {
    const claimOn = (machineSize: string) => post("/jobs/claim", { workerId: "w1", jobTypes: ["noop"], machineSize });
    const unsized = await createJob(env.DB, "alice", "noop");
    const forLarge = await createJob(env.DB, "bob", "noop");
    await env.DB.prepare("UPDATE jobs SET machine_size = 'large' WHERE id = ?").bind(forLarge.id).run();

    expect((await claimOn("small")).status).toBe(204);
    const medium = await claimOn("medium");
    expect(((await medium.json()) as { job: { id: string } }).job.id).toBe(unsized.id);
    expect((await claimOn("medium")).status).toBe(204);
    const large = await claimOn("large");
    expect(((await large.json()) as { job: { id: string } }).job.id).toBe(forLarge.id);

    const unknown = await claimOn("huge");
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({
      error: "There is no machine size called huge. Set CLEARFEA_MACHINE_SIZE to one in machine_sizes.",
    });
  });

  it("gives a worker that names no size every size's jobs, as before", async () => {
    const forLarge = await createJob(env.DB, "bob", "noop");
    await env.DB.prepare("UPDATE jobs SET machine_size = 'large' WHERE id = ?").bind(forLarge.id).run();
    expect((await claim()).status).toBe(200);
  });

  it("hands each job to one worker only, oldest first", async () => {
    const first = await createJob(env.DB, "alice", "noop");
    const second = await createJob(env.DB, "bob", "noop");
    // Both may share a millisecond timestamp; make the order explicit.
    await env.DB.prepare("UPDATE jobs SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?")
      .bind(first.id)
      .run();
    const a = await (await claim("w1")).json<{ job: { id: string } }>();
    const b = await (await claim("w2")).json<{ job: { id: string } }>();
    expect([a.job.id, b.job.id]).toEqual([first.id, second.id]);
    expect((await claim("w3")).status).toBe(204);
  });

  /** Jobs created in this order, a second apart, so their queue order is explicit. */
  async function queued(...owners: string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const [i, owner] of owners.entries()) {
      const job = await createJob(env.DB, owner, "noop");
      await env.DB.prepare("UPDATE jobs SET created_at = ? WHERE id = ?")
        .bind(`2026-01-01T00:00:0${i}.000Z`, job.id)
        .run();
      ids.push(job.id);
    }
    return ids;
  }

  async function claimedId(workerId: string): Promise<string> {
    return (await (await claim(workerId)).json<{ job: { id: string } }>()).job.id;
  }

  async function finish(workerId: string, jobId: string) {
    const done = await post(`/jobs/${jobId}/complete`, { workerId, metering: { billableMs: 1 }, status: "succeeded" });
    expect(done.status).toBe(200);
  }

  it("lets users take turns in a lane rather than serving one user's queue first (M12.1)", async () => {
    const [a1, a2, b1] = await queued("alice", "alice", "bob");
    expect(await claimedId("lane")).toBe(a1);
    await finish("lane", a1);
    // alice was served last, so bob's job, queued after her second, goes first.
    expect(await claimedId("lane")).toBe(b1);
    await finish("lane", b1);
    expect(await claimedId("lane")).toBe(a2);
  });

  it("puts a user with a job running in the other lane behind other users (ADR-107 item 4)", async () => {
    await createJob(env.DB, "alice", "solve");
    expect((await claim("solve-lane", ["solve"])).status).toBe(200);
    const [a1, b1] = await queued("alice", "bob");
    expect(await claimedId("light-lane")).toBe(b1);
    await finish("light-lane", b1);
    expect(await claimedId("light-lane")).toBe(a1);
  });

  it("only claims job types the worker offers", async () => {
    await createJob(env.DB, "alice", "solve");
    expect((await claim("w1", ["noop"])).status).toBe(204);
    expect((await claim("w1", ["noop", "solve"])).status).toBe(200);
  });

  it("does not let another worker report on a claimed job", async () => {
    const job = await createJob(env.DB, "alice", "noop");
    await claim("w1");
    expect((await post(`/jobs/${job.id}/heartbeat`, { workerId: "w2" })).status).toBe(404);
    const done = await post(`/jobs/${job.id}/complete`, { workerId: "w2", metering: { billableMs: 2500 }, status: "succeeded" });
    expect(done.status).toBe(409);
    expect((await getJob(env.DB, "alice", job.id))?.status).toBe("claimed");
  });

  it("records a failure with its category and cause", async () => {
    const job = await createJob(env.DB, "alice", "noop");
    await claim("w1");
    const done = await post(`/jobs/${job.id}/complete`, {
      workerId: "w1",
      metering: { billableMs: 2500 },
      status: "failed",
      failureCategory: "platform_fault",
      failureCause: "internal_error",
    });
    expect(done.status).toBe(200);
    const stored = await getJob(env.DB, "alice", job.id);
    expect(stored?.status).toBe("failed");
    expect(stored?.failureCategory).toBe("platform_fault");
    expect(stored?.failureCause).toBe("internal_error");
  });

  it("records the measured time of every job but charges only metered ones", async () => {
    const job = await createJob(env.DB, "alice", "noop");
    expect(job).toMatchObject({ machineSize: null, ratePerHour: null });
    await claim("w1");
    await post(`/jobs/${job.id}/complete`, { workerId: "w1", status: "succeeded", metering: { billableMs: 1234 } });
    expect(await getJob(env.DB, "alice", job.id)).toMatchObject({ billableMs: 1234, billedSeconds: null, cost: null });
    const solve = await createJob(env.DB, "alice", "solve");
    expect(solve).toMatchObject({ machineSize: "medium", ratePerHour: 1_000_000 });
    const entries = await env.DB.prepare("SELECT COUNT(*) AS n FROM ledger_entries").first<{ n: number }>();
    expect(entries?.n).toBe(0);
  });

  it("tells the worker to give up on a cancelled job", async () => {
    const job = await createJob(env.DB, "alice", "noop");
    await claim("w1");
    await env.DB.prepare("UPDATE jobs SET status = 'cancelled' WHERE id = ?").bind(job.id).run();
    const beat = await post(`/jobs/${job.id}/heartbeat`, { workerId: "w1" });
    expect(await beat.json()).toEqual({ action: "cancel" });
  });

  it("rejects malformed bodies with a plain message", async () => {
    const response = await post("/jobs/claim", { workerId: "w1", jobTypes: ["bake"] });
    expect(response.status).toBe(400);
    expect((await response.json<{ error: string }>()).error).toContain("jobTypes");
  });
});

describe("job data access", () => {
  it("stores every job type the shared schema defines", async () => {
    for (const type of JobTypeValues) {
      expect((await createJob(env.DB, "alice", type)).type).toBe(type);
    }
  });

  it("does not show one user's job to another", async () => {
    const job = await createJob(env.DB, "alice", "noop");
    expect(await getJob(env.DB, "bob", job.id)).toBeNull();
    expect((await getJob(env.DB, "alice", job.id))?.id).toBe(job.id);
  });
});

describe("job wait (M11.2)", () => {
  it("gives a queued job its place among every user's queued jobs, and nothing once it has finished", async () => {
    const first = await createJob(env.DB, "bob", "noop");
    const second = await createJob(env.DB, "alice", "noop");
    expect(await jobWait(env, "alice", second.id)).toEqual({
      status: "queued",
      queuePosition: 2,
      machineStarting: false,
      retryAfter: 10,
    });
    expect(await jobWait(env, "bob", second.id)).toBeUndefined();

    expect((await claim()).status).toBe(200);
    expect((await jobWait(env, "bob", first.id))?.queuePosition).toBeNull();
    expect((await jobWait(env, "alice", second.id))?.queuePosition).toBe(1);
    expect((await post(`/jobs/${first.id}/complete`, { workerId: "w1", status: "succeeded", metering: { billableMs: 1 } })).status).toBe(200);
    expect(await jobWait(env, "bob", first.id)).toBeUndefined();
  });

  it("hints sooner for a job a worker is on than for one far back in the queue or waiting for a machine", () => {
    expect(retryAfter("running", null, false)).toBe(2);
    expect(retryAfter("claimed", null, false)).toBe(2);
    expect(retryAfter("queued", 1, false)).toBe(5);
    expect(retryAfter("queued", 1, true)).toBe(15);
    expect(retryAfter("queued", 4, true)).toBe(20);
    expect(retryAfter("queued", 40, false)).toBe(30);
  });

});
