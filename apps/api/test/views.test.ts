// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  type SimulationSpec,
  type ViewSettings,
  validateViewListResponse,
  validateViewResponse,
} from "@clearfea/spec";
import fixture from "@clearfea/spec/fixtures/simulation-v1.json";
import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { userProject } from "../src/db/projects";

function call(method: string, path: string, options: { json?: unknown; cookie?: string } = {}): Promise<Response> {
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

let alice = "";
let bob = "";
let aliceId = "";

beforeAll(async () => {
  const statements = env.TEST_SEED.flatMap((file) => file.queries);
  await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
  alice = await signIn("alice", "alice-local");
  bob = await signIn("bob", "bob-local");
  const users = await env.DB.prepare("SELECT id, login FROM users").all<{ id: string; login: string }>();
  aliceId = users.results.find((u) => u.login === "alice")?.id ?? "";
});

let simulationId = "";

/** A simulation of Alice's on a geometry of two bodies, 1 and 2. */
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM views"),
    env.DB.prepare("DELETE FROM simulations"),
    env.DB.prepare("DELETE FROM geometries"),
  ]);
  const geometryId = crypto.randomUUID();
  simulationId = crypto.randomUUID();
  const spec: SimulationSpec = {
    ...(JSON.parse(JSON.stringify(fixture)) as SimulationSpec),
    geometryId,
    bodies: [
      { tag: 1, material: null },
      { tag: 2, material: null },
    ],
  };
  const { id: projectId } = await userProject(env.DB, aliceId);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO geometries (id, owner_id, project_id, name, size_bytes, status, detected_unit, reading_factor,
         confirmed_unit, scaling, body_count, face_count)
       VALUES (?, ?, ?, 'pair.step', 100, 'ready', 'mm', 0.001, 'mm', 1, 2, 12)`,
    ).bind(geometryId, aliceId, projectId),
    env.DB.prepare(
      `INSERT INTO simulations (id, owner_id, geometry_id, project_id, name, analysis_type, spec_version, spec)
       VALUES (?, ?, ?, ?, 'Pair', 'linear_static', 1, ?)`,
    ).bind(simulationId, aliceId, geometryId, projectId, JSON.stringify(spec)),
  ]);
});

const settings: ViewSettings = {
  camera: { position: [0.3, 0.2, 0.4], target: [0.05, 0.025, 0.01] },
  hiddenBodies: [2],
  result: { quantity: "principal1", deformation: "true", extremes: false, cut: { axis: 1, at: 0.25, flipped: true } },
};

const save = (body: unknown, cookie = alice, id = simulationId) =>
  call("POST", `/api/simulations/${id}/views`, { json: body, cookie });

async function list(cookie = alice) {
  const response = await call("GET", `/api/simulations/${simulationId}/views`, { cookie });
  expect(response.status).toBe(200);
  const checked = validateViewListResponse(await response.json());
  if (!checked.ok) throw new Error(checked.errors.join(" "));
  return checked.value.views;
}

async function saved(response: Response) {
  const checked = validateViewResponse(await response.json());
  if (!checked.ok) throw new Error(checked.errors.join(" "));
  return checked.value.view;
}

describe("saved views", () => {
  it("need a signed-in user", async () => {
    expect((await call("GET", `/api/simulations/${simulationId}/views`)).status).toBe(401);
    expect((await call("POST", `/api/simulations/${simulationId}/views`, { json: { name: "a", settings } })).status).toBe(401);
    expect((await call("DELETE", `/api/simulations/${simulationId}/views/x`)).status).toBe(401);
  });

  it("are kept as sent and listed by name", async () => {
    expect(await list()).toEqual([]);
    const response = await save({ name: "Underside", settings });
    expect(response.status).toBe(201);
    const view = await saved(response);
    expect(view).toMatchObject({ name: "Underside", settings });
    const second = await save({ name: "  front  ", settings: { ...settings, hiddenBodies: [], result: null } });
    expect(second.status).toBe(201);
    expect((await list()).map((v) => v.name)).toEqual(["front", "Underside"]);
  });

  it("replace the view of the same name, which keeps its id", async () => {
    const first = await saved(await save({ name: "Iso", settings }));
    const moved = { ...settings, hiddenBodies: [1] };
    const response = await save({ name: "Iso", settings: moved });
    expect(response.status).toBe(200);
    expect(await saved(response)).toMatchObject({ id: first.id, settings: moved });
    expect(await list()).toHaveLength(1);
  });

  it("refuse hiding a body the geometry does not have, or every body", async () => {
    const unknown = await save({ name: "x", settings: { ...settings, hiddenBodies: [3] } });
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { error: string }).error).toContain("no body 3");
    const all = await save({ name: "x", settings: { ...settings, hiddenBodies: [1, 2] } });
    expect(all.status).toBe(400);
    expect(((await all.json()) as { error: string }).error).toContain("Show at least one body");
  });

  it("refuse malformed settings", async () => {
    for (const body of [
      { name: "", settings },
      { name: "   ", settings },
      { name: "x", settings: { ...settings, camera: { ...settings.camera, target: [0, 1] } } },
      { name: "x", settings: { ...settings, result: { ...settings.result, quantity: "pressure" } } },
      { name: "x", settings: { ...settings, result: { ...settings.result, cut: { axis: 3, at: 0.5, flipped: false } } } },
    ]) {
      expect((await save(body)).status).toBe(400);
    }
  });

  it("are deleted one at a time", async () => {
    const view = await saved(await save({ name: "Iso", settings }));
    expect((await call("DELETE", `/api/simulations/${simulationId}/views/${view.id}`, { cookie: alice })).status).toBe(204);
    expect(await list()).toEqual([]);
    expect((await call("DELETE", `/api/simulations/${simulationId}/views/${view.id}`, { cookie: alice })).status).toBe(404);
  });

  it("belong to the simulation's owner only", async () => {
    const view = await saved(await save({ name: "Iso", settings }));
    expect((await call("GET", `/api/simulations/${simulationId}/views`, { cookie: bob })).status).toBe(404);
    expect((await save({ name: "Bob's", settings }, bob)).status).toBe(404);
    expect((await call("DELETE", `/api/simulations/${simulationId}/views/${view.id}`, { cookie: bob })).status).toBe(404);
    expect(await list()).toHaveLength(1);
    expect((await save({ name: "x", settings }, alice, "no-such-simulation")).status).toBe(404);
  });
});
