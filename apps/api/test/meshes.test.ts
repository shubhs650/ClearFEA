// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  type ClaimResponse,
  type MeshResult,
  type MeshView,
  type SimulationSpec,
  type Topology,
  validateClaimResponse,
  validateMeshResponse,
  validateSimulationMeshResponse,
  validateSimulationResponse,
} from "@clearfea/spec";
import fixture from "@clearfea/spec/fixtures/simulation-v1.json";
import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getJob } from "../src/db/jobs";
import { findReusableMesh } from "../src/db/meshes";

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
  quality: { shapeMin: 0.21, shapeMean: 0.74, shapeHistogram: [0, 0, 3, 40, 200, 500, 900, 1300, 900, 157], jacobianMin: 0.93 },
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
    env.DB.prepare("DELETE FROM simulations"),
    env.DB.prepare("DELETE FROM meshes"),
    env.DB.prepare("DELETE FROM geometries"),
    env.DB.prepare("DELETE FROM ledger_entries"),
    env.DB.prepare("DELETE FROM jobs"),
  ]);
  // The seed's play-money grants (ADR-080), so meshing is not refused for want of funds.
  await env.DB.batch(env.TEST_SEED.flatMap((file) => file.queries).map((sql) => env.DB.prepare(sql)));
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

/** Alice's simulation with the fixture's spec, or with a different mesh size or mesh settings. */
async function simulation(
  size: SimulationSpec["mesh"]["size"] = fixture.mesh.size,
  settings: Partial<SimulationSpec["mesh"]> = {},
  geometry?: string,
): Promise<string> {
  const geometryId = geometry ?? (await geometryRow());
  const spec = {
    ...(JSON.parse(JSON.stringify(fixture)) as SimulationSpec),
    geometryId,
    mesh: { size, ...settings },
  };
  const response = await call("POST", "/api/simulations", {
    json: { geometryId, name: "Static structural", spec },
    cookie: alice,
  });
  expect(response.status).toBe(201);
  const body = validateSimulationResponse(await response.json());
  if (!body.ok) throw new Error(body.errors.join(" "));
  return body.value.simulation.id;
}

async function requestMesh(simulationId: string, cookie = alice): Promise<Response> {
  return call("POST", `/api/simulations/${simulationId}/mesh`, { cookie });
}

async function meshOf(response: Response): Promise<MeshView> {
  const body = validateMeshResponse(await response.json());
  if (!body.ok) throw new Error(body.errors.join(" "));
  return body.value.mesh;
}

async function currentMesh(simulationId: string, cookie = alice): Promise<MeshView | null> {
  const response = await call("GET", `/api/simulations/${simulationId}/mesh`, { cookie });
  expect(response.status).toBe(200);
  const body = validateSimulationMeshResponse(await response.json());
  if (!body.ok) throw new Error(body.errors.join(" "));
  return body.value.mesh;
}

async function geometryOf(simulationId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT geometry_id AS g FROM simulations WHERE id = ?").bind(simulationId).first<{ g: string }>();
  return row?.g ?? "";
}

/** Saves the simulation's spec with other mesh settings. */
async function saveMesh(simulationId: string, mesh: Partial<SimulationSpec["mesh"]>): Promise<void> {
  const read = validateSimulationResponse(await (await call("GET", `/api/simulations/${simulationId}`, { cookie: alice })).json());
  if (!read.ok) throw new Error(read.errors.join(" "));
  const spec = read.value.simulation.spec;
  const put = await call("PUT", `/api/simulations/${simulationId}/spec`, {
    json: { ...spec, mesh: { ...spec.mesh, ...mesh } },
    cookie: alice,
  });
  expect(put.status).toBe(200);
}

/** Rows of a table; for the ledger, its charges (the seed's grants left out). */
async function count(table: "jobs" | "ledger_entries" | "meshes"): Promise<number> {
  const where = table === "ledger_entries" ? " WHERE reason != 'grant'" : "";
  const row = await env.DB.prepare(`SELECT count(*) AS n FROM ${table}${where}`).first<{ n: number }>();
  return row?.n ?? 0;
}

async function claim(): Promise<ClaimResponse["job"]> {
  const response = await call("POST", "/internal/jobs/claim", {
    json: { workerId: "w1", jobTypes: ["mesh"] },
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
async function runMesh(): Promise<ClaimResponse["job"]> {
  const job = await claim();
  for (const name of ["mesh.bin", "display.bin"]) {
    const put = await call("PUT", transferPath(job, name, "upload"), { raw: `${name} content`, token: TOKEN });
    expect(put.status).toBe(200);
  }
  await complete(job.id, { status: "succeeded", result: RESULT });
  return job;
}

describe("requesting a mesh", () => {
  it("needs a mesh size in the saved setup", async () => {
    const id = await simulation(null);
    const response = await requestMesh(id);
    expect(response.status).toBe(409);
    expect((await response.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining("Enter a global mesh size"),
    });
    expect(await currentMesh(id)).toBeNull();
  });

  it("queues a second-order mesh job with the size as entered and the geometry's scaling", async () => {
    const id = await simulation({ value: 4, unit: "mm" });
    const response = await requestMesh(id);
    expect(response.status).toBe(201);
    const mesh = await meshOf(response);
    expect(mesh).toMatchObject({
      status: "meshing",
      size: { value: 4, unit: "mm" },
      order: 2,
      local: [],
      nodeCount: null,
      elementCount: null,
      quality: null,
    });
    expect(await currentMesh(id)).toEqual(mesh);

    const job = await claim();
    expect(job).toMatchObject({
      type: "mesh",
      targetId: mesh.id,
      params: { geometryId: mesh.geometryId, scaling: 0.5, size: { value: 4, unit: "mm" }, order: 2 },
    });
    expect(job.transfers.map((t) => `${t.direction} ${t.name}`)).toEqual([
      "download model.step",
      "download topology.json",
      "upload mesh.bin",
      "upload display.bin",
    ]);
    const topology = await call("GET", transferPath(job, "topology.json", "download"), { token: TOKEN });
    expect(await topology.json()).toEqual(TOPOLOGY);
  });

  it("queues the element order and the local sizes of the saved setup (M2.8)", async () => {
    const id = await simulation(
      { value: 4, unit: "mm" },
      {
        order: 1,
        local: [{ id: "hole", name: "Hole", scope: "faces", tags: [3, 1], size: { value: 0.5, unit: "mm" } }],
      },
    );
    const mesh = await meshOf(await requestMesh(id));
    const local = [{ scope: "faces", tags: [1, 3], size: { value: 0.5, unit: "mm" } }];
    expect(mesh).toMatchObject({ order: 1, local });
    const job = await claim();
    expect(job.params).toMatchObject({ order: 1, local });
  });

  it("refuses to mesh with an unfinished local size", async () => {
    const id = await simulation(
      { value: 4, unit: "mm" },
      { local: [{ id: "edge", name: "Fillet edge", scope: "edges", tags: [], size: { value: 1, unit: "mm" } }] },
    );
    const response = await requestMesh(id);
    expect(response.status).toBe(409);
    expect((await response.json()) as { error: string }).toEqual({
      error:
        'Local mesh size "Fillet edge" is not finished. Give it edges and a size, or delete it, then generate the mesh.',
    });
  });

  it("refuses a second request while the mesh is being made", async () => {
    const id = await simulation();
    expect((await requestMesh(id)).status).toBe(201);
    const again = await requestMesh(id);
    expect(again.status).toBe(409);
    expect((await again.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining("already being made"),
    });
  });

  it("answers another user's simulation like a missing one", async () => {
    const id = await simulation();
    expect((await requestMesh(id, bob)).status).toBe(404);
    expect((await call("GET", `/api/simulations/${id}/mesh`, { cookie: bob })).status).toBe(404);
    expect((await requestMesh(id, "")).status).toBe(401);
  });
});

describe("a finished mesh job", () => {
  it("makes the mesh ready with its counts and serves its display file", async () => {
    const id = await simulation();
    const requested = await meshOf(await requestMesh(id));
    const early = await call("GET", `/api/meshes/${requested.id}/display`, { cookie: alice });
    expect(early.status).toBe(409);

    await runMesh();
    const mesh = await currentMesh(id);
    expect(mesh).toMatchObject({
      id: requested.id,
      status: "ready",
      nodeCount: 7108,
      elementCount: 4000,
      quality: RESULT.quality,
    });
    const display = await call("GET", `/api/meshes/${requested.id}/display`, { cookie: alice });
    expect(display.status).toBe(200);
    expect(new TextDecoder().decode(await display.arrayBuffer())).toBe("display.bin content");
    const stored = await env.FILES.get(`owners/${aliceId}/meshes/${requested.id}/mesh.bin`);
    expect(await stored?.text()).toBe("mesh.bin content");
  });

  it("lets a request with other settings replace the simulation's mesh", async () => {
    const id = await simulation();
    const first = await meshOf(await requestMesh(id));
    await runMesh();
    await saveMesh(id, { size: { value: 3, unit: "mm" } });
    const response = await requestMesh(id);
    expect(response.status).toBe(201);
    const second = await meshOf(response);
    expect(second.id).not.toBe(first.id);
    expect((await currentMesh(id))?.id).toBe(second.id);
  });

  it("shows the worker's message when meshing failed because of the setup", async () => {
    const id = await simulation();
    const requested = await meshOf(await requestMesh(id));
    const job = await claim();
    await complete(job.id, {
      status: "failed",
      failureCategory: "user_fault",
      failureCause: "mesh_too_large",
      failureMessage: "Enter a mesh size of at least 0.656 mm.",
    });
    expect(await currentMesh(id)).toMatchObject({
      id: requested.id,
      status: "failed",
      problem: "Enter a mesh size of at least 0.656 mm.",
    });
    const display = await call("GET", `/api/meshes/${requested.id}/display`, { cookie: alice });
    expect(display.status).toBe(409);
  });

  it("turns a success without its output files into a platform fault", async () => {
    const id = await simulation();
    await requestMesh(id);
    const job = await claim();
    await complete(job.id, { status: "succeeded", result: RESULT });
    expect(await getJob(env.DB, aliceId, job.id)).toMatchObject({
      status: "failed",
      failureCategory: "platform_fault",
      failureCause: "outputs_missing",
    });
    const mesh = await currentMesh(id);
    expect(mesh?.status).toBe("failed");
    expect(mesh?.problem).toContain("fault in ClearFEA, not in your setup (outputs_missing)");
  });

  it("refuses a result that is not a mesh result", async () => {
    const id = await simulation();
    await requestMesh(id);
    const job = await claim();
    await complete(job.id, { status: "succeeded", result: { elements: "many" } });
    expect((await currentMesh(id))?.problem).toContain("invalid_result");
  });
});

describe("meshing and the wallet (M8.1, ADR-080)", () => {
  it("refuses a new mesh when the balance is not above zero, but still reuses one for free", async () => {
    const id = await simulation({ value: 4, unit: "mm" });
    await meshOf(await requestMesh(id));
    await runMesh();
    await env.DB.prepare("DELETE FROM ledger_entries").run();
    const reused = await requestMesh(id);
    expect(reused.status).toBe(200);
    await saveMesh(id, { size: { value: 5, unit: "mm" } });
    const refused = await requestMesh(id);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toContain("so a mesh cannot be made");
    expect(await count("jobs")).toBe(1);
  });
});

describe("reusing a mesh by its settings hash (M2.10)", () => {
  it("reuses a ready mesh with the same settings without a new job or charge", async () => {
    const id = await simulation({ value: 4, unit: "mm" });
    const first = await requestMesh(id);
    expect(first.status).toBe(201);
    expect(validateMeshResponse(await first.clone().json())).toMatchObject({ ok: true, value: { reused: false } });
    const made = await meshOf(first);
    await runMesh();
    expect(await count("ledger_entries")).toBe(1);

    const again = await requestMesh(id);
    expect(again.status).toBe(200);
    const body = validateMeshResponse(await again.json());
    if (!body.ok) throw new Error(body.errors.join(" "));
    expect(body.value.reused).toBe(true);
    expect(body.value.mesh).toMatchObject({ id: made.id, status: "ready", elementCount: 4000 });
    expect(await count("jobs")).toBe(1);
    expect(await count("meshes")).toBe(1);
    expect(await count("ledger_entries")).toBe(1);
  });

  it("goes back to the earlier mesh when the settings are changed back", async () => {
    const id = await simulation({ value: 4, unit: "mm" });
    const coarse = await meshOf(await requestMesh(id));
    await runMesh();
    await saveMesh(id, { size: { value: 2, unit: "mm" }, order: 1 });
    const fine = await meshOf(await requestMesh(id));
    expect(fine.id).not.toBe(coarse.id);
    await runMesh();

    await saveMesh(id, { size: { value: 4, unit: "mm" }, order: 2 });
    const back = await requestMesh(id);
    expect(back.status).toBe(200);
    expect((await meshOf(back)).id).toBe(coarse.id);
    expect((await currentMesh(id))?.id).toBe(coarse.id);
    expect(await count("jobs")).toBe(2);
  });

  it("counts local sizes and a size typed in another unit as other settings", async () => {
    const id = await simulation({ value: 4, unit: "mm" });
    const plain = await meshOf(await requestMesh(id));
    await runMesh();
    await saveMesh(id, { size: { value: 0.4, unit: "cm" } });
    const cm = await meshOf(await requestMesh(id));
    expect(cm.id).not.toBe(plain.id);
    await runMesh();
    await saveMesh(id, {
      size: { value: 4, unit: "mm" },
      local: [{ id: "hole", name: "Hole", scope: "faces", tags: [2], size: { value: 1, unit: "mm" } }],
    });
    const local = await requestMesh(id);
    expect(local.status).toBe(201);
    expect((await meshOf(local)).id).not.toBe(plain.id);
  });

  it("shares a mesh between simulations of the same geometry, even while it is being made", async () => {
    const first = await simulation({ value: 4, unit: "mm" });
    const geometryId = await geometryOf(first);
    const second = await simulation({ value: 4, unit: "mm" }, {}, geometryId);
    const made = await meshOf(await requestMesh(first));
    const shared = await requestMesh(second);
    expect(shared.status).toBe(200);
    expect(await meshOf(shared)).toMatchObject({ id: made.id, status: "meshing" });
    await runMesh();
    expect(await currentMesh(second)).toMatchObject({ id: made.id, status: "ready" });
    expect(await count("jobs")).toBe(1);

    // Another geometry with the same settings is another mesh.
    const other = await simulation({ value: 4, unit: "mm" });
    expect((await requestMesh(other)).status).toBe(201);
  });

  it("does not reuse a failed mesh, so asking again retries it", async () => {
    const id = await simulation();
    const failed = await meshOf(await requestMesh(id));
    const job = await claim();
    await complete(job.id, { status: "failed", failureCategory: "platform_fault", failureCause: "crashed" });
    const retry = await requestMesh(id);
    expect(retry.status).toBe(201);
    expect((await meshOf(retry)).id).not.toBe(failed.id);
  });

  it("never finds another user's mesh", async () => {
    const id = await simulation();
    await requestMesh(id);
    const hash = await env.DB.prepare("SELECT settings_hash AS h FROM meshes").first<{ h: string }>();
    expect(hash?.h).toMatch(/^[0-9a-f]{64}$/);
    const bobRow = await env.DB.prepare("SELECT id FROM users WHERE login = 'bob'").first<{ id: string }>();
    expect(await findReusableMesh(env.DB, bobRow?.id ?? "", hash?.h ?? "")).toBeNull();
    expect(await findReusableMesh(env.DB, aliceId, hash?.h ?? "")).not.toBeNull();
  });
});

describe("reading a mesh", () => {
  it("answers another user's mesh like a missing one", async () => {
    const id = await simulation();
    const mesh = await meshOf(await requestMesh(id));
    await runMesh();
    expect((await call("GET", `/api/meshes/${mesh.id}`, { cookie: alice })).status).toBe(200);
    expect((await call("GET", `/api/meshes/${mesh.id}`, { cookie: bob })).status).toBe(404);
    expect((await call("GET", `/api/meshes/${mesh.id}/display`, { cookie: bob })).status).toBe(404);
  });
});
