// SPDX-License-Identifier: AGPL-3.0-or-later
// A run's report figures, captured in the browser (M7.2, ADR-011).
import {
  type ReportFigure,
  type SimulationSpec,
  type ViewSettings,
  validateReportFigureListResponse,
  validateReportFigureResponse,
  validateViewResponse,
} from "@clearfea/spec";
import fixture from "@clearfea/spec/fixtures/simulation-v1.json";
import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { userProject } from "../src/db/projects";

function call(
  method: string,
  path: string,
  options: { json?: unknown; bytes?: Uint8Array; type?: string; cookie?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.json !== undefined) headers["Content-Type"] = "application/json";
  if (options.bytes !== undefined) headers["Content-Type"] = options.type ?? "application/octet-stream";
  if (options.cookie) headers.Cookie = options.cookie;
  return exports.default.fetch(`http://localhost${path}`, {
    method,
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : options.bytes,
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
  const row = await env.DB.prepare("SELECT id FROM users WHERE login = 'alice'").first<{ id: string }>();
  aliceId = row?.id ?? "";
});

let simulationId = "";
let runId = "";

/** Alice's run of the fixture's setup, in the given state, with its job and mesh. */
async function runRow(status: "succeeded" | "solving"): Promise<string> {
  const id = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const meshId = crypto.randomUUID();
  const geometryId = (await env.DB.prepare("SELECT geometry_id FROM simulations WHERE id = ?").bind(simulationId).first<{
    geometry_id: string;
  }>())?.geometry_id;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO jobs (id, owner_id, type, target_id, status) VALUES (?, ?, 'solve', ?, ?)`,
    ).bind(jobId, aliceId, id, status === "succeeded" ? "succeeded" : "running"),
    env.DB.prepare(
      `INSERT INTO meshes (id, owner_id, geometry_id, size, element_order, status, node_count, element_count)
       VALUES (?, ?, ?, '{"value":5,"unit":"mm"}', 2, 'ready', 100, 40)`,
    ).bind(meshId, aliceId, geometryId),
    env.DB.prepare(
      `INSERT INTO runs (id, owner_id, simulation_id, mesh_id, spec, status, job_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, aliceId, simulationId, meshId, JSON.stringify({ ...fixture, geometryId }), status, jobId),
  ]);
  return id;
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM report_figures"),
    env.DB.prepare("DELETE FROM views"),
    env.DB.prepare("DELETE FROM runs"),
    env.DB.prepare("DELETE FROM meshes"),
    env.DB.prepare("DELETE FROM jobs"),
    env.DB.prepare("DELETE FROM simulations"),
    env.DB.prepare("DELETE FROM geometries"),
  ]);
  const geometryId = crypto.randomUUID();
  simulationId = crypto.randomUUID();
  const spec: SimulationSpec = { ...(JSON.parse(JSON.stringify(fixture)) as SimulationSpec), geometryId };
  const { id: projectId } = await userProject(env.DB, aliceId);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO geometries (id, owner_id, project_id, name, size_bytes, status, detected_unit, reading_factor,
         confirmed_unit, scaling, body_count, face_count)
       VALUES (?, ?, ?, 'block.step', 100, 'ready', 'mm', 0.001, 'mm', 1, 1, 6)`,
    ).bind(geometryId, aliceId, projectId),
    env.DB.prepare(
      `INSERT INTO simulations (id, owner_id, geometry_id, project_id, name, analysis_type, spec_version, spec)
       VALUES (?, ?, ?, ?, 'Bracket', 'linear_static', 1, ?)`,
    ).bind(simulationId, aliceId, geometryId, projectId, JSON.stringify(spec)),
  ]);
  runId = await runRow("succeeded");
});

/** A PNG of the given size: signature and IHDR are all the API reads. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

const figurePath = (kind: string, item: string, caption = "A figure", position = 0) =>
  `/api/runs/${runId}/figures/${kind}/${item}?caption=${encodeURIComponent(caption)}&position=${position}`;

async function figure(response: Response): Promise<ReportFigure> {
  const checked = validateReportFigureResponse(await response.json());
  if (!checked.ok) throw new Error(checked.errors.join(" "));
  return checked.value.figure;
}

async function list(cookie = alice): Promise<ReportFigure[]> {
  const response = await call("GET", `/api/runs/${runId}/figures`, { cookie });
  expect(response.status).toBe(200);
  const checked = validateReportFigureListResponse(await response.json());
  if (!checked.ok) throw new Error(checked.errors.join(" "));
  return checked.value.figures;
}

const viewSettings: ViewSettings = { camera: { position: [0.3, 0.2, 0.4], target: [0, 0, 0] }, hiddenBodies: [], result: null };

describe("report figures", () => {
  it("are stored per run with their caption, order and pixel size, and served back", async () => {
    expect(await list()).toEqual([]);
    const saved = await figure(
      await call("PUT", figurePath("load", "pressure-1", 'Load "Pressure 1": Pressure', 1), { bytes: png(1600, 1000), cookie: alice }),
    );
    expect(saved).toMatchObject({ kind: "load", item: "pressure-1", caption: 'Load "Pressure 1": Pressure', position: 1, width: 1600, height: 1000, sizeBytes: 33 });
    await call("PUT", figurePath("support", "fixed-1", "Support", 0), { bytes: png(800, 500), cookie: alice });
    expect((await list()).map((f) => `${f.kind}/${f.item}`)).toEqual(["support/fixed-1", "load/pressure-1"]);
    const image = await call("GET", `/api/runs/${runId}/figures/support/fixed-1`, { cookie: alice });
    expect(image.status).toBe(200);
    expect(image.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(png(800, 500));
  });

  it("replace a figure of the same item and are all removed by a DELETE", async () => {
    await call("PUT", figurePath("support", "fixed-1", "First"), { bytes: png(10, 10), cookie: alice });
    await call("PUT", figurePath("support", "fixed-1", "Second"), { bytes: png(20, 10), cookie: alice });
    expect((await list()).map((f) => [f.caption, f.width])).toEqual([["Second", 20]]);
    const cleared = await call("DELETE", `/api/runs/${runId}/figures`, { cookie: alice });
    expect(cleared.status).toBe(200);
    expect(await list()).toEqual([]);
    expect(await env.FILES.get(`owners/${aliceId}/runs/${runId}/figures/support-fixed-1.png`)).toBeNull();
    expect((await call("GET", `/api/runs/${runId}/figures/support/fixed-1`, { cookie: alice })).status).toBe(404);
  });

  it("take a saved view of the run's simulation", async () => {
    const response = await call("POST", `/api/simulations/${simulationId}/views`, {
      json: { name: "Front", settings: viewSettings },
      cookie: alice,
    });
    const view = validateViewResponse(await response.json());
    if (!view.ok) throw new Error(view.errors.join(" "));
    const saved = await call("PUT", figurePath("view", view.value.view.id, 'View "Front"'), { bytes: png(16, 10), cookie: alice });
    expect(saved.status).toBe(200);
    expect((await list()).map((f) => f.kind)).toEqual(["view"]);
  });

  it("refuse items the run does not have", async () => {
    for (const [kind, item] of [
      ["support", "pressure-1"],
      ["load", "missing"],
      ["view", "missing"],
    ] as const) {
      const response = await call("PUT", figurePath(kind, item), { bytes: png(10, 10), cookie: alice });
      expect(response.status).toBe(404);
    }
    expect((await call("PUT", figurePath("mesh", "fixed-1"), { bytes: png(10, 10), cookie: alice })).status).toBe(404);
    expect(await list()).toEqual([]);
  });

  it("refuse anything but a PNG of sensible size, and bad captions or positions", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0, 10, 0, 10, 3]);
    expect((await call("PUT", figurePath("support", "fixed-1"), { bytes: jpeg, cookie: alice })).status).toBe(400);
    expect((await call("PUT", figurePath("support", "fixed-1"), { bytes: png(5000, 10), cookie: alice })).status).toBe(400);
    expect(
      (await call("PUT", figurePath("support", "fixed-1"), { bytes: png(10, 10), type: "image/png", cookie: alice })).status,
    ).toBe(415);
    expect((await call("PUT", figurePath("support", "fixed-1", "x".repeat(201)), { bytes: png(10, 10), cookie: alice })).status).toBe(
      400,
    );
    const noPosition = `/api/runs/${runId}/figures/support/fixed-1?caption=x&position=-1`;
    expect((await call("PUT", noPosition, { bytes: png(10, 10), cookie: alice })).status).toBe(400);
    expect(await list()).toEqual([]);
  });

  it("are refused for a run that has not succeeded", async () => {
    runId = await runRow("solving");
    const response = await call("PUT", figurePath("support", "fixed-1"), { bytes: png(10, 10), cookie: alice });
    expect(response.status).toBe(409);
  });

  it("belong to the run's owner only", async () => {
    await call("PUT", figurePath("support", "fixed-1"), { bytes: png(10, 10), cookie: alice });
    expect((await call("GET", `/api/runs/${runId}/figures`, { cookie: bob })).status).toBe(404);
    expect((await call("GET", `/api/runs/${runId}/figures/support/fixed-1`, { cookie: bob })).status).toBe(404);
    expect((await call("PUT", figurePath("support", "fixed-1"), { bytes: png(10, 10), cookie: bob })).status).toBe(404);
    expect((await call("DELETE", `/api/runs/${runId}/figures`, { cookie: bob })).status).toBe(404);
    expect((await call("GET", `/api/runs/${runId}/figures`)).status).toBe(401);
    expect(await list()).toHaveLength(1);
  });
});
