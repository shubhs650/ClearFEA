// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  type ClaimResponse,
  type MeshResult,
  type RunView,
  type SimulationSpec,
  type SolveResult,
  type Topology,
  type WorkerSoftware,
  validateClaimResponse,
  validateRunListResponse,
  validateRunLogResponse,
  validateRunResponse,
  validateSimulationResponse,
} from "@clearfea/spec";
import fixture from "@clearfea/spec/fixtures/simulation-v1.json";
import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getJob } from "../src/db/jobs";

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
    env.DB.prepare("DELETE FROM jobs"),
  ]);
});

/** A ready geometry of alice's, imported at scaling 0.5, with its topology.json stored. */
async function geometryRow(): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO geometries (id, owner_id, name, size_bytes, status, detected_unit, reading_factor,
       confirmed_unit, scaling, body_count, face_count)
     VALUES (?, ?, 'bracket.step', 100, 'ready', 'mm', 0.001, 'mm', 0.5, 1, 3)`,
  )
    .bind(id, aliceId)
    .run();
  await env.FILES.put(`owners/${aliceId}/geometries/${id}/topology.json`, JSON.stringify(TOPOLOGY));
  await env.FILES.put(`owners/${aliceId}/geometries/${id}/model.step`, "ISO-10303-21;");
  return id;
}

/** Alice's simulation with the fixture's spec, or with a different mesh size. */
async function simulation(size: SimulationSpec["mesh"]["size"] = fixture.mesh.size): Promise<string> {
  const geometryId = await geometryRow();
  const spec = { ...(JSON.parse(JSON.stringify(fixture)) as SimulationSpec), geometryId, mesh: { size } };
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
    json: { workerId: "w1", ...body },
    token: TOKEN,
  });
  expect(done.status).toBe(200);
}

/** Plays the worker: claims the mesh job, uploads both outputs, reports success. */
async function runMesh(): Promise<ClaimResponse["job"]> {
  const job = await claim("mesh");
  for (const name of ["mesh.bin", "display.bin"]) {
    const put = await call("PUT", transferPath(job, name, "upload"), { raw: `${name} content`, token: TOKEN });
    expect(put.status).toBe(200);
  }
  await complete(job.id, { status: "succeeded", result: RESULT });
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

const RUN_FILES = ["deck.inp", "solver.log", "results.frd", "results.dat", "surface.bin", "fields.bin"];

/** Alice's simulation with a ready mesh of its saved size. */
async function meshed(): Promise<string> {
  const id = await simulation();
  await requestMesh(id);
  await runMesh();
  return id;
}

async function startRun(simulationId: string, cookie = alice): Promise<Response> {
  return call("POST", `/api/simulations/${simulationId}/runs`, { cookie });
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

async function readLog(runId: string, after: number, cookie = alice): Promise<{ text: string; next: number }> {
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
      error: expect.stringContaining("mesh size changed"),
    });
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
    expect(all).toEqual({ text: "CalculiX Version 2.21\n STEP 1\n", next: 2 });
    expect(await readLog(run.id, 1)).toEqual({ text: " STEP 1\n", next: 2 });
    expect(await readLog(run.id, 2)).toEqual({ text: "", next: 2 });
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
    for (const name of ["results.frd", "fields.bin", "..%2Fspec.json"]) {
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
