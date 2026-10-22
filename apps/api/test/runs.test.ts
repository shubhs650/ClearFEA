// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  type ClaimResponse,
  type MeshResult,
  type RunView,
  type SimulationSpec,
  type SolveResult,
  type Topology,
  type WorkerSoftware,
  elementLimitProblem,
  estimateMesh,
  estimatorTable,
  maxElements,
  validateClaimResponse,
  validateEstimateResponse,
  validateRunListResponse,
  validateRunLogResponse,
  validateRunResponse,
  validateSimulationResponse,
  validateWalletResponse,
} from "@clearfea/spec";
import fixture from "@clearfea/spec/fixtures/simulation-v1.json";
import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listLedger } from "../src/billing/ledger";
import { app } from "../src/index";
import { getJob, LOG_CHUNKS_PER_READ } from "../src/db/jobs";
import { MAX_ATTEMPTS, sweepLostJobs } from "../src/jobs/outcome";
import { userProject } from "../src/db/projects";

const TOKEN = "test-worker-token";

function call(
  method: string,
  path: string,
  options: { json?: unknown; raw?: BodyInit; cookie?: string; token?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.json !== undefined) headers["Content-Type"] = "application/json";
  if (options.raw !== undefined) headers["Content-Type"] = "application/octet-stream";
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  return exports.default.fetch(`http://localhost${path}`, {
    method,
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : options.raw,
  });
}

async function signIn(login: string, password: string): Promise<string> {
  const response = await call("POST", "/api/session", { json: { login, password } });
  expect(response.status).toBe(200);
  return (response.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
}

const TOPOLOGY: Topology = {
  version: 1,
  size: 0.113,
  bbox: [0, 0, 0, 0.1, 0.05, 0.02],
  unit: { declared: "SI_UNIT(.MILLI.,.METRE.)", detectedUnit: "mm", problem: null, readingFactor: 0.001 },
  scaling: 0.5,
  software: { gmsh: "4.15.2", occt: "7.8.1" },
  bodies: [{ tag: 1, volume: 1e-4, faces: [1, 2, 3] }],
  faces: [1, 2, 3].map((tag) => ({
    tag,
    type: "plane" as const,
    gmshType: "Plane",
    area: 0.001,
    centroid: [0, 0, 0],
    bbox: [0, 0, 0, 0.1, 0.05, 0.02],
    bodies: [1],
  })),
};

const RESULT: MeshResult = {
  order: 2,
  nodes: 7108,
  elements: 4000,
  surfaceTriangles: 1720,
  quality: { shapeMin: 0.2, shapeMean: 0.7, shapeHistogram: [0, 0, 10, 90, 300, 600, 1000, 1200, 700, 100], jacobianMin: 0.9 },
  software: { gmsh: "4.15.2", occt: "7.8.1" },
};

let alice = "";
let bob = "";
let aliceId = "";

beforeAll(async () => {
  const statements = env.TEST_SEED.flatMap((file) => file.queries);
  await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
  alice = await signIn("alice", "alice-local");
  bob = await signIn("bob", "bob-local");
  const row = await env.DB.prepare("SELECT id FROM users WHERE login = 'alice'").first<{ id: string }>();
  aliceId = row?.id ?? "";
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM job_logs"),
    env.DB.prepare("DELETE FROM runs"),
    env.DB.prepare("DELETE FROM simulations"),
    env.DB.prepare("DELETE FROM meshes"),
    env.DB.prepare("DELETE FROM geometries"),
    env.DB.prepare("DELETE FROM ledger_entries"),
    env.DB.prepare("DELETE FROM jobs"),
  ]);
  // The seed's play-money grants (ADR-080), so runs are not refused for want of funds.
  await env.DB.batch(env.TEST_SEED.flatMap((file) => file.queries).map((sql) => env.DB.prepare(sql)));
});

/** The seed's grant to each test user, in micro-credits. */
const GRANT = 100_000_000;

/** The user's charges, oldest first: the ledger without the seed's grant. */
async function charges(userId: string) {
  return (await listLedger(env.DB, userId)).filter((e) => e.reason !== "grant");
}

/** A ready geometry of alice's, imported at scaling 0.5, with its topology.json stored. */
async function geometryRow(topology: Topology = TOPOLOGY): Promise<string> {
  const { id: projectId } = await userProject(env.DB, aliceId);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO geometries (id, owner_id, project_id, name, size_bytes, status, detected_unit, reading_factor,
       confirmed_unit, scaling, body_count, face_count)
     VALUES (?, ?, ?, 'bracket.step', 100, 'ready', 'mm', 0.001, 'mm', 0.5, 1, 3)`,
  )
    .bind(id, aliceId, projectId)
    .run();
  await env.FILES.put(`owners/${aliceId}/geometries/${id}/topology.json`, JSON.stringify(topology));
  await env.FILES.put(`owners/${aliceId}/geometries/${id}/model.step`, "ISO-10303-21;");
  return id;
}

/** Alice's simulation with the fixture's spec, or with a different mesh size or topology. */
async function simulation(
  size: SimulationSpec["mesh"]["size"] = fixture.mesh.size,
  topology: Topology = TOPOLOGY,
): Promise<string> {
  const geometryId = await geometryRow(topology);
  const spec = { ...(JSON.parse(JSON.stringify(fixture)) as SimulationSpec), geometryId, mesh: { size } };
  // A body of the topology that the fixture does not list gets the fixture's first material.
  for (const body of topology.bodies) {
    if (!spec.bodies.some((b) => b.tag === body.tag)) spec.bodies.push({ tag: body.tag, material: spec.materials[0]?.id ?? null });
  }
  const response = await call("POST", "/api/simulations", {
    json: { geometryId, name: "Static structural", spec },
    cookie: alice,
  });
  expect(response.status).toBe(201);
  const body = validateSimulationResponse(await response.json());
  if (!body.ok) throw new Error(body.errors.join(" "));
  return body.value.simulation.id;
}

async function requestMesh(simulationId: string): Promise<void> {
  const response = await call("POST", `/api/simulations/${simulationId}/mesh`, { cookie: alice });
  expect(response.status).toBe(201);
}

const WORKER: WorkerSoftware = { clearfea: "0.0.0+d9d394b", deckFormat: 1, calculix: "2.21", gmsh: "4.15.2" };

async function claim(type: "mesh" | "solve", software: WorkerSoftware | null = WORKER): Promise<ClaimResponse["job"]> {
  const response = await call("POST", "/internal/jobs/claim", {
    json: { workerId: "w1", jobTypes: [type], ...(software === null ? {} : { software }) },
    token: TOKEN,
  });
  expect(response.status).toBe(200);
  const body = validateClaimResponse(await response.json());
  if (!body.ok) throw new Error(body.errors.join(" "));
  return body.value.job;
}

function transferPath(job: ClaimResponse["job"], name: string, direction: string): string {
  const url = job.transfers.find((t) => t.name === name && t.direction === direction)?.url;
  if (url === undefined) throw new Error(`no ${direction} for ${name}`);
  const parsed = new URL(url);
  return parsed.pathname + parsed.search;
}

async function complete(jobId: string, body: Record<string, unknown>): Promise<void> {
  const done = await call("POST", `/internal/jobs/${jobId}/complete`, {
    json: { workerId: "w1", metering: { billableMs: 2500 }, ...body },
    token: TOKEN,
  });
  expect(done.status).toBe(200);
}

/** Plays the worker: claims the mesh job, uploads both outputs, reports success. */
async function runMesh(result: MeshResult = RESULT): Promise<ClaimResponse["job"]> {
  const job = await claim("mesh");
  for (const name of ["mesh.bin", "display.bin"]) {
    const put = await call("PUT", transferPath(job, name, "upload"), { raw: `${name} content`, token: TOKEN });
    expect(put.status).toBe(200);
  }
  await complete(job.id, { status: "succeeded", result });
  return job;
}

const SOLVED: SolveResult = {
  nodes: 7108,
  displacement: { max: { value: 1.2e-4, node: 17, position: [0.1, 0.05, 0.02] } },
  vonMises: {
    min: { value: 1.5e3, node: 3, position: [0, 0.05, 0] },
    max: { value: 2.4e8, node: 40, position: [0, 0, 0] },
  },
  reactions: [{ supportId: "fixed-1", force: [0, 0, -400] }],
  software: { calculix: "2.21" },
};

const RUN_FILES = ["deck.inp", "solver.log", "results.frd", "results.dat", "surface.bin", "fields.bin", "nodes.bin"];

/** Alice's simulation with a ready mesh of its saved size. */
async function meshed(): Promise<string> {
  const id = await simulation();
  await requestMesh(id);
  await runMesh();
  return id;
}

async function startRun(simulationId: string, cookie = alice, json?: Record<string, unknown>): Promise<Response> {
  return call("POST", `/api/simulations/${simulationId}/runs`, json === undefined ? { cookie } : { cookie, json });
}

async function runOf(response: Response): Promise<RunView> {
  const body = validateRunResponse(await response.json());
  if (!body.ok) throw new Error(body.errors.join(" "));
  return body.value.run;
}

async function readRun(runId: string, cookie = alice): Promise<RunView> {
  const response = await call("GET", `/api/runs/${runId}`, { cookie });
  expect(response.status).toBe(200);
  return runOf(response);
}

async function heartbeat(jobId: string, log?: string): Promise<void> {
  const response = await call("POST", `/internal/jobs/${jobId}/heartbeat`, {
    json: { workerId: "w1", stage: "solving", ...(log === undefined ? {} : { log }) },
    token: TOKEN,
  });
  expect(response.status).toBe(200);
}

async function readLog(runId: string, after: number, cookie = alice): Promise<{ text: string; next: number; more: boolean }> {
  const response = await call("GET", `/api/runs/${runId}/log?after=${after}`, { cookie });
  expect(response.status).toBe(200);
  const body = validateRunLogResponse(await response.json());
  if (!body.ok) throw new Error(body.errors.join(" "));
  return body.value;
}

async function upload(job: ClaimResponse["job"], names: string[]): Promise<void> {
  for (const name of names) {
    const put = await call("PUT", transferPath(job, name, "upload"), { raw: `${name} content`, token: TOKEN });
    expect(put.status).toBe(200);
  }
}

describe("starting a run", () => {
  it("needs a ready mesh of the saved mesh size", async () => {
    const id = await simulation();
    const none = await startRun(id);
    expect(none.status).toBe(409);
    expect((await none.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining("Generate the mesh"),
    });
    await requestMesh(id);
    const meshing = await startRun(id);
    expect(meshing.status).toBe(409);
    expect((await meshing.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining("still being made"),
    });
    await runMesh();
    const simulationRow = await call("GET", `/api/simulations/${id}`, { cookie: alice });
    const view = validateSimulationResponse(await simulationRow.json());
    if (!view.ok) throw new Error(view.errors.join(" "));
    const spec = { ...view.value.simulation.spec, mesh: { size: { value: 3, unit: "mm" } } };
    expect((await call("PUT", `/api/simulations/${id}/spec`, { json: spec, cookie: alice })).status).toBe(200);
    const changed = await startRun(id);
    expect(changed.status).toBe(409);
    expect((await changed.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining("mesh settings changed"),
    });
    // Back to the size the mesh was made with, but first order: still another mesh (M2.8).
    const order = { ...view.value.simulation.spec, mesh: { ...view.value.simulation.spec.mesh, order: 1 } };
    expect((await call("PUT", `/api/simulations/${id}/spec`, { json: order, cookie: alice })).status).toBe(200);
    const reordered = await startRun(id);
    expect(reordered.status).toBe(409);
    expect((await reordered.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining("mesh settings changed"),
    });
  });

  it("refuses a setup the pre-run list finds incomplete, before any job is queued or charged", async () => {
    const id = await meshed();
    const simulationRow = await call("GET", `/api/simulations/${id}`, { cookie: alice });
    const view = validateSimulationResponse(await simulationRow.json());
    if (!view.ok) throw new Error(view.errors.join(" "));
    const saved = view.value.simulation.spec;
    const incomplete = { ...saved, loads: [], supports: saved.supports.map((s) => ({ ...s, faces: [] })) };
    expect((await call("PUT", `/api/simulations/${id}/spec`, { json: incomplete, cookie: alice })).status).toBe(200);
    const jobsBefore = await env.DB.prepare("SELECT COUNT(*) AS n FROM jobs").first<{ n: number }>();
    const refused = await startRun(id);
    expect(refused.status).toBe(409);
    const { error } = (await refused.json()) as { error: string };
    expect(error).toContain("The setup is not ready to run.");
    expect(error).toContain(`Support "Fixed support 1" has no faces or edges.`);
    expect(error).toContain("There is no load");
    const jobsAfter = await env.DB.prepare("SELECT COUNT(*) AS n FROM jobs").first<{ n: number }>();
    expect(jobsAfter?.n).toBe(jobsBefore?.n);
    const list = await call("GET", `/api/simulations/${id}/runs`, { cookie: alice });
    expect(((await list.json()) as { runs: unknown[] }).runs).toEqual([]);
  });

  it("asks for a new mesh when a support holds an edge and the mesh kept no edges (ADR-105)", async () => {
    const withEdges: Topology = {
      ...TOPOLOGY,
      edges: [{ tag: 4, length: 0.1, bbox: [0, 0, 0, 0.1, 0, 0], faces: [1, 2], points: [0, 0, 0, 0.1, 0, 0] }],
    };
    const id = await simulation(fixture.mesh.size, withEdges);
    const row = validateSimulationResponse(await (await call("GET", `/api/simulations/${id}`, { cookie: alice })).json());
    if (!row.ok) throw new Error(row.errors.join(" "));
    const spec = row.value.simulation.spec;
    const onEdge = { ...spec, supports: spec.supports.map((s) => ({ ...s, faces: [], edges: [4] })) };
    expect((await call("PUT", `/api/simulations/${id}/spec`, { json: onEdge, cookie: alice })).status).toBe(200);
    await requestMesh(id);
    await runMesh();
    const refused = await startRun(id);
    expect(refused.status).toBe(409);
    expect((await refused.json()) as { error: string }).toEqual({
      error: "A support holds an edge, and this mesh was made before ClearFEA kept edges. Generate the mesh again, then run.",
    });
    // The same settings make a new mesh now (the settings version changed), which keeps its edges.
    await env.DB.prepare("UPDATE meshes SET edge_count = 12").run();
    expect((await startRun(id)).status).toBe(201);
    const job = await claim("solve");
    expect(job.params).toMatchObject({ spec: { supports: [{ faces: [], edges: [4] }] } });
  });

  it("freezes every bond of the geometry into a run of a spec saved without its bond list (M4.3)", async () => {
    const bonded: Topology = {
      ...TOPOLOGY,
      bodies: [
        { tag: 1, volume: 5e-5, faces: [1, 2] },
        { tag: 2, volume: 5e-5, faces: [3] },
      ],
      faces: TOPOLOGY.faces.map((f) => ({ ...f, bodies: [f.tag === 3 ? 2 : 1] })),
      bondTolerance: 1e-5,
      bonds: [{ faces: [2, 3], bodies: [1, 2], area: 0.001, gap: 0 }],
    };
    const id = await simulation(fixture.mesh.size, bonded);
    await requestMesh(id);
    await runMesh();
    expect((await startRun(id)).status).toBe(201);
    const job = await claim("solve");
    expect(job.params).toMatchObject({ spec: { bonds: [{ faces: [2, 3], status: "detected" }] } });
  });

  it("freezes the saved spec and queues a solve job on the current mesh", async () => {
    const id = await meshed();
    const response = await startRun(id);
    expect(response.status).toBe(201);
    const run = await runOf(response);
    expect(run).toMatchObject({ simulationId: id, status: "solving", stage: "queued", problem: null, result: null });

    // Editing the simulation afterwards does not reach the run's job.
    const simulationRow = await call("GET", `/api/simulations/${id}`, { cookie: alice });
    const view = validateSimulationResponse(await simulationRow.json());
    if (!view.ok) throw new Error(view.errors.join(" "));
    const frozen = view.value.simulation.spec;
    const edited = { ...frozen, materials: frozen.materials.map((m) => ({ ...m, poissonsRatio: 0.1 })) };
    expect((await call("PUT", `/api/simulations/${id}/spec`, { json: edited, cookie: alice })).status).toBe(200);

    const job = await claim("solve");
    expect(job).toMatchObject({ type: "solve", targetId: run.id, params: { meshId: run.meshId, spec: frozen } });
    expect(job.transfers.map((t) => `${t.direction} ${t.name}`)).toEqual([
      "download mesh.bin",
      ...RUN_FILES.map((name) => `upload ${name}`),
    ]);
    const mesh = await call("GET", transferPath(job, "mesh.bin", "download"), { token: TOKEN });
    expect(new TextDecoder().decode(await mesh.arrayBuffer())).toBe("mesh.bin content");
  });

  it("refuses a second run while one is solving", async () => {
    const id = await meshed();
    expect((await startRun(id)).status).toBe(201);
    const again = await startRun(id);
    expect(again.status).toBe(409);
    expect((await again.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining("already being solved"),
    });
  });

  it("answers another user's simulation like a missing one", async () => {
    const id = await meshed();
    expect((await startRun(id, bob)).status).toBe(404);
    expect((await call("GET", `/api/simulations/${id}/runs`, { cookie: bob })).status).toBe(404);
    expect((await startRun(id, "")).status).toBe(401);
  });
});

describe("a solving run", () => {
  it("shows the worker's stage and streams the log it sends with heartbeats", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    await heartbeat(job.id, "CalculiX Version 2.21\n");
    expect(await readRun(run.id)).toMatchObject({ status: "solving", stage: "solving" });
    await heartbeat(job.id);
    await heartbeat(job.id, " STEP 1\n");
    const all = await readLog(run.id, 0);
    expect(all).toEqual({ text: "CalculiX Version 2.21\n STEP 1\n", next: 2, more: false });
    expect(await readLog(run.id, 1)).toEqual({ text: " STEP 1\n", next: 2, more: false });
    expect(await readLog(run.id, 2)).toEqual({ text: "", next: 2, more: false });
  });

  it("says when a log is longer than one read returns, so the browser reads on only then", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    for (let i = 1; i <= LOG_CHUNKS_PER_READ + 1; i++) await heartbeat(job.id, `line ${i}\n`);
    const first = await readLog(run.id, 0);
    expect(first).toMatchObject({ next: LOG_CHUNKS_PER_READ, more: true });
    expect(await readLog(run.id, first.next)).toEqual({
      text: `line ${LOG_CHUNKS_PER_READ + 1}\n`,
      next: LOG_CHUNKS_PER_READ + 1,
      more: false,
    });
  });

  it("keeps the log to its owner", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    await heartbeat(job.id, "secret\n");
    expect((await call("GET", `/api/runs/${run.id}`, { cookie: bob })).status).toBe(404);
    expect((await call("GET", `/api/runs/${run.id}/log?after=0`, { cookie: bob })).status).toBe(404);
    expect((await call("GET", `/api/runs/${run.id}/log?after=-1`, { cookie: alice })).status).toBe(400);
  });

  it("refuses a log chunk larger than the schema allows", async () => {
    const id = await meshed();
    await startRun(id);
    const job = await claim("solve");
    const response = await call("POST", `/internal/jobs/${job.id}/heartbeat`, {
      json: { workerId: "w1", log: "x".repeat(65537) },
      token: TOKEN,
    });
    expect(response.status).toBe(400);
  });
});

describe("a solving run's progress (M8.2)", () => {
  it("is waiting while queued, then counts time and cost from the worker's claim", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    expect(run.progress).toEqual({ startedAt: null, elapsedMs: null, costSoFar: null, cancelling: false });
    const job = await claim("solve");
    // As if the worker had taken it 2.5 s ago: 3 s on small, 0.5 credit an hour.
    await env.DB.prepare(
      "UPDATE jobs SET claimed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2.5 seconds') WHERE id = ?",
    )
      .bind(job.id)
      .run();
    const progress = (await readRun(run.id)).progress;
    expect(progress?.startedAt).not.toBeNull();
    expect(progress?.elapsedMs).toBeGreaterThanOrEqual(2500);
    expect(progress?.elapsedMs).toBeLessThan(10_000);
    expect(progress?.costSoFar).toBeGreaterThanOrEqual(417);
    expect(progress?.cancelling).toBe(false);
  });

  it("is gone once the run has finished", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    await upload(job, RUN_FILES);
    await complete(job.id, { status: "succeeded", result: SOLVED });
    expect((await readRun(run.id)).progress).toBeNull();
  });
});

describe("the admin's cancel and re-queue of a run (M13.2, ADR-127)", () => {
  const adminCall = (jobId: string, action: "cancel" | "requeue") =>
    call("POST", `/api/admin/jobs/${jobId}/${action}`, { cookie: alice });

  async function beat(jobId: string): Promise<Response> {
    return call("POST", `/internal/jobs/${jobId}/heartbeat`, { json: { workerId: "w1", stage: "solving" }, token: TOKEN });
  }

  const jobOf = async (runId: string) =>
    (await env.DB.prepare("SELECT job_id FROM runs WHERE id = ?").bind(runId).first<{ job_id: string }>())?.job_id ?? "";

  it("ends a queued run at once, uncharged, and says the administrator stopped it", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const jobId = await jobOf(run.id);
    const response = await adminCall(jobId, "cancel");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ job: { status: "failed", failureCause: "cancelled_by_admin" } });
    const ended = await readRun(run.id);
    expect(ended).toMatchObject({ status: "failed", progress: null });
    expect(ended.problem).toBe(
      "The run was stopped by the ClearFEA administrator (cancelled_by_admin). This is not a fault in your setup, so nothing is charged. Run it again; if it fails again, report it.",
    );
    expect((await charges(aliceId)).map((e) => e.reason)).toEqual(["mesh"]);
    const none = await call("POST", "/internal/jobs/claim", { json: { workerId: "w1", jobTypes: ["solve"] }, token: TOKEN });
    expect(none.status).toBe(204);
    // Once ended, there is nothing left to cancel or queue again.
    expect((await adminCall(jobId, "cancel")).status).toBe(409);
    expect((await adminCall(jobId, "requeue")).status).toBe(409);
  });

  it("ends a running run uncharged, and the worker's next heartbeat tells it to stop", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    expect((await beat(job.id)).status).toBe(200);
    expect((await adminCall(job.id, "cancel")).status).toBe(200);
    expect(await (await beat(job.id)).json()).toEqual({ action: "cancel" });
    // The worker's report of its stop comes too late and changes nothing.
    const late = await call("POST", `/internal/jobs/${job.id}/complete`, {
      json: { workerId: "w1", status: "stopped", metering: { billableMs: 9000 } },
      token: TOKEN,
    });
    expect(late.status).toBe(409);
    const ended = await readRun(run.id);
    expect(ended.status).toBe("failed");
    expect(ended.cost?.charged).toBe(false);
    expect((await charges(aliceId)).map((e) => e.reason)).toEqual(["mesh"]);
    const tries = await env.DB.prepare("SELECT status, failure_cause FROM job_stats WHERE job_id = ?")
      .bind(job.id)
      .all();
    expect(tries.results).toEqual([{ status: "failed", failure_cause: "cancelled_by_admin" }]);
  });

  it("queues a running run again: the run keeps solving and its log says why", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    expect((await beat(job.id)).status).toBe(200);
    const response = await adminCall(job.id, "requeue");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ job: { status: "queued", attempt: 2, claimedBy: null, queuePosition: 1 } });
    expect((await readRun(run.id)).status).toBe("solving");
    expect((await readLog(run.id, 0)).text).toContain("The administrator stopped try 1 and queued the job again");
    // The old worker no longer holds it; the next claim starts try 2.
    expect((await beat(job.id)).status).toBe(404);
    expect((await claim("solve")).id).toBe(job.id);
    expect((await adminCall(job.id, "requeue")).status).toBe(200);
    expect(await getJob(env.DB, aliceId, job.id)).toMatchObject({ status: "queued", attempt: 3 });
    expect((await charges(aliceId)).map((e) => e.reason)).toEqual(["mesh"]);
  });

  it("does not queue again a run its owner is cancelling", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    await call("POST", `/api/runs/${run.id}/cancel`, { cookie: alice });
    expect((await adminCall(job.id, "requeue")).status).toBe(409);
    expect((await adminCall(job.id, "cancel")).status).toBe(200);
  });
});

describe("cancelling a run (M8.2)", () => {
  async function cancel(runId: string, cookie = alice): Promise<Response> {
    return call("POST", `/api/runs/${runId}/cancel`, { cookie });
  }

  async function beat(jobId: string): Promise<unknown> {
    const response = await call("POST", `/internal/jobs/${jobId}/heartbeat`, {
      json: { workerId: "w1", stage: "solving" },
      token: TOKEN,
    });
    expect(response.status).toBe(200);
    return response.json();
  }

  it("ends a run still waiting for the worker at once, without a charge", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const response = await cancel(run.id);
    expect(response.status).toBe(200);
    const cancelled = await runOf(response);
    expect(cancelled).toMatchObject({ status: "cancelled", stage: null, progress: null, files: [] });
    expect(cancelled.problem).toContain("before the solver started, so nothing was charged");
    expect(cancelled.cost).toEqual({ billedSeconds: 0, amount: 0, charged: false });
    expect((await charges(aliceId)).map((e) => e.reason)).toEqual(["mesh"]);
    // The worker never gets it, and the next run may start.
    const none = await call("POST", "/internal/jobs/claim", { json: { workerId: "w1", jobTypes: ["solve"] }, token: TOKEN });
    expect(none.status).toBe(204);
    expect((await startRun(id)).status).toBe(201);
  });

  it("asks the worker to stop, then charges the time it reports", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    expect(await beat(job.id)).toEqual({ action: "continue" });
    const asked = await runOf(await cancel(run.id));
    expect(asked).toMatchObject({ status: "solving", progress: { cancelling: true } });
    // Asking twice changes nothing.
    expect((await runOf(await cancel(run.id))).progress?.cancelling).toBe(true);
    expect(await beat(job.id)).toEqual({ action: "cancel" });
    await upload(job, ["deck.inp", "solver.log"]);
    await complete(job.id, { status: "stopped", metering: { billableMs: 12_300 } });
    const ended = await readRun(run.id);
    expect(ended).toMatchObject({ status: "cancelled", progress: null, files: ["deck.inp", "solver.log"] });
    expect(ended.problem).toBe("You cancelled the run after 13 s. The time it used is charged. Run it again for results.");
    // 13 s at 0.5 credit an hour: 1,805.56 rounds to 1,806 micro-credits.
    expect(ended.cost).toEqual({ billedSeconds: 13, amount: 1806, charged: true });
    expect((await charges(aliceId)).map((e) => [e.reason, e.amount])).toEqual([
      ["mesh", -833],
      ["solve", -1806],
    ]);
    expect(await getJob(env.DB, aliceId, job.id)).toMatchObject({ status: "cancelled", failureCategory: null });
    // A cancelled run has no results, and its deck and log can be read.
    expect((await call("GET", `/api/runs/${run.id}/fields`, { cookie: alice })).status).toBe(409);
    expect((await call("GET", `/api/runs/${run.id}/files/solver.log`, { cookie: alice })).status).toBe(200);
  });

  it("keeps the result of a job that finished before it saw the cancel", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    await cancel(run.id);
    await upload(job, RUN_FILES);
    await complete(job.id, { status: "succeeded", result: SOLVED });
    expect(await readRun(run.id)).toMatchObject({ status: "succeeded", cost: { charged: true } });
  });

  it("refuses a stop nobody asked for", async () => {
    const id = await meshed();
    await startRun(id);
    const job = await claim("solve");
    const done = await call("POST", `/internal/jobs/${job.id}/complete`, {
      json: { workerId: "w1", status: "stopped", metering: { billableMs: 1000 } },
      token: TOKEN,
    });
    expect(done.status).toBe(409);
    expect((await getJob(env.DB, aliceId, job.id))?.status).toBe("claimed");
  });

  it("refuses a finished run and answers another user's like a missing one", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    expect((await cancel(run.id, bob)).status).toBe(404);
    expect((await readRun(run.id)).status).toBe("solving");
    const job = await claim("solve");
    await upload(job, RUN_FILES);
    await complete(job.id, { status: "succeeded", result: SOLVED });
    const late = await cancel(run.id);
    expect(late.status).toBe(409);
    expect((await late.json<{ error: string }>()).error).toContain("already finished");
  });
});

describe("the stop limit (M8.3)", () => {
  async function beat(jobId: string): Promise<unknown> {
    const response = await call("POST", `/internal/jobs/${jobId}/heartbeat`, {
      json: { workerId: "w1", stage: "solving" },
      token: TOKEN,
    });
    expect(response.status).toBe(200);
    return response.json();
  }

  /** As if the worker had taken the job the given number of seconds ago. */
  async function claimedAgo(jobId: string, seconds: number): Promise<void> {
    await env.DB.prepare(
      `UPDATE jobs SET claimed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${seconds} seconds') WHERE id = ?`,
    )
      .bind(jobId)
      .run();
  }

  it("is three times the estimated time by default, and never under 30 s", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const seconds = run.estimate?.seconds ?? Number.NaN;
    expect(run.stopLimit).toEqual({ multiplier: 3, seconds: Math.max(30, Math.ceil(3 * seconds)) });
  });

  it("takes the multiplier the owner sets, within its range", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id, alice, { stopMultiplier: 12.5 }));
    const seconds = run.estimate?.seconds ?? Number.NaN;
    expect(run.stopLimit).toEqual({ multiplier: 12.5, seconds: Math.max(30, Math.ceil(12.5 * seconds)) });
    const job = await claim("solve");
    await upload(job, RUN_FILES);
    await complete(job.id, { status: "succeeded", result: SOLVED });
    for (const stopMultiplier of [0.2, 21, "3"]) {
      expect((await startRun(id, alice, { stopMultiplier })).status).toBe(400);
    }
  });

  it("stops a run at its limit and charges the time it used", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id, alice, { stopMultiplier: 0.5 }));
    expect(run.stopLimit?.seconds).toBe(30);
    const job = await claim("solve");
    await claimedAgo(job.id, 25);
    expect(await beat(job.id)).toEqual({ action: "continue" });
    await claimedAgo(job.id, 31);
    expect(await beat(job.id)).toEqual({ action: "stop" });
    // The run reads as solving until the worker has stopped, and an owner's cancel then changes nothing.
    expect((await readRun(run.id)).status).toBe("solving");
    await call("POST", `/api/runs/${run.id}/cancel`, { cookie: alice });
    expect(await beat(job.id)).toEqual({ action: "stop" });
    await upload(job, ["deck.inp", "solver.log"]);
    await complete(job.id, { status: "stopped", metering: { billableMs: 34_200 } });
    const ended = await readRun(run.id);
    expect(ended).toMatchObject({ status: "stopped", progress: null, files: ["deck.inp", "solver.log"] });
    expect(ended.problem).toBe(
      "The run reached its stop limit of 30 s (0.5 × the estimated time) and was stopped after 35 s. " +
        "The time it used is charged. If it needs longer, raise the stop limit and run it again; " +
        "a coarser mesh or a faster solver also shortens it.",
    );
    // 35 s at 0.5 credit an hour: 4,861.11 rounds to 4,861 micro-credits.
    expect(ended.cost).toEqual({ billedSeconds: 35, amount: 4861, charged: true });
    expect((await charges(aliceId)).map((e) => [e.reason, e.amount])).toEqual([
      ["mesh", -833],
      ["solve", -4861],
    ]);
    expect(await getJob(env.DB, aliceId, job.id)).toMatchObject({ status: "stopped_at_limit", failureCategory: null });
    const wallet = validateWalletResponse(await (await call("GET", "/api/wallet", { cookie: alice })).json());
    if (!wallet.ok) throw new Error(wallet.errors.join(" "));
    expect(wallet.value.wallet.entries.find((e) => e.run?.id === run.id)?.run?.status).toBe("stopped");
  });

  it("leaves a run its owner cancelled first as cancelled", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id, alice, { stopMultiplier: 0.5 }));
    const job = await claim("solve");
    await call("POST", `/api/runs/${run.id}/cancel`, { cookie: alice });
    await claimedAgo(job.id, 60);
    expect(await beat(job.id)).toEqual({ action: "cancel" });
  });
});

describe("a finished solve job", () => {
  it("stores the result summary and the run's files", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    await upload(job, RUN_FILES);
    await complete(job.id, { status: "succeeded", result: SOLVED });
    const done = await readRun(run.id);
    expect(done).toMatchObject({ status: "succeeded", stage: null, problem: null, result: SOLVED });
    expect(done.finishedAt).not.toBeNull();
    for (const name of RUN_FILES) {
      const stored = await env.FILES.get(`owners/${aliceId}/runs/${run.id}/${name}`);
      expect(await stored?.text()).toBe(`${name} content`);
    }
    const list = await call("GET", `/api/simulations/${id}/runs`, { cookie: alice });
    const runs = validateRunListResponse(await list.json());
    if (!runs.ok) throw new Error(runs.errors.join(" "));
    expect(runs.value.runs.map((r) => r.id)).toEqual([run.id]);
    // A finished run lets the next one start.
    expect((await startRun(id)).status).toBe(201);
  });

  it("streams a large upload to storage byte for byte (M9.1)", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    // Larger than one chunk of the request stream, and not text.
    const bytes = new Uint8Array(1024 * 1024 + 17);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 2654435761) >>> 24;
    const put = await call("PUT", transferPath(job, "results.frd", "upload"), { raw: bytes, token: TOKEN });
    expect(put.status).toBe(200);
    const stored = await env.FILES.get(`owners/${aliceId}/runs/${run.id}/results.frd`);
    const back = new Uint8Array((await stored?.arrayBuffer()) ?? new ArrayBuffer(0));
    expect(back.length).toBe(bytes.length);
    expect(back.every((b, i) => b === bytes[i])).toBe(true);
  });

  it("serves the viewer's result files once the run has succeeded", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    for (const file of ["surface", "fields"]) {
      const early = await call("GET", `/api/runs/${run.id}/${file}`, { cookie: alice });
      expect(early.status).toBe(409);
      expect(((await early.json()) as { error: string }).error).toContain("still solving");
    }
    await upload(job, RUN_FILES);
    await complete(job.id, { status: "succeeded", result: SOLVED });
    for (const [file, name] of [
      ["surface", "surface.bin"],
      ["fields", "fields.bin"],
    ]) {
      const response = await call("GET", `/api/runs/${run.id}/${file}`, { cookie: alice });
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
      expect(new TextDecoder().decode(await response.arrayBuffer())).toBe(`${name} content`);
      // Another user's run answers like a missing one.
      expect((await call("GET", `/api/runs/${run.id}/${file}`, { cookie: bob })).status).toBe(404);
    }
  });

  it("serves the run's mesh and its values at every node, whole or one field at a time", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    for (const file of ["mesh", "nodes"]) {
      const early = await call("GET", `/api/runs/${run.id}/${file}`, { cookie: alice });
      expect(early.status).toBe(409);
    }
    // A result-fields file of two nodes: displacement (3 components), then von Mises.
    const nodes = new ArrayBuffer(16 + 2 * 36 + 4 * (2 * 3 + 2));
    const view = new DataView(nodes);
    const bytes = new Uint8Array(nodes);
    bytes.set(new TextEncoder().encode("CFRF"), 0);
    view.setUint32(4, 1, true);
    view.setUint32(8, 2, true);
    view.setUint32(12, 2, true);
    for (const [k, name, kind, components] of [
      [0, "displacement", "length", 3],
      [1, "vonMises", "pressure", 1],
    ] as const) {
      bytes.set(new TextEncoder().encode(name), 16 + k * 36);
      bytes.set(new TextEncoder().encode(kind), 16 + k * 36 + 16);
      view.setUint32(16 + k * 36 + 32, components, true);
    }
    new Float32Array(nodes, 88, 8).set([1, 2, 3, 4, 5, 6, 7.5, 8.5]);
    await upload(
      job,
      RUN_FILES.filter((name) => name !== "nodes.bin"),
    );
    const put = await call("PUT", transferPath(job, "nodes.bin", "upload"), { raw: nodes, token: TOKEN });
    expect(put.status).toBe(200);
    await complete(job.id, { status: "succeeded", result: SOLVED });

    const mesh = await call("GET", `/api/runs/${run.id}/mesh`, { cookie: alice });
    expect(mesh.status).toBe(200);
    expect(new TextDecoder().decode(await mesh.arrayBuffer())).toBe("mesh.bin content");
    const whole = await call("GET", `/api/runs/${run.id}/nodes`, { cookie: alice });
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(bytes);

    const one = await call("GET", `/api/runs/${run.id}/nodes?field=vonMises`, { cookie: alice });
    expect(one.status).toBe(200);
    expect(one.headers.get("Content-Length")).toBe(String(16 + 36 + 8));
    const got = await one.arrayBuffer();
    const head = new DataView(got);
    expect([head.getUint32(8, true), head.getUint32(12, true)]).toEqual([2, 1]);
    expect(new Uint8Array(got, 16, 36)).toEqual(bytes.subarray(16 + 36, 16 + 72));
    expect([...new Float32Array(got.slice(52))]).toEqual([7.5, 8.5]);

    const unknown = await call("GET", `/api/runs/${run.id}/nodes?field=temperature`, { cookie: alice });
    expect(unknown.status).toBe(404);
    for (const file of ["mesh", "nodes", "nodes?field=vonMises"]) {
      expect((await call("GET", `/api/runs/${run.id}/${file}`, { cookie: bob })).status).toBe(404);
    }
  });

  it("says to run again when a run was solved before node values were kept", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    await upload(job, RUN_FILES);
    await complete(job.id, { status: "succeeded", result: SOLVED });
    // Runs from before M3.4 recorded no nodes.bin.
    await env.DB.prepare("UPDATE runs SET files = ? WHERE id = ?")
      .bind(JSON.stringify(RUN_FILES.filter((name) => name !== "nodes.bin")), run.id)
      .run();
    const response = await call("GET", `/api/runs/${run.id}/nodes?field=vonMises`, { cookie: alice });
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toContain("Run the simulation again");
  });

  it("has no result files for a failed run", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    await complete(job.id, {
      status: "failed",
      failureCategory: "user_fault",
      failureCause: "setup_invalid",
      failureMessage: "Add a support.",
    });
    const response = await call("GET", `/api/runs/${run.id}/surface`, { cookie: alice });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toContain("failed");
  });

  it("shows the worker's message when the setup could not be solved", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    await complete(job.id, {
      status: "failed",
      failureCategory: "user_fault",
      failureCause: "setup_invalid",
      failureMessage: "Body 1 has no material. Assign a material to it.",
    });
    expect(await readRun(run.id)).toMatchObject({
      status: "failed",
      problem: "Body 1 has no material. Assign a material to it.",
      failure: { category: "user_fault", cause: "setup_invalid" },
      result: null,
    });
  });

  it("turns a success without all its files into a platform fault", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    await upload(job, ["deck.inp", "solver.log"]);
    await complete(job.id, { status: "succeeded", result: SOLVED });
    expect(await getJob(env.DB, aliceId, job.id)).toMatchObject({ failureCause: "outputs_missing" });
    expect((await readRun(run.id)).problem).toContain("fault in ClearFEA, not in your setup (outputs_missing)");
  });

  it("refuses a result that is not a solve result", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    await upload(job, RUN_FILES);
    await complete(job.id, { status: "succeeded", result: { ...SOLVED, nodes: "many" } });
    expect((await readRun(run.id)).problem).toContain("invalid_result");
  });
});

describe("a worker that stops checking in (M8.4)", () => {
  /** Moves the solve job's last heartbeat back by this many seconds, and its claim 30 s before that. */
  async function silentFor(jobId: string, seconds: number): Promise<void> {
    const at = (s: number) => new Date(Date.now() - s * 1000).toISOString();
    await env.DB.prepare("UPDATE jobs SET claimed_at = ?, heartbeat_at = ? WHERE id = ?")
      .bind(at(seconds + 30), at(seconds), jobId)
      .run();
  }

  /** Makes the job's current try its last (M12.2, ADR-108), so a lost worker fails it. */
  async function lastTry(jobId: string): Promise<void> {
    await env.DB.prepare("UPDATE jobs SET attempt = ? WHERE id = ?").bind(MAX_ATTEMPTS, jobId).run();
  }

  /** Another worker asking for work, which since M11.3 fails only its own lost jobs. */
  async function otherWorkerClaims(): Promise<void> {
    const response = await call("POST", "/internal/jobs/claim", {
      json: { workerId: "w2", jobTypes: ["noop"] },
      token: TOKEN,
    });
    expect(response.status).toBe(204);
  }

  async function solving(): Promise<{ run: RunView; job: ClaimResponse["job"] }> {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    await heartbeat(job.id);
    return { run, job };
  }

  it("queues the run's job again after the timeout, uncharged, and the next try solves it (M12.2)", async () => {
    const { run, job } = await solving();
    await silentFor(job.id, 121);
    // Only the per-minute cron looks for silent workers (M11.3, ADR-112), not another worker's claim.
    await otherWorkerClaims();
    expect(await sweepLostJobs(env)).toBe(1);
    expect(await readRun(run.id)).toMatchObject({ status: "solving", stage: "queued", problem: null, failure: null });
    expect(await getJob(env.DB, aliceId, job.id)).toMatchObject({ status: "queued", attempt: 2, claimedBy: null });
    expect((await readLog(run.id, 0)).text).toContain(
      "[ClearFEA] Try 1 of 3 stopped because the machine working on it stopped responding (worker_lost), " +
        "a fault in ClearFEA, not in your setup. Nothing is charged for it, and the job is queued again.",
    );
    // The worker that went silent is told to give up, and its late result is refused.
    const beat = await call("POST", `/internal/jobs/${job.id}/heartbeat`, { json: { workerId: "w1" }, token: TOKEN });
    expect(beat.status).toBe(404);
    const again = await claim("solve");
    expect(again.id).toBe(job.id);
    await upload(again, RUN_FILES);
    await complete(again.id, { status: "succeeded", result: SOLVED });
    expect(await readRun(run.id)).toMatchObject({ status: "succeeded", cost: { billedSeconds: 3, charged: true } });
    expect((await charges(aliceId)).map((e) => e.reason)).toEqual(["mesh", "solve"]);
  });

  it("fails the run as a fault in ClearFEA on its last try, without a charge", async () => {
    const { run, job } = await solving();
    await lastTry(job.id);
    await silentFor(job.id, 121);
    await otherWorkerClaims();
    expect((await readRun(run.id)).status).toBe("solving");
    expect(await sweepLostJobs(env)).toBe(1);
    const failed = await readRun(run.id);
    expect(failed).toMatchObject({
      status: "failed",
      failure: { category: "platform_fault", cause: "worker_lost" },
      // 30 s from the claim to the last heartbeat is recorded; nothing is charged.
      cost: { billedSeconds: 30, amount: 0, charged: false },
      progress: null,
    });
    expect(failed.problem).toBe(
      "The run stopped because the machine working on it stopped responding (no check-in for 120 s). " +
        "This is a fault in ClearFEA, not in your setup, so nothing is charged. It stopped this way on all 3 tries. " +
        "Run it again; if it fails again, report it.",
    );
    expect((await charges(aliceId)).map((e) => e.reason)).toEqual(["mesh"]);
  });

  it("fails a run that was asked to stop rather than queue it again", async () => {
    const { run, job } = await solving();
    expect((await call("POST", `/api/runs/${run.id}/cancel`, { cookie: alice })).status).toBe(200);
    await silentFor(job.id, 121);
    expect(await sweepLostJobs(env)).toBe(1);
    expect((await readRun(run.id)).failure).toEqual({ category: "platform_fault", cause: "worker_lost" });
  });

  it("leaves a run whose worker checked in within the timeout", async () => {
    const { run, job } = await solving();
    await silentFor(job.id, 100);
    expect(await sweepLostJobs(env)).toBe(0);
    expect((await readRun(run.id)).status).toBe("solving");
  });

  it("queues a job again at once when its own worker asks for another, as after a restart", async () => {
    const { run, job } = await solving();
    const response = await call("POST", "/internal/jobs/claim", { json: { workerId: "w1", jobTypes: ["noop"] }, token: TOKEN });
    expect(response.status).toBe(204);
    expect((await readRun(run.id)).status).toBe("solving");
    expect(await getJob(env.DB, aliceId, job.id)).toMatchObject({ status: "queued", attempt: 2 });
  });

  it("fails a job at once on its last try when its own worker asks for another", async () => {
    const { run, job } = await solving();
    await lastTry(job.id);
    const response = await call("POST", "/internal/jobs/claim", { json: { workerId: "w1", jobTypes: ["noop"] }, token: TOKEN });
    expect(response.status).toBe(204);
    expect((await readRun(run.id)).failure).toEqual({ category: "platform_fault", cause: "worker_lost" });
  });

  it("tells a worker that comes back to give up, and refuses its late result", async () => {
    const { run, job } = await solving();
    await lastTry(job.id);
    await silentFor(job.id, 121);
    await sweepLostJobs(env);
    const beat = await call("POST", `/internal/jobs/${job.id}/heartbeat`, { json: { workerId: "w1" }, token: TOKEN });
    expect(await beat.json()).toEqual({ action: "cancel" });
    const late = await call("POST", `/internal/jobs/${job.id}/complete`, {
      json: { workerId: "w1", metering: { billableMs: 200_000 }, status: "succeeded", result: SOLVED },
      token: TOKEN,
    });
    expect(late.status).toBe(409);
    expect(await readRun(run.id)).toMatchObject({ status: "failed", result: null, cost: { charged: false } });
    expect((await charges(aliceId)).map((e) => e.reason)).toEqual(["mesh"]);
  });

  it("queues a lost mesh job again, and fails it on its last try and says so on the mesh", async () => {
    const id = await simulation();
    await requestMesh(id);
    const job = await claim("mesh");
    await silentFor(job.id, 121);
    expect(await sweepLostJobs(env)).toBe(1);
    const status = () =>
      env.DB.prepare("SELECT status, problem FROM meshes WHERE job_id = ?")
        .bind(job.id)
        .first<{ status: string; problem: string }>();
    expect((await status())?.status).toBe("meshing");
    const again = await claim("mesh");
    await lastTry(again.id);
    await silentFor(again.id, 121);
    expect(await sweepLostJobs(env)).toBe(1);
    const mesh = await status();
    expect(mesh?.status).toBe("failed");
    expect(mesh?.problem).toContain("Meshing stopped because the machine working on it stopped responding");
    expect(await charges(aliceId)).toEqual([]);
  });
});

describe("a job container that ends without reporting (M12.2, ADR-108)", () => {
  async function solving(): Promise<{ run: RunView; job: ClaimResponse["job"] }> {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    await heartbeat(job.id, "PaStiX: factorising\n");
    return { run, job };
  }

  /** The compute manager reporting the container's end, as `w1`, the lane's worker id. */
  async function managerReports(jobId: string, cause: string, metering: Record<string, number> = { billableMs: 60_000 }) {
    return call("POST", `/internal/jobs/${jobId}/complete`, {
      json: { workerId: "w1", status: "failed", failureCategory: "platform_fault", failureCause: cause, metering },
      token: TOKEN,
    });
  }

  it("queues the job again twice, uncharged, then fails it with what happened", async () => {
    const { run, job } = await solving();
    for (const attempt of [2, 3]) {
      const response = await managerReports(job.id, "container_exited");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ job: { id: job.id, type: "solve", targetId: run.id, status: "queued" } });
      expect(await getJob(env.DB, aliceId, job.id)).toMatchObject({ status: "queued", attempt, billableMs: null });
      expect((await readRun(run.id)).status).toBe("solving");
      expect((await claim("solve")).id).toBe(job.id);
    }
    expect((await managerReports(job.id, "container_exited")).status).toBe(200);
    const failed = await readRun(run.id);
    expect(failed).toMatchObject({
      status: "failed",
      failure: { category: "platform_fault", cause: "container_exited" },
      cost: { billedSeconds: 60, amount: 0, charged: false },
    });
    expect(failed.problem).toBe(
      "The run stopped because the machine working on it stopped unexpectedly (container_exited). " +
        "This is a fault in ClearFEA, not in your setup, so nothing is charged. It stopped this way on all 3 tries. " +
        "Run it again; if it fails again, report it.",
    );
    const log = (await readLog(run.id, 0)).text;
    expect(log).toContain("PaStiX: factorising");
    expect(log).toContain("Try 1 of 3 stopped because the machine working on it stopped unexpectedly (container_exited)");
    expect(log).toContain("Try 2 of 3 stopped");
    expect((await charges(aliceId)).map((e) => e.reason)).toEqual(["mesh"]);
  });

  it("queues a job whose container did not start again", async () => {
    const { job } = await solving();
    expect((await managerReports(job.id, "container_start_failed")).status).toBe(200);
    expect(await getJob(env.DB, aliceId, job.id)).toMatchObject({ status: "queued", attempt: 2 });
  });

  it("does not retry running out of memory, and records the peak memory", async () => {
    const { run, job } = await solving();
    expect((await managerReports(job.id, "out_of_memory", { billableMs: 60_000, peakMemoryBytes: 17 * 2 ** 30 })).status).toBe(200);
    expect(await getJob(env.DB, aliceId, job.id)).toMatchObject({ status: "failed", attempt: 1, peakMemoryBytes: 17 * 2 ** 30 });
    const failed = await readRun(run.id);
    expect(failed.failure?.cause).toBe("out_of_memory");
    expect(failed.problem).toContain("It used 17 GiB at its peak.");
  });

  it("does not retry a fault the worker reported, or the 13-hour limit", async () => {
    for (const cause of ["solver_error", "job_timeout"]) {
      const { run, job } = await solving();
      expect((await managerReports(job.id, cause)).status).toBe(200);
      expect((await readRun(run.id)).failure).toEqual({ category: "platform_fault", cause });
    }
  });

  it("does not retry a run that was asked to stop", async () => {
    const { run, job } = await solving();
    expect((await call("POST", `/api/runs/${run.id}/cancel`, { cookie: alice })).status).toBe(200);
    expect((await managerReports(job.id, "container_exited")).status).toBe(200);
    expect((await readRun(run.id)).failure).toEqual({ category: "platform_fault", cause: "container_exited" });
  });
});

describe("the solver a PaStiX run falls back to (M12.2, ADR-108)", () => {
  it("is SPOOLES for a PaStiX run, frozen in the job, and the run says which solver solved it", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    expect(job.params).toMatchObject({ fallbackSolver: "spooles" });
    await upload(job, RUN_FILES);
    await complete(job.id, { status: "succeeded", result: { ...SOLVED, solver: "spooles" } });
    expect((await readRun(run.id)).result?.solver).toBe("spooles");
  });
});

describe("the solver of a run (ADR-063)", () => {
  it("is frozen with the run, PaStiX when the spec names none", async () => {
    const id = await meshed();
    const started = await runOf(await startRun(id));
    expect(started.spec.solver).toBe("pastix");
    expect(started.estimate?.solver).toBe("pastix");
  });

  it("refuses a mesh with more elements than the solver may solve on 16 GB", async () => {
    const id = await meshed();
    const elements = maxElements("pastix", 2) + 1;
    await env.DB.prepare("UPDATE meshes SET element_count = ?").bind(elements).run();
    const response = await startRun(id);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe(elementLimitProblem("pastix", 2, elements));
  });
});

describe("the run record", () => {
  it("holds the frozen spec, the mesh and the versions that produced the run", async () => {
    const id = await meshed();
    const started = await runOf(await startRun(id));
    expect(started.spec).toMatchObject({ mesh: { size: fixture.mesh.size } });
    expect(started.mesh).toEqual({ size: fixture.mesh.size, order: 2, nodeCount: 7108, elementCount: 4000 });
    // The mesh's versions are known from the start, the solver's once the job has ended.
    expect(started.software).toEqual({ clearfea: null, deckFormat: null, calculix: null, gmsh: "4.15.2", occt: "7.8.1" });
    expect(started.files).toEqual([]);

    const job = await claim("solve", { ...WORKER, gmsh: "9.9.9" });
    await upload(job, RUN_FILES);
    await complete(job.id, { status: "succeeded", result: SOLVED });
    const done = await readRun(started.id);
    // Gmsh is the mesh's version, not the solving worker's.
    expect(done.software).toEqual({
      clearfea: "0.0.0+d9d394b",
      deckFormat: 1,
      calculix: "2.21",
      gmsh: "4.15.2",
      occt: "7.8.1",
    });
    expect(done.files).toEqual(RUN_FILES);
    expect(done.spec).toEqual(started.spec);
  });

  it("leaves the solver's versions unknown when the worker sent none", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve", null);
    await upload(job, RUN_FILES);
    await complete(job.id, { status: "succeeded", result: SOLVED });
    expect((await readRun(run.id)).software).toMatchObject({ clearfea: null, deckFormat: null, calculix: null });
  });

  it("refuses versions that do not match the schema", async () => {
    const response = await call("POST", "/internal/jobs/claim", {
      json: { workerId: "w1", jobTypes: ["solve"], software: { ...WORKER, deckFormat: "one" } },
      token: TOKEN,
    });
    expect(response.status).toBe(400);
  });
});

describe("a run's solver input and log", () => {
  async function file(runId: string, name: string, query = "", cookie = alice): Promise<Response> {
    return call("GET", `/api/runs/${runId}/files/${name}${query}`, { cookie });
  }

  it("are shown as plain text and downloaded as files once the run has finished", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    const early = await file(run.id, "deck.inp");
    expect(early.status).toBe(409);
    expect(((await early.json()) as { error: string }).error).toContain("still solving");
    await upload(job, RUN_FILES);
    await complete(job.id, { status: "succeeded", result: SOLVED });
    for (const name of ["deck.inp", "solver.log"]) {
      const shown = await file(run.id, name);
      expect(shown.status).toBe(200);
      expect(shown.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
      expect(shown.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(shown.headers.get("Content-Disposition")).toBe(`inline; filename="clearfea-run-${run.id.slice(0, 8)}-${name}"`);
      expect(await shown.text()).toBe(`${name} content`);
      const saved = await file(run.id, name, "?download=1");
      expect(saved.headers.get("Content-Disposition")).toBe(
        `attachment; filename="clearfea-run-${run.id.slice(0, 8)}-${name}"`,
      );
      expect(await saved.text()).toBe(`${name} content`);
      // Another user's run answers like a missing one.
      expect((await file(run.id, name, "", bob)).status).toBe(404);
    }
  });

  it("serves no other file of the run", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    await upload(job, RUN_FILES);
    await complete(job.id, { status: "succeeded", result: SOLVED });
    for (const name of ["surface.bin", "fields.bin", "..%2Fspec.json"]) {
      expect((await file(run.id, name)).status).toBe(404);
    }
  });

  it("are kept for a run the solver stopped on", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    await upload(job, ["deck.inp", "solver.log"]);
    await complete(job.id, {
      status: "failed",
      failureCategory: "platform_fault",
      failureCause: "solver_error",
      failureMessage: "CalculiX stopped on the deck: *ERROR in ...",
    });
    const failed = await readRun(run.id);
    expect(failed).toMatchObject({ status: "failed", files: ["deck.inp", "solver.log"] });
    expect(await (await file(run.id, "deck.inp")).text()).toBe("deck.inp content");
    expect(await (await file(run.id, "solver.log")).text()).toBe("solver.log content");
  });

  it("do not exist when the run stopped before the solver started", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    await complete(job.id, {
      status: "failed",
      failureCategory: "user_fault",
      failureCause: "setup_invalid",
      failureMessage: "Add a support.",
    });
    expect((await readRun(run.id)).files).toEqual([]);
    const response = await file(run.id, "deck.inp");
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toContain("stopped before the solver started");
  });
});

describe("metering (ADR-033)", () => {
  /**
   * 2.5 s (the complete helper's billableMs) bills 3 s: 833 micro-credits for a mesh job on the
   * default size (medium, 1 credit an hour) and 417 for a solve on the size recommended for the
   * test mesh (small, 0.5 credit an hour).
   */
  const THREE_SECONDS = 833;
  const THREE_SECONDS_SMALL = 417;

  async function finish(body: Record<string, unknown>): Promise<RunView> {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    await upload(job, RUN_FILES);
    await complete(job.id, body);
    return readRun(run.id);
  }

  it("bills a run on the recommended machine size from the moment it starts", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    expect(run).toMatchObject({ machine: { size: "small", ratePerHour: 500_000 }, cost: null });
    expect(run.estimate).toMatchObject({ nodes: 7108, recommended: "small" });
  });

  it("charges a succeeded run its billed seconds at the rate, with one ledger entry", async () => {
    const run = await finish({ status: "succeeded", result: SOLVED });
    expect(run.cost).toEqual({ billedSeconds: 3, amount: THREE_SECONDS_SMALL, charged: true });
    const ledger = await listLedger(env.DB, aliceId);
    // The grant, then the mesh job and the solve job, each charged once.
    expect(ledger.map((e) => [e.reason, e.amount, e.balance])).toEqual([
      ["grant", GRANT, GRANT],
      ["mesh", -THREE_SECONDS, GRANT - THREE_SECONDS],
      ["solve", -THREE_SECONDS_SMALL, GRANT - THREE_SECONDS - THREE_SECONDS_SMALL],
    ]);
    const job = await getJob(env.DB, aliceId, ledger[2]?.jobId ?? "");
    expect(job).toMatchObject({ type: "solve", billableMs: 2500, billedSeconds: 3, cost: THREE_SECONDS_SMALL });
  });

  it("charges a run that failed through the user's setup", async () => {
    const run = await finish({
      status: "failed",
      failureCategory: "user_fault",
      failureCause: "setup_invalid",
      failureMessage: "Add a support.",
    });
    expect(run.cost).toEqual({ billedSeconds: 3, amount: THREE_SECONDS_SMALL, charged: true });
    expect((await charges(aliceId)).map((e) => e.reason)).toEqual(["mesh", "solve"]);
  });

  it("does not charge a run that failed through a fault in ClearFEA, but records its time", async () => {
    const run = await finish({ status: "failed", failureCategory: "platform_fault", failureCause: "solver_error" });
    expect(run.cost).toEqual({ billedSeconds: 3, amount: 0, charged: false });
    expect(run.failure).toEqual({ category: "platform_fault", cause: "solver_error" });
    expect((await charges(aliceId)).map((e) => e.reason)).toEqual(["mesh"]);
  });

  it("does not charge a success that turned into a platform fault", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    await upload(job, ["deck.inp", "solver.log"]);
    await complete(job.id, { status: "succeeded", result: SOLVED });
    expect((await readRun(run.id)).cost).toMatchObject({ charged: false, amount: 0 });
    expect((await charges(aliceId)).map((e) => e.reason)).toEqual(["mesh"]);
  });

  it("rounds the measured time up to whole seconds", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    await upload(job, RUN_FILES);
    await complete(job.id, { status: "succeeded", result: SOLVED, metering: { billableMs: 3_600_001 } });
    // 3601 s at 500,000 an hour: 500,138.89 rounds to 500,139.
    expect((await readRun(run.id)).cost).toEqual({ billedSeconds: 3601, amount: 500_139, charged: true });
  });

  it("keeps the rate a job was queued at when the configured rate changes", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    await env.DB.prepare("UPDATE machine_sizes SET rate_per_hour = 7200000 WHERE name = 'small'").run();
    try {
      const job = await claim("solve");
      await upload(job, RUN_FILES);
      await complete(job.id, { status: "succeeded", result: SOLVED });
      expect((await readRun(run.id)).cost).toMatchObject({ amount: THREE_SECONDS_SMALL });
      // At 14.4 times the medium size's rate, small is no longer the cheapest size that fits.
      const next = await runOf(await startRun(id));
      expect(next.machine).toEqual({ size: "medium", ratePerHour: 1_000_000 });
      await complete((await claim("solve")).id, { status: "succeeded", result: SOLVED });
      const chosen = await runOf(await startRun(id, alice, { machineSize: "small" }));
      expect(chosen.machine).toEqual({ size: "small", ratePerHour: 7_200_000 });
    } finally {
      await env.DB.prepare("UPDATE machine_sizes SET rate_per_hour = 500000 WHERE name = 'small'").run();
    }
  });

  it("charges a job once however often the worker reports it", async () => {
    const id = await meshed();
    await runOf(await startRun(id));
    const job = await claim("solve");
    await upload(job, RUN_FILES);
    await complete(job.id, { status: "succeeded", result: SOLVED });
    const again = await call("POST", `/internal/jobs/${job.id}/complete`, {
      json: { workerId: "w1", status: "succeeded", result: SOLVED, metering: { billableMs: 9000 } },
      token: TOKEN,
    });
    expect(again.status).toBe(409);
    expect(await charges(aliceId)).toHaveLength(2);
  });

  it("refuses a completion without metering", async () => {
    const id = await meshed();
    await runOf(await startRun(id));
    const job = await claim("solve");
    const response = await call("POST", `/internal/jobs/${job.id}/complete`, {
      json: { workerId: "w1", status: "succeeded", result: SOLVED },
      token: TOKEN,
    });
    expect(response.status).toBe(400);
    expect(await charges(aliceId)).toHaveLength(1);
  });

  it("keeps a running balance that reconciles with the sum of the entries", async () => {
    const id = await meshed();
    for (const billableMs of [1, 999, 1000, 1001, 45_250]) {
      // On the medium size, at 1 credit an hour.
      await runOf(await startRun(id, alice, { machineSize: "medium" }));
      const job = await claim("solve");
      await upload(job, RUN_FILES);
      await complete(job.id, { status: "succeeded", result: SOLVED, metering: { billableMs } });
    }
    const ledger = await listLedger(env.DB, aliceId);
    // The grant, then mesh 3 s, then 1, 1, 1, 2 and 46 s: 833 + 278 + 278 + 278 + 556 + 12,778.
    expect(ledger.map((e) => -e.amount)).toEqual([-GRANT, 833, 278, 278, 278, 556, 12_778]);
    let sum = 0;
    for (const entry of ledger) {
      sum += entry.amount;
      expect(entry.balance).toBe(sum);
    }
    expect(await charges((await signedInId("bob")) ?? "")).toEqual([]);
  });
});

describe("running out of memory (M8.5, ADR-082)", () => {
  const SMALL = 8 * 2 ** 30;
  /** The small size shrunk to 1 MiB, so the test mesh no longer fits it and medium is recommended. */
  async function withTinySmall(test: () => Promise<void>): Promise<void> {
    await env.DB.prepare("UPDATE machine_sizes SET memory_bytes = 1048576 WHERE name = 'small'").run();
    try {
      await test();
    } finally {
      await env.DB.prepare("UPDATE machine_sizes SET memory_bytes = ? WHERE name = 'small'").bind(SMALL).run();
    }
  }

  async function outOfMemory(machineSize?: string): Promise<RunView> {
    const id = await meshed();
    const run = await runOf(await startRun(id, alice, machineSize === undefined ? {} : { machineSize }));
    const job = await claim("solve");
    await upload(job, ["deck.inp", "solver.log"]);
    await complete(job.id, {
      status: "failed",
      failureCategory: "platform_fault",
      failureCause: "out_of_memory",
      failureMessage: "CalculiX ran out of memory (limit 13.6 GiB).",
    });
    return readRun(run.id);
  }

  it("queues the solve job with the size's cores and its usable memory as the limit", async () => {
    const id = await meshed();
    await startRun(id, alice, { machineSize: "large" });
    const job = await claim("solve");
    expect(job.params).toMatchObject({
      machine: {
        size: "large",
        cores: 8,
        memoryLimitBytes: Math.floor(32 * 2 ** 30 * estimatorTable.usableMemoryFraction),
      },
    });
  });

  it("is the platform's fault on the recommended size: not charged, and says to try a larger one", async () => {
    await withTinySmall(async () => {
      const run = await outOfMemory();
      expect(run.machine?.size).toBe("medium");
      expect(run.status).toBe("failed");
      expect(run.cost).toMatchObject({ charged: false, amount: 0 });
      expect(run.problem).toBe(
        "The run ran out of memory on the medium machine size (16 GiB), which by ClearFEA's estimate has enough memory, so the estimate was too low and the time is not charged. Run it again on a larger size; if it fails again, report it.",
      );
      expect((await charges(aliceId)).map((e) => e.reason)).toEqual(["mesh"]);
      // The deck and log are kept, so the run can be inspected.
      expect(run.files).toEqual(["deck.inp", "solver.log"]);
    });
  });

  it("is the platform's fault on a larger size than recommended", async () => {
    await withTinySmall(async () => {
      const run = await outOfMemory("xlarge");
      expect(run.cost).toMatchObject({ charged: false });
    });
  });

  it("is the user's fault on a size chosen against the estimate: charged, and names the recommended size", async () => {
    await withTinySmall(async () => {
      const run = await outOfMemory("small");
      expect(run.cost).toMatchObject({ charged: true, billedSeconds: 3 });
      expect(run.problem).toBe(
        "The run ran out of memory on the small machine size (1 MiB), which was chosen although the estimate needs more memory than it has, so the time it used is charged. Run it again on the recommended size, medium, or larger.",
      );
      const [, solve] = await charges(aliceId);
      expect(solve?.reason).toBe("solve");
      const job = await getJob(env.DB, aliceId, solve?.jobId ?? "");
      expect(job).toMatchObject({ failureCategory: "user_fault", failureCause: "out_of_memory" });
    });
  });

  it("is the platform's fault on a size the estimate says fits, even when it is not the recommended one", async () => {
    const run = await outOfMemory("medium");
    expect(run.cost).toMatchObject({ charged: false });
  });
});

describe("the wallet (M8.1, ADR-080)", () => {
  async function wallet(cookie = alice) {
    const response = await call("GET", "/api/wallet", { cookie });
    expect(response.status).toBe(200);
    const body = validateWalletResponse(await response.json());
    if (!body.ok) throw new Error(body.errors.join(" "));
    return body.value.wallet;
  }

  it("is refused without a session", async () => {
    expect((await call("GET", "/api/wallet")).status).toBe(401);
  });

  it("starts with the seed's grant, which a second seeding does not repeat", async () => {
    await env.DB.batch(env.TEST_SEED.flatMap((file) => file.queries).map((sql) => env.DB.prepare(sql)));
    const { entries, ...totals } = await wallet();
    expect(totals).toEqual({ balance: GRANT, granted: GRANT, charged: 0 });
    expect(entries).toMatchObject([{ reason: "grant", amount: GRANT, balance: GRANT, job: null, run: null, mesh: null }]);
  });

  it("lists every entry newest first with the run or mesh it paid for", async () => {
    const id = await meshed();
    const run = await runOf(await startRun(id));
    const job = await claim("solve");
    await upload(job, RUN_FILES);
    await complete(job.id, { status: "succeeded", result: SOLVED });
    const { entries, ...totals } = await wallet();
    const charged = -(833 + 417);
    expect(totals).toEqual({ balance: GRANT + charged, granted: GRANT, charged });
    expect(entries.map((e) => e.reason)).toEqual(["solve", "mesh", "grant"]);
    expect(entries[0]).toMatchObject({
      amount: -417,
      balance: GRANT + charged,
      job: { id: job.id, machineSize: "small", ratePerHour: 500_000, billedSeconds: 3 },
      run: { id: run.id, simulationId: id, simulationName: "Static structural", status: "succeeded" },
      mesh: null,
    });
    expect(entries[1]).toMatchObject({
      amount: -833,
      job: { machineSize: "medium", billedSeconds: 3 },
      run: null,
      mesh: { id: run.meshId, geometryName: "bracket.step", elements: 4000, nodes: 7108 },
    });
    // Bob's wallet holds his own grant and nothing of Alice's.
    expect((await wallet(bob)).entries.map((e) => [e.reason, e.amount])).toEqual([["grant", GRANT]]);
  });

  it("refuses a run whose estimated cost is more than the balance, before queueing it", async () => {
    const id = await meshed();
    await env.DB.prepare("DELETE FROM ledger_entries").run();
    const response = await startRun(id);
    expect(response.status).toBe(409);
    const { error } = (await response.json()) as { error: string };
    expect(error).toContain("estimated to cost");
    expect(error).toContain("your wallet holds 0 credits");
    const queued = await env.DB.prepare("SELECT count(*) AS n FROM jobs WHERE type = 'solve'").first<{ n: number }>();
    expect(queued?.n).toBe(0);
  });

  it("is hosted unless SELF_HOSTED says otherwise", async () => {
    const response = await call("GET", "/api/wallet", { cookie: alice });
    expect(((await response.json()) as { selfHosted: boolean }).selfHosted).toBe(false);
  });

  describe("when self-hosted (M8.10, ADR-084)", () => {
    // The same app with SELF_HOSTED set, as `.dev.vars` would set it.
    async function selfHostedCall(method: string, path: string): Promise<Response> {
      return app.request(`http://localhost${path}`, { method, headers: { Cookie: alice } }, { ...env, SELF_HOSTED: "true" });
    }

    it("says so on the wallet", async () => {
      const response = await selfHostedCall("GET", "/api/wallet");
      expect(response.status).toBe(200);
      const body = validateWalletResponse(await response.json());
      if (!body.ok) throw new Error(body.errors.join(" "));
      expect(body.value.selfHosted).toBe(true);
    });

    it("queues and charges a run the balance cannot cover, which takes the balance below zero", async () => {
      const id = await meshed();
      await env.DB.prepare("DELETE FROM ledger_entries").run();
      const response = await selfHostedCall("POST", `/api/simulations/${id}/runs`);
      expect(response.status).toBe(201);
      const job = await claim("solve");
      await upload(job, RUN_FILES);
      await complete(job.id, { status: "succeeded", result: SOLVED });
      const view = await wallet();
      expect(view.entries.map((e) => [e.reason, e.amount])).toEqual([["solve", -417]]);
      expect(view.balance).toBe(-417);
    });

    it("makes a new mesh at a balance of zero", async () => {
      const id = await simulation();
      await env.DB.prepare("DELETE FROM ledger_entries").run();
      const response = await selfHostedCall("POST", `/api/simulations/${id}/mesh`);
      expect(response.status).toBe(201);
    });
  });
});

async function signedInId(login: string): Promise<string | undefined> {
  const row = await env.DB.prepare("SELECT id FROM users WHERE login = ?").bind(login).first<{ id: string }>();
  return row?.id;
}

describe("estimates (ADR-049)", () => {
  async function estimate(simulationId: string, cookie = alice): Promise<Response> {
    return call("GET", `/api/simulations/${simulationId}/estimate`, { cookie });
  }

  it("estimate the current mesh on every machine size and recommend the cheapest that fits", async () => {
    const id = await meshed();
    const response = await estimate(id);
    expect(response.status).toBe(200);
    const body = validateEstimateResponse(await response.json());
    if (!body.ok) throw new Error(body.errors.join(" "));
    const fitted = estimateMesh(7108, 2);
    expect(body.value.estimate).toMatchObject({
      estimator: estimatorTable.version,
      nodes: 7108,
      memoryBytes: fitted.memoryBytes,
      seconds: fitted.seconds,
      extrapolated: false,
      recommended: "small",
    });
    expect(body.value.estimate.sizes.map((s) => [s.size, s.cores, s.memoryBytes / 2 ** 30, s.ratePerHour, s.fits])).toEqual([
      ["small", 2, 8, 500_000, true],
      ["medium", 4, 16, 1_000_000, true],
      ["large", 8, 32, 2_000_000, true],
      ["xlarge", 16, 64, 4_000_000, true],
    ]);
  });

  it("are for the spec's solver, or the one asked for, and refuse an unknown one (ADR-063)", async () => {
    const id = await meshed();
    const own = validateEstimateResponse(await (await estimate(id)).json());
    if (!own.ok) throw new Error(own.errors.join(" "));
    expect(own.value.estimate.solver).toBe("pastix");
    const asked = await call("GET", `/api/simulations/${id}/estimate?solver=iterative_scaling`, { cookie: alice });
    const body = validateEstimateResponse(await asked.json());
    if (!body.ok) throw new Error(body.errors.join(" "));
    expect(body.value.estimate.solver).toBe("iterative_scaling");
    expect(body.value.estimate.memoryBytes).toBe(estimateMesh(7108, 2, "iterative_scaling").memoryBytes);
    const bad = await call("GET", `/api/simulations/${id}/estimate?solver=pardiso`, { cookie: alice });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain("There is no solver called pardiso");
  });

  it("are refused, saying what to do, until the mesh is ready", async () => {
    const id = await simulation();
    const response = await estimate(id);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toContain("Generate the mesh");
  });

  it("are the owner's only", async () => {
    const id = await meshed();
    expect((await estimate(id, bob)).status).toBe(404);
  });

  it("are frozen with a run started on the size the user chose", async () => {
    const id = await meshed();
    const before = validateEstimateResponse(await (await estimate(id)).json());
    if (!before.ok) throw new Error(before.errors.join(" "));
    const response = await startRun(id, alice, { machineSize: "xlarge" });
    expect(response.status).toBe(201);
    const run = await runOf(response);
    expect(run.machine).toEqual({ size: "xlarge", ratePerHour: 4_000_000 });
    expect(run.estimate).toEqual(before.value.estimate);
    const job = await claim("solve");
    expect(job.id).toBeDefined();
  });

  it("refuse a machine size that is not on the list, and queue nothing", async () => {
    const id = await meshed();
    const response = await startRun(id, alice, { machineSize: "huge" });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe(
      "There is no machine size called huge. Choose one of: small, medium, large, xlarge.",
    );
    const list = validateRunListResponse(await (await call("GET", `/api/simulations/${id}/runs`, { cookie: alice })).json());
    expect(list.ok && list.value.runs.length).toBe(0);
    const none = await call("POST", "/internal/jobs/claim", {
      json: { workerId: "w1", jobTypes: ["solve"] },
      token: TOKEN,
    });
    expect(none.status).toBe(204);
  });

  it("refuse a run request that is not a CreateRunRequest", async () => {
    const id = await meshed();
    const response = await startRun(id, alice, { machine: "small" });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("CreateRunRequest");
  });
});

describe("on cloud machines (M10.6, ADR-099)", () => {
  // The same app with MACHINES=cloud, as the live site's configuration sets it, with a launcher key
  // so that runs are not refused for want of one (M10.7). Nothing reaches AWS: app.request runs
  // without an execution context, so the launcher is not called after the request.
  async function cloudCall(method: string, path: string, json?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Cookie: alice };
    if (json !== undefined) headers["Content-Type"] = "application/json";
    const body = json === undefined ? undefined : JSON.stringify(json);
    return app.request(`http://localhost${path}`, { method, headers, body }, {
      ...env,
      MACHINES: "cloud",
      AWS_REGION: "ap-south-1",
      AWS_LAUNCHER_ACCESS_KEY_ID: "AKIDEXAMPLE",
      AWS_LAUNCHER_SECRET_ACCESS_KEY: "secret",
    });
  }

  async function offered(id: string): Promise<string[]> {
    const body = validateEstimateResponse(await (await cloudCall("GET", `/api/simulations/${id}/estimate`)).json());
    if (!body.ok) throw new Error(body.errors.join(" "));
    return body.value.estimate.sizes.map((s) => s.size);
  }

  it("offers only the cloud sizes switched on, and says when a size asked for is off", async () => {
    const id = await meshed();
    expect(await offered(id)).toEqual(["medium"]);
    const refused = await cloudCall("POST", `/api/simulations/${id}/runs`, { machineSize: "large" });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({
      error: "The large machine size is switched off on this site. Choose one of: medium.",
    });
    const unknown = await cloudCall("POST", `/api/simulations/${id}/runs`, { machineSize: "huge" });
    expect(((await unknown.json()) as { error: string }).error).toBe(
      "There is no machine size called huge. Choose one of: medium.",
    );

    await env.DB.prepare("UPDATE machine_sizes SET cloud = 'on' WHERE name = 'large'").run();
    try {
      expect(await offered(id)).toEqual(["medium", "large"]);
      const started = await cloudCall("POST", `/api/simulations/${id}/runs`, { machineSize: "large" });
      expect(started.status).toBe(201);
      const job = await env.DB.prepare("SELECT machine_size FROM jobs WHERE type = 'solve'").first<{ machine_size: string }>();
      expect(job?.machine_size).toBe("large");
    } finally {
      await env.DB.prepare("UPDATE machine_sizes SET cloud = 'off' WHERE name = 'large'").run();
    }
  });

  it("still offers every size to the local worker", async () => {
    const id = await meshed();
    const body = validateEstimateResponse(await (await call("GET", `/api/simulations/${id}/estimate`, { cookie: alice })).json());
    if (!body.ok) throw new Error(body.errors.join(" "));
    expect(body.value.estimate.sizes.map((s) => s.size)).toEqual(["small", "medium", "large", "xlarge"]);
  });
});
