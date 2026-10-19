// SPDX-License-Identifier: AGPL-3.0-or-later
// The launcher (M10.7, ADR-100): AWS signing, the plan, and starts against a stand-in for AWS.
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createJob, getJob } from "../src/db/jobs";
import type { WorkerStart } from "../src/db/workerStarts";
import type { Env } from "../src/env";
import {
  ensureMachines,
  type MachineState,
  machineHours,
  machineRefusal,
  planMachines,
  solverMachines,
} from "../src/launcher";
import { LAUNCH_PARAMETER } from "../src/launcher/aws";
import { signRequest } from "../src/launcher/sigv4";

describe("signRequest", () => {
  it("matches AWS's get-vanilla example", async () => {
    const headers = await signRequest({
      method: "GET",
      url: "https://example.amazonaws.com/",
      headers: {},
      body: "",
      region: "us-east-1",
      service: "service",
      credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" },
      now: new Date("2015-08-30T12:36:00Z"),
    });
    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, " +
        "SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
  });

  it("matches botocore's signature of an ECS RunTask request", async () => {
    // botocore SigV4Auth, service ecs, region ap-south-1.
    const headers = await signRequest({
      method: "POST",
      url: "https://ecs.ap-south-1.amazonaws.com/",
      headers: {
        "content-type": "application/x-amz-json-1.1",
        "x-amz-target": "AmazonEC2ContainerServiceV20141113.RunTask",
      },
      body: '{"cluster":"clearfea","count":1}',
      region: "ap-south-1",
      service: "ecs",
      credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" },
      now: new Date("2026-10-19T08:02:12Z"),
    });
    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261019/ap-south-1/ecs/aws4_request, " +
        "SignedHeaders=content-type;host;x-amz-date;x-amz-target, " +
        "Signature=6f2c6ccd6492dd91c7738ffe6edc8751307bef24c98a9bbe0bd9d80e15a6ad1f",
    );
  });
});

const NOW = Date.parse("2026-10-19T12:00:00.000Z");
const at = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();

function start(fields: Partial<WorkerStart> & { requestedAt: string }): WorkerStart {
  return {
    id: crypto.randomUUID(),
    machineSize: "medium",
    taskArn: null,
    problem: null,
    firstSeenAt: null,
    lastSeenAt: null,
    ...fields,
  };
}

function state(fields: Partial<MachineState> = {}): MachineState {
  return {
    sizes: [
      { name: "medium", enabled: true },
      { name: "large", enabled: false },
    ],
    queued: [],
    starts: [],
    settings: { hoursCap: 60, startWaitSeconds: 420, maxRunning: 3 },
    now: NOW,
    launcherProblem: null,
    ...fields,
  };
}

const job = (secondsAgo: number, machineSize = "medium", id = `j${secondsAgo}`) => ({
  id,
  machineSize,
  createdAt: at(secondsAgo),
});

describe("planMachines", () => {
  it("starts a machine for queued work when none of its size is alive or starting", () => {
    expect(planMachines(state({ queued: [job(1)] }))).toEqual({ start: ["medium"], fail: [] });
    expect(planMachines(state())).toEqual({ start: [], fail: [] });
  });

  it("waits for a pending start, and for a machine alive and idle", () => {
    const pending = start({ requestedAt: at(100) });
    expect(planMachines(state({ queued: [job(1)], starts: [pending] })).start).toEqual([]);
    const alive = start({ requestedAt: at(900), firstSeenAt: at(800), lastSeenAt: at(10) });
    expect(planMachines(state({ queued: [job(30)], starts: [alive] })).start).toEqual([]);
  });

  it("starts another machine when a job has waited three minutes behind busy ones, up to the limit", () => {
    const busy = start({ requestedAt: at(3000), firstSeenAt: at(2900), lastSeenAt: at(5) });
    expect(planMachines(state({ queued: [job(181)], starts: [busy] })).start).toEqual(["medium"]);
    const full = state({ queued: [job(181)], starts: [busy, busy, busy], settings: { ...state().settings, maxRunning: 3 } });
    expect(planMachines(full).start).toEqual([]);
  });

  it("counts a start whose worker has not come within the wait as failed, and starts again", () => {
    const late = start({ requestedAt: at(421) });
    expect(planMachines(state({ queued: [job(500)], starts: [late] })).start).toEqual(["medium"]);
  });

  it("waits a minute after AWS refused a start before trying again", () => {
    const refused = start({ requestedAt: at(30), problem: "AWS refused RunTask" });
    expect(planMachines(state({ queued: [job(40)], starts: [refused] })).start).toEqual([]);
    const older = start({ requestedAt: at(61), problem: "AWS refused RunTask" });
    expect(planMachines(state({ queued: [job(70)], starts: [older] })).start).toEqual(["medium"]);
  });

  it("fails a job after three starts in a row without a worker, and only the jobs queued before them", () => {
    const refused = [100, 200, 300].map((s) => start({ requestedAt: at(s), problem: "AWS refused RunTask" }));
    const plan = planMachines(state({ queued: [job(400, "medium", "old"), job(150, "medium", "new")], starts: refused }));
    expect(plan.fail.map((f) => [f.jobId, f.cause])).toEqual([["old", "no_machine"]]);
    expect(plan.fail[0]?.message).toContain("3 solver machines were started for it and none came up");
    // The newer job is still waiting; the last refusal was more than a minute ago, so it gets a start.
    expect(plan.start).toEqual(["medium"]);
    // A start that came up among them means the machines work: nothing fails.
    const cameUp = start({ requestedAt: at(250), firstSeenAt: at(200), lastSeenAt: at(190) });
    expect(planMachines(state({ queued: [job(400)], starts: [...refused, cameUp] })).fail).toEqual([]);
  });

  it("fails every queued job when the site cannot start machines at all", () => {
    const plan = planMachines(state({ queued: [job(5)], launcherProblem: "AWS_REGION not set" }));
    expect(plan.start).toEqual([]);
    expect(plan.fail).toEqual([
      { jobId: "j5", cause: "no_machine", message: "the solver machines of this site are not set up yet" },
    ]);
  });

  it("fails a job for a size switched off, unless a machine of it is still alive", () => {
    expect(planMachines(state({ queued: [job(5, "large")] })).fail[0]?.message).toContain("large machine size has been switched off");
    const alive = start({ machineSize: "large", requestedAt: at(900), firstSeenAt: at(800), lastSeenAt: at(10) });
    expect(planMachines(state({ queued: [job(5, "large")], starts: [alive] }))).toEqual({ start: [], fail: [] });
  });

  it("starts nothing once the month's machine hours reach the cap, and fails what no machine is left for", () => {
    const capped = state({ queued: [job(5)], settings: { ...state().settings, hoursCap: 0 } });
    expect(planMachines(capped)).toEqual({
      start: [],
      fail: [
        {
          jobId: "j5",
          cause: "machine_hours_cap",
          message: "this site has used its 0 machine hours for this month, so no machine was started",
        },
      ],
    });
    const alive = start({ requestedAt: at(900), firstSeenAt: at(800), lastSeenAt: at(10) });
    expect(planMachines({ ...capped, starts: [alive] })).toEqual({ start: [], fail: [] });
  });

  it("counts machine hours from each start to its worker's last contact, within this month", () => {
    const settings = state().settings;
    const hour = 3600;
    const starts = [
      start({ requestedAt: at(2 * hour), firstSeenAt: at(2 * hour - 120), lastSeenAt: at(hour) }), // 1 h
      start({ requestedAt: at(100), problem: "refused" }), // 0
      start({ requestedAt: at(60) }), // pending: 60 s so far
      start({ requestedAt: at(3 * hour) }), // never came: the 420 s wait
    ];
    expect(machineHours(starts, settings, NOW)).toBeCloseTo(1 + 60 / hour + 420 / hour, 6);
    // A machine that ran across midnight on the 1st counts only from the 1st.
    const firstOfMonth = Date.parse("2026-10-01T01:00:00.000Z");
    const across = start({ requestedAt: "2026-09-30T23:00:00.000Z", firstSeenAt: "2026-09-30T23:02:00.000Z", lastSeenAt: "2026-10-01T00:30:00.000Z" });
    expect(machineHours([across], settings, firstOfMonth)).toBeCloseTo(0.5, 6);
  });
});

/** A stand-in for AWS: answers GetParameter and RunTask, and keeps every request it was sent. */
function fakeAws(runTask: (body: Record<string, unknown>) => Response = () =>
  Response.json({ tasks: [{ taskArn: "arn:aws:ecs:ap-south-1:123456789012:task/clearfea/abc" }], failures: [] }),
) {
  const requests: { url: string; target: string; authorization: string; body: Record<string, unknown> }[] = [];
  const fetcher = async (request: Request) => {
    const body = JSON.parse(new TextDecoder().decode(await request.arrayBuffer())) as Record<string, unknown>;
    const target = request.headers.get("x-amz-target") ?? "";
    requests.push({ url: request.url, target, authorization: request.headers.get("authorization") ?? "", body });
    if (target === "AmazonSSM.GetParameter") {
      return Response.json({
        Parameter: {
          Name: LAUNCH_PARAMETER,
          Value: JSON.stringify({
            cluster: "clearfea",
            subnets: ["subnet-a", "subnet-b"],
            securityGroup: "sg-1",
            taskDefinitions: { medium: "clearfea-standard" },
          }),
        },
      });
    }
    if (target === "AmazonEC2ContainerServiceV20141113.RunTask") return runTask(body);
    return Response.json({ __type: "UnknownOperationException" }, { status: 400 });
  };
  return { requests, fetcher };
}

const cloud = (): Env => ({
  ...env,
  MACHINES: "cloud",
  AWS_REGION: "ap-south-1",
  AWS_LAUNCHER_ACCESS_KEY_ID: "AKIDEXAMPLE",
  AWS_LAUNCHER_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
});

function claim(workerId: string, machineSize = "medium"): Promise<Response> {
  return exports.default.fetch("http://localhost/internal/jobs/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-worker-token" },
    body: JSON.stringify({ workerId, jobTypes: ["noop"], machineSize }),
  });
}

describe("ensureMachines", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM jobs"),
      env.DB.prepare("DELETE FROM worker_starts"),
      env.DB.prepare("UPDATE settings SET value = 60 WHERE name = 'machine_hours_cap'"),
      env.DB.prepare("INSERT OR IGNORE INTO users (id, login, name) VALUES ('alice', 'alice', 'Alice')"),
    ]);
  });

  it("does nothing on the local worker, and asks AWS nothing", async () => {
    await createJob(env.DB, "alice", "noop");
    const aws = fakeAws();
    expect(await ensureMachines(env, aws.fetcher)).toEqual({ start: [], fail: [] });
    expect(aws.requests).toEqual([]);
    expect(await machineRefusal(env)).toBeNull();
  });

  it("starts one standard machine for queued work, signed, in the stack's subnets, and its worker takes the job", async () => {
    const queued = await createJob(env.DB, "alice", "noop");
    const aws = fakeAws();
    await ensureMachines(cloud(), aws.fetcher);
    expect(aws.requests.map((r) => [r.url, r.target])).toEqual([
      ["https://ssm.ap-south-1.amazonaws.com/", "AmazonSSM.GetParameter"],
      ["https://ecs.ap-south-1.amazonaws.com/", "AmazonEC2ContainerServiceV20141113.RunTask"],
    ]);
    for (const r of aws.requests) expect(r.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/ap-south-1\/(ssm|ecs)\/aws4_request, /);
    const row = await env.DB.prepare("SELECT * FROM worker_starts").first<{ id: string; machine_size: string; task_arn: string }>();
    expect(row?.machine_size).toBe("medium");
    expect(row?.task_arn).toBe("arn:aws:ecs:ap-south-1:123456789012:task/clearfea/abc");
    expect(aws.requests[1]?.body).toEqual({
      cluster: "clearfea",
      taskDefinition: "clearfea-standard",
      launchType: "FARGATE",
      count: 1,
      startedBy: "clearfea-api",
      networkConfiguration: {
        awsvpcConfiguration: { subnets: ["subnet-a", "subnet-b"], securityGroups: ["sg-1"], assignPublicIp: "ENABLED" },
      },
      overrides: {
        containerOverrides: [
          {
            name: "worker",
            environment: [
              { name: "CLEARFEA_WORKER_ID", value: `aws-${row?.id}` },
              { name: "CLEARFEA_WORKER_TOKEN", value: "test-worker-token" },
            ],
          },
        ],
      },
    });

    // A second call while the machine is starting starts nothing more.
    await ensureMachines(cloud(), aws.fetcher);
    expect(aws.requests).toHaveLength(2);

    // The machine's worker makes contact with its claim and gets the job.
    const claimed = await claim(`aws-${row?.id}`);
    expect(claimed.status).toBe(200);
    expect((await getJob(env.DB, "alice", queued.id))?.status).toBe("claimed");
    const seen = await env.DB.prepare("SELECT first_seen_at, last_seen_at FROM worker_starts").first<{ first_seen_at: string | null; last_seen_at: string | null }>();
    expect(seen?.first_seen_at).not.toBeNull();
    expect(seen?.last_seen_at).toBe(seen?.first_seen_at);
    const view = await solverMachines(cloud());
    expect(view.launcher).toBe("ready");
    expect(view.starts.map((s) => [s.size, s.state])).toEqual([["medium", "running"]]);
  });

  it("records AWS's refusal, tries again a minute later, and fails the job after three starts that never came up", async () => {
    const queued = await createJob(env.DB, "alice", "noop");
    await env.DB.prepare("UPDATE jobs SET created_at = ? WHERE id = ?").bind(new Date(Date.now() - 600_000).toISOString(), queued.id).run();
    const aws = fakeAws(() => Response.json({ __type: "com.amazon#AccessDeniedException", message: "not authorized to perform ecs:RunTask" }, { status: 400 }));
    await ensureMachines(cloud(), aws.fetcher);
    const refused = await env.DB.prepare("SELECT problem FROM worker_starts").all<{ problem: string }>();
    expect(refused.results.map((r) => r.problem)).toEqual(["AWS refused RunTask: AccessDeniedException: not authorized to perform ecs:RunTask"]);
    expect((await solverMachines(cloud())).starts[0]?.state).toBe("failed");

    // Within the minute nothing is tried; once the earlier refusals are older, it tries again.
    await ensureMachines(cloud(), aws.fetcher);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM worker_starts").first("n")).toBe(1);
    for (const n of [2, 3]) {
      await env.DB.prepare("UPDATE worker_starts SET requested_at = ?").bind(new Date(Date.now() - 90_000 * n).toISOString()).run();
      await ensureMachines(cloud(), aws.fetcher);
      expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM worker_starts").first("n")).toBe(n);
    }
    await env.DB.prepare("UPDATE worker_starts SET requested_at = ?").bind(new Date(Date.now() - 90_000).toISOString()).run();
    await ensureMachines(cloud(), aws.fetcher);
    const failed = await getJob(env.DB, "alice", queued.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.failureCategory).toBe("platform_fault");
    expect(failed?.failureCause).toBe("no_machine");
    expect(failed?.billableMs).toBe(0);
    expect(failed?.failureMessage).toContain("nothing is charged");
  });

  it("fails queued work and refuses new runs when the site has no AWS key, or the month's hours are used", async () => {
    const queued = await createJob(env.DB, "alice", "noop");
    const aws = fakeAws();
    const unset: Env = { ...cloud(), AWS_LAUNCHER_SECRET_ACCESS_KEY: undefined };
    expect(await machineRefusal(unset)).toContain("cannot start solver machines yet");
    const view = await solverMachines(unset);
    expect(view.launcher).toBe("not_set_up");
    expect(view.problem).toContain("AWS_LAUNCHER_SECRET_ACCESS_KEY");
    await ensureMachines(unset, aws.fetcher);
    expect(aws.requests).toEqual([]);
    expect((await getJob(env.DB, "alice", queued.id))?.failureMessage).toContain("not set up yet");

    await env.DB.prepare("UPDATE settings SET value = 0 WHERE name = 'machine_hours_cap'").run();
    expect(await machineRefusal(cloud())).toContain("used its 0 machine hours for this month");
    const capped = await createJob(env.DB, "alice", "noop");
    await ensureMachines(cloud(), aws.fetcher);
    expect(aws.requests).toEqual([]);
    expect((await getJob(env.DB, "alice", capped.id))?.failureCause).toBe("machine_hours_cap");
  });

  it("runs from the scheduled handler each minute", async () => {
    const { createScheduledController } = await import("cloudflare:test");
    const handler = (await import("../src/index")).default;
    await createJob(env.DB, "alice", "noop");
    // The test environment has no AWS key, so on cloud machines the queued job fails at once.
    await handler.scheduled(createScheduledController({ scheduledTime: Date.now(), cron: "* * * * *" }), { ...env, MACHINES: "cloud" }, {} as ExecutionContext);
    const { results } = await env.DB.prepare("SELECT failure_cause FROM jobs").all<{ failure_cause: string }>();
    expect(results).toEqual([{ failure_cause: "no_machine" }]);
  });
});
