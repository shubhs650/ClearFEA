// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  type SimulationSpec,
  type SimulationView,
  type Topology,
  type TopologyFace,
  validateGeometryResponse,
  validateSimulationListResponse,
  validateSimulationResponse,
} from "@clearfea/spec";
import fixture from "@clearfea/spec/fixtures/simulation-v1.json";
import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";


/** The first item of a list, which the fixture always has. */
function first<T>(items: T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error("The fixture has no such item.");
  return item;
}

function call(
  method: string,
  path: string,
  options: { json?: unknown; cookie?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.json !== undefined) headers["Content-Type"] = "application/json";
  if (options.cookie) headers.Cookie = options.cookie;
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

const face = (tag: number): TopologyFace => ({
  tag,
  type: "plane",
  gmshType: "Plane",
  area: 0.001,
  centroid: [0, 0, 0],
  bbox: [0, 0, 0, 0.1, 0.05, 0.02],
  bodies: [1],
});

const TOPOLOGY: Topology = {
  version: 1,
  size: 0.113,
  bbox: [0, 0, 0, 0.1, 0.05, 0.02],
  unit: { declared: "SI_UNIT(.MILLI.,.METRE.)", detectedUnit: "mm", problem: null, readingFactor: 0.001 },
  scaling: 1,
  software: { gmsh: "4.15.2", occt: "7.8.1" },
  bodies: [{ tag: 1, volume: 1e-4, faces: [1, 2, 3] }],
  faces: [face(1), face(2), face(3)],
};

let alice = "";
let bob = "";
let aliceId = "";
let bobId = "";

beforeAll(async () => {
  const statements = env.TEST_SEED.flatMap((file) => file.queries);
  await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
  alice = await signIn("alice", "alice-local");
  bob = await signIn("bob", "bob-local");
  const users = await env.DB.prepare("SELECT id, login FROM users").all<{ id: string; login: string }>();
  aliceId = users.results.find((u) => u.login === "alice")?.id ?? "";
  bobId = users.results.find((u) => u.login === "bob")?.id ?? "";
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM simulations"),
    env.DB.prepare("DELETE FROM geometries"),
    env.DB.prepare("DELETE FROM jobs"),
  ]);
});

/** A geometry as a finished import leaves it, with its topology.json stored. */
async function geometryRow(
  ownerId: string,
  status = "ready",
  topology: Topology | null = TOPOLOGY,
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO geometries (id, owner_id, name, size_bytes, status, detected_unit, reading_factor,
       confirmed_unit, scaling, body_count, face_count)
     VALUES (?, ?, 'bracket.step', 100, ?, 'mm', 0.001, ?, 1, 1, 3)`,
  )
    .bind(id, ownerId, status, status === "ready" ? "mm" : null)
    .run();
  if (topology !== null) {
    await env.FILES.put(`owners/${ownerId}/geometries/${id}/topology.json`, JSON.stringify(topology));
  }
  return id;
}

function specFor(geometryId: string): SimulationSpec {
  return { ...(JSON.parse(JSON.stringify(fixture)) as SimulationSpec), geometryId };
}

async function create(body: unknown, cookie = alice): Promise<Response> {
  return call("POST", "/api/simulations", { json: body, cookie });
}

async function created(body: unknown, cookie = alice): Promise<SimulationView> {
  const response = await create(body, cookie);
  expect(response.status).toBe(201);
  const checked = validateSimulationResponse(await response.json());
  if (!checked.ok) throw new Error(checked.errors.join(" "));
  return checked.value.simulation;
}

async function errorOf(response: Response): Promise<string> {
  return (await response.json<{ error: string }>()).error;
}

describe("creating a simulation", () => {
  it("needs a signed-in user", async () => {
    expect((await create({ geometryId: "g", name: "Static" }, "")).status).toBe(401);
  });

  it("starts empty, with every body of the geometry listed", async () => {
    const geometryId = await geometryRow(aliceId);
    const simulation = await created({ geometryId, name: "Static 1" });
    expect(simulation).toMatchObject({ name: "Static 1", geometryId });
    expect(simulation.spec).toEqual({
      version: 1,
      analysis: "linear_static",
      geometryId,
      bodies: [{ tag: 1, material: null }],
      materials: [],
      supports: [],
      loads: [],
      mesh: { size: null },
    });
  });

  it("accepts a complete spec, stored exactly as typed", async () => {
    const geometryId = await geometryRow(aliceId);
    const simulation = await created({ geometryId, name: "Static 1", spec: specFor(geometryId) });
    expect(simulation.spec).toEqual(specFor(geometryId));
    const row = await env.DB.prepare("SELECT analysis_type, spec_version FROM simulations").first();
    expect(row).toEqual({ analysis_type: "linear_static", spec_version: 1 });
  });

  it("needs a geometry whose unit is confirmed", async () => {
    const geometryId = await geometryRow(aliceId, "unconfirmed");
    const response = await create({ geometryId, name: "Static 1" });
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatch(/Confirm the geometry's length unit/);
  });

  it("refuses a spec for another geometry, or one that does not fit the geometry", async () => {
    const geometryId = await geometryRow(aliceId);
    const other = await create({ geometryId, name: "S", spec: specFor("another") });
    expect(other.status).toBe(400);
    const spec = specFor(geometryId);
    spec.loads[0] = { ...first(spec.loads), faces: [42] };
    const unknownFace = await create({ geometryId, name: "S", spec });
    expect(unknownFace.status).toBe(400);
    expect(await errorOf(unknownFace)).toMatch(/uses face 42, which the geometry does not have/);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM simulations").first<{ n: number }>())?.n).toBe(0);
  });

  it("says so when the topology cannot be read", async () => {
    const geometryId = await geometryRow(aliceId, "ready", null);
    const response = await create({ geometryId, name: "S" });
    expect(response.status).toBe(500);
    expect(await errorOf(response)).toMatch(/Upload the file again/);
  });
});

describe("saving the spec", () => {
  async function save(id: string, spec: unknown, cookie = alice): Promise<Response> {
    return call("PUT", `/api/simulations/${id}/spec`, { json: spec, cookie });
  }

  it("replaces the spec and keeps the simulation on its geometry", async () => {
    const geometryId = await geometryRow(aliceId);
    const simulation = await created({ geometryId, name: "Static 1" });
    const response = await save(simulation.id, specFor(geometryId));
    expect(response.status).toBe(200);
    const fetched = validateSimulationResponse(
      await (await call("GET", `/api/simulations/${simulation.id}`, { cookie: alice })).json(),
    );
    expect(fetched.ok && fetched.value.simulation.spec).toEqual(specFor(geometryId));

    const moved = await save(simulation.id, specFor(await geometryRow(aliceId)));
    expect(moved.status).toBe(400);
    expect(await errorOf(moved)).toMatch(/stays on the geometry it was created on/);
  });

  it("refuses a malformed spec or a unit of the wrong kind", async () => {
    const geometryId = await geometryRow(aliceId);
    const simulation = await created({ geometryId, name: "Static 1" });
    const malformed = await save(simulation.id, { ...specFor(geometryId), version: 2 });
    expect(malformed.status).toBe(400);
    expect(await errorOf(malformed)).toMatch(/not a valid SimulationSpec/);
    const spec = specFor(geometryId);
    spec.mesh.size = { value: 5, unit: "bar" };
    const wrongKind = await save(simulation.id, spec);
    expect(wrongKind.status).toBe(400);
    expect(await errorOf(wrongKind)).toMatch(/"bar", which is not a length unit/);
  });
});

describe("the geometry's unit", () => {
  async function setUnit(id: string, unit: string): Promise<Response> {
    return call("POST", `/api/geometries/${id}/unit`, { json: { unit }, cookie: alice });
  }

  it("is locked once a simulation uses the geometry", async () => {
    const geometryId = await geometryRow(aliceId);
    const before = validateGeometryResponse(
      await (await call("GET", `/api/geometries/${geometryId}`, { cookie: alice })).json(),
    );
    expect(before.ok && before.value.geometry.unitLocked).toBe(false);
    await created({ geometryId, name: "Static 1" });

    const changed = await setUnit(geometryId, "in");
    expect(changed.status).toBe(409);
    expect(await errorOf(changed)).toMatch(/used by a simulation, so its unit stays mm/);
    const same = await setUnit(geometryId, "mm");
    expect(same.status).toBe(200);
    const after = validateGeometryResponse(await same.json());
    expect(after.ok && after.value.geometry).toMatchObject({ unitLocked: true, confirmedUnit: "mm" });
    const jobs = await env.DB.prepare("SELECT COUNT(*) AS n FROM jobs").first<{ n: number }>();
    expect(jobs?.n).toBe(0);
  });

  it("refuses to delete a geometry a simulation uses", async () => {
    const geometryId = await geometryRow(aliceId);
    await created({ geometryId, name: "Static 1" });
    await expect(
      env.DB.prepare("DELETE FROM geometries WHERE id = ?").bind(geometryId).run(),
    ).rejects.toThrow(/FOREIGN KEY/);
  });
});

describe("simulation isolation", () => {
  it("does not show one user's simulation to another", async () => {
    const geometryId = await geometryRow(aliceId);
    const simulation = await created({ geometryId, name: "Static 1" });
    expect((await call("GET", `/api/simulations/${simulation.id}`, { cookie: bob })).status).toBe(404);
    const put = await call("PUT", `/api/simulations/${simulation.id}/spec`, {
      json: specFor(geometryId),
      cookie: bob,
    });
    expect(put.status).toBe(404);
    const list = validateSimulationListResponse(
      await (await call("GET", "/api/simulations", { cookie: bob })).json(),
    );
    expect(list.ok && list.value.simulations).toEqual([]);
  });

  it("does not let a user build on another user's geometry", async () => {
    const geometryId = await geometryRow(bobId);
    const response = await create({ geometryId, name: "Static 1" });
    expect(response.status).toBe(404);
  });

  it("lists the user's simulations, optionally for one geometry", async () => {
    const first = await geometryRow(aliceId);
    const second = await geometryRow(aliceId);
    await created({ geometryId: first, name: "A" });
    await created({ geometryId: second, name: "B" });
    const all = validateSimulationListResponse(
      await (await call("GET", "/api/simulations", { cookie: alice })).json(),
    );
    expect(all.ok && all.value.simulations.map((s) => s.name).sort()).toEqual(["A", "B"]);
    const one = validateSimulationListResponse(
      await (await call("GET", `/api/simulations?geometryId=${first}`, { cookie: alice })).json(),
    );
    expect(one.ok && one.value.simulations.map((s) => s.name)).toEqual(["A"]);
  });
});
