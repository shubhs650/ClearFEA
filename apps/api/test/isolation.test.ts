// SPDX-License-Identifier: AGPL-3.0-or-later
// Data isolation across every route and file key (M8.8, DECISIONS "Data isolation between test
// users is proven by automated tests"). Alice owns one of everything; bob, signed in, calls every
// route of the app with her ids. Each call must answer exactly as it does for an id nobody owns,
// must not show any of her data, and must leave her database rows and stored files unchanged.
// Every route the app serves has to be listed below, so a new route fails this file until it is
// added to the sweep.
import {
  defaultReportOptions,
  type SimulationSpec,
  type Topology,
  type TopologyFace,
  validateCreatedShareLinkResponse,
} from "@clearfea/spec";
import fixture from "@clearfea/spec/fixtures/simulation-v1.json";
import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { getJob } from "../src/db/jobs";
import { userProject } from "../src/db/projects";
import { reportKey } from "../src/db/reports";
import { app } from "../src/index";
import { jobFiles } from "../src/jobs/files";

interface Request {
  path: string;
  json?: unknown;
  bytes?: Uint8Array;
  type?: string;
}

function call(method: string, request: Request, cookie?: string, headers: Record<string, string> = {}): Promise<Response> {
  const all: Record<string, string> = { ...headers };
  if (request.json !== undefined) all["Content-Type"] = "application/json";
  if (request.bytes !== undefined) all["Content-Type"] = request.type ?? "application/octet-stream";
  if (cookie) all.Cookie = cookie;
  return exports.default.fetch(`http://localhost${request.path}`, {
    method,
    headers: all,
    body: request.json !== undefined ? JSON.stringify(request.json) : request.bytes,
  });
}

/** The body as text, whatever its type, for searching. */
async function textOf(response: Response): Promise<string> {
  return new TextDecoder().decode(await response.arrayBuffer());
}

async function signIn(login: string, password: string): Promise<string> {
  const response = await call("POST", { path: "/api/session", json: { login, password } });
  expect(response.status).toBe(200);
  return (response.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
}

/** A PNG of the given size: signature and IHDR are all the API reads. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
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

const RESULT = { nodes: 100, software: { calculix: "2.21" } };
const RUN_FILES = ["deck.inp", "solver.log", "results.frd", "results.dat", "surface.bin", "fields.bin", "nodes.bin"];

/** One user's records: a geometry, a simulation on it, its mesh, a solved run and a solving run. */
interface Owned {
  geometryId: string;
  simulationId: string;
  meshId: string;
  runId: string;
  solvingRunId: string;
  jobIds: string[];
  spec: SimulationSpec;
}

/**
 * Writes a user's records straight into the database and storage, as finished imports, meshes
 * and solves leave them. `marker` goes into every name so a leak of them can be searched for.
 */
async function ownedRecords(ownerId: string, marker: string): Promise<Owned> {
  const ids = {
    geometryId: crypto.randomUUID(),
    simulationId: crypto.randomUUID(),
    meshId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    solvingRunId: crypto.randomUUID(),
  };
  const importJob = crypto.randomUUID();
  const meshJob = crypto.randomUUID();
  const solveJob = crypto.randomUUID();
  const solvingJob = crypto.randomUUID();
  const spec: SimulationSpec = { ...(JSON.parse(JSON.stringify(fixture)) as SimulationSpec), geometryId: ids.geometryId };
  const runSpec = JSON.stringify(spec);
  const prefix = `owners/${ownerId}`;
  const { id: projectId } = await userProject(env.DB, ownerId);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO jobs (id, owner_id, type, target_id, status, params) VALUES
         (?, ?, 'import', ?, 'succeeded', NULL),
         (?, ?, 'mesh', ?, 'succeeded', ?),
         (?, ?, 'solve', ?, 'succeeded', ?),
         (?, ?, 'solve', ?, 'running', ?)`,
    ).bind(
      importJob,
      ownerId,
      ids.geometryId,
      meshJob,
      ownerId,
      ids.meshId,
      JSON.stringify({ geometryId: ids.geometryId }),
      solveJob,
      ownerId,
      ids.runId,
      JSON.stringify({ meshId: ids.meshId }),
      solvingJob,
      ownerId,
      ids.solvingRunId,
      JSON.stringify({ meshId: ids.meshId }),
    ),
    env.DB.prepare(`INSERT INTO job_logs (job_id, seq, text) VALUES (?, 0, ?)`).bind(solveJob, `${marker} solver log`),
    env.DB.prepare(
      `INSERT INTO geometries (id, owner_id, project_id, name, size_bytes, status, detected_unit, reading_factor,
         confirmed_unit, scaling, body_count, face_count, import_job_id)
       VALUES (?, ?, ?, ?, 100, 'ready', 'mm', 0.001, 'mm', 1, 1, 3, ?)`,
    ).bind(ids.geometryId, ownerId, projectId, `${marker}-bracket.step`, importJob),
    env.DB.prepare(
      `INSERT INTO meshes (id, owner_id, geometry_id, size, element_order, status, node_count, element_count, job_id)
       VALUES (?, ?, ?, '{"value":5,"unit":"mm"}', 2, 'ready', 100, 40, ?)`,
    ).bind(ids.meshId, ownerId, ids.geometryId, meshJob),
    env.DB.prepare(
      `INSERT INTO simulations (id, owner_id, geometry_id, project_id, name, analysis_type, spec_version, spec, mesh_id)
       VALUES (?, ?, ?, ?, ?, 'linear_static', 1, ?, ?)`,
    ).bind(ids.simulationId, ownerId, ids.geometryId, projectId, `${marker} simulation`, runSpec, ids.meshId),
    env.DB.prepare(
      `INSERT INTO runs (id, owner_id, simulation_id, mesh_id, spec, status, job_id, files, result, finished_at)
       VALUES (?, ?, ?, ?, ?, 'succeeded', ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    ).bind(ids.runId, ownerId, ids.simulationId, ids.meshId, runSpec, solveJob, JSON.stringify(RUN_FILES), JSON.stringify(RESULT)),
    env.DB.prepare(
      `INSERT INTO runs (id, owner_id, simulation_id, mesh_id, spec, status, job_id)
       VALUES (?, ?, ?, ?, ?, 'solving', ?)`,
    ).bind(ids.solvingRunId, ownerId, ids.simulationId, ids.meshId, runSpec, solvingJob),
  ]);
  await env.FILES.put(`${prefix}/geometries/${ids.geometryId}/model.step`, `ISO-10303-21; ${marker}`);
  await env.FILES.put(`${prefix}/geometries/${ids.geometryId}/topology.json`, JSON.stringify(TOPOLOGY));
  await env.FILES.put(`${prefix}/geometries/${ids.geometryId}/display.bin`, `${marker} display`);
  await env.FILES.put(`${prefix}/meshes/${ids.meshId}/mesh.bin`, `${marker} mesh`);
  await env.FILES.put(`${prefix}/meshes/${ids.meshId}/display.bin`, `${marker} mesh display`);
  for (const name of RUN_FILES) await env.FILES.put(`${prefix}/runs/${ids.runId}/${name}`, `${marker} ${name}`);
  return { ...ids, jobIds: [importJob, meshJob, solveJob, solvingJob], spec };
}

const ALICE_MARKER = "alice-private-7f3c";

let alice = "";
let bob = "";
let aliceId = "";
let bobId = "";
let mine: Owned;
let bobs: Owned;
/** Ids of alice's records that only the API's answers to her could hold. */
const extra = { noopJobId: "", materialId: "", viewId: "", reportJobId: "", shareToken: "" };

beforeAll(async () => {
  const statements = env.TEST_SEED.flatMap((file) => file.queries);
  await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
  alice = await signIn("alice", "alice-local");
  bob = await signIn("bob", "bob-local");
  const users = await env.DB.prepare("SELECT id, login FROM users").all<{ id: string; login: string }>();
  aliceId = users.results.find((u) => u.login === "alice")?.id ?? "";
  bobId = users.results.find((u) => u.login === "bob")?.id ?? "";
  mine = await ownedRecords(aliceId, ALICE_MARKER);
  bobs = await ownedRecords(bobId, "bob-own");

  // The rest of alice's records through the API, as the app makes them.
  const ok = async (method: string, request: Request, status = 200) => {
    const response = await call(method, request, alice);
    expect(response.status, `${method} ${request.path}: ${await textOf(response.clone())}`).toBe(status);
    return (await response.json()) as Record<string, Record<string, unknown>>;
  };
  extra.noopJobId = (await ok("POST", { path: "/api/jobs", json: { type: "noop" } }, 201)).job?.id as string;
  extra.materialId = (
    await ok(
      "POST",
      {
        path: "/api/materials",
        json: {
          material: {
            id: "m",
            name: `${ALICE_MARKER} steel`,
            model: "isotropic_elastic",
            youngsModulus: { value: 205, unit: "GPa" },
            poissonsRatio: 0.29,
            source: `${ALICE_MARKER} certificate`,
          },
        },
      },
      201,
    )
  ).material?.id as string;
  await ok("PATCH", { path: "/api/project", json: { unitSystem: "us-in" } });
  await ok("PUT", { path: "/api/report-branding", json: { companyName: `${ALICE_MARKER} Engineering` } });
  await ok("POST", { path: "/api/report-branding/logo", bytes: png(320, 80) });
  extra.viewId = (
    await ok(
      "POST",
      {
        path: `/api/simulations/${mine.simulationId}/views`,
        json: {
          name: `${ALICE_MARKER} view`,
          settings: { camera: { position: [0.3, 0.2, 0.4], target: [0.05, 0.025, 0.01] }, hiddenBodies: [], result: null },
        },
      },
      201,
    )
  ).view?.id as string;
  const options = await ok("GET", { path: `/api/simulations/${mine.simulationId}/report-options` });
  await ok("PUT", {
    path: `/api/simulations/${mine.simulationId}/report-options`,
    json: { ...options.options, views: [extra.viewId] },
  });
  await ok("PUT", { path: `/api/runs/${mine.runId}/figures/support/fixed-1?caption=Fixed&position=0`, bytes: png(64, 48) });
  await ok("PUT", { path: `/api/runs/${mine.runId}/figures/view/${extra.viewId}?caption=View&position=1`, bytes: png(64, 48) });
  // A finished report: queued through the API so its params are real, then completed here.
  extra.reportJobId = (await ok("POST", { path: `/api/runs/${mine.runId}/report` }, 202)).report?.id as string;
  expect(extra.reportJobId).toMatch(/^[0-9a-f-]{36}$/);
  await env.DB.prepare(`UPDATE jobs SET status = 'succeeded', result = ? WHERE id = ?`)
    .bind(JSON.stringify({ sizeBytes: 20, pdfSizeBytes: 20 }), extra.reportJobId)
    .run();
  for (const format of ["docx", "pdf"] as const) {
    await env.FILES.put(reportKey(aliceId, mine.runId, extra.reportJobId, format), `${ALICE_MARKER} report`);
  }
  const shared = validateCreatedShareLinkResponse(await ok("POST", { path: `/api/runs/${mine.runId}/share` }, 201));
  if (!shared.ok) throw new Error(shared.errors.join(" "));
  extra.shareToken = shared.value.token;
  // One metered charge on alice's ledger, as a finished solve leaves it.
  await env.DB.batch([
    env.DB.prepare(`UPDATE jobs SET machine_size = 'medium', rate_per_hour = 1000000, billable_ms = 1000, billed_seconds = 1, cost = 278 WHERE id = ?`).bind(
      mine.jobIds[2],
    ),
    env.DB.prepare(
      `INSERT INTO ledger_entries (owner_id, amount, balance, reason, job_id)
       SELECT ?, -278, balance - 278, 'solve', ? FROM ledger_entries WHERE owner_id = ? ORDER BY seq DESC LIMIT 1`,
    ).bind(aliceId, mine.jobIds[2], aliceId),
  ]);
});

/** Every row of alice's in every table, and every file under her storage prefix. */
async function aliceSnapshot(): Promise<string> {
  const tables = await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite%' ORDER BY name`).all<{
    name: string;
  }>();
  const rows: Record<string, unknown[]> = {};
  for (const { name } of tables.results) {
    const columns = await env.DB.prepare(`SELECT name FROM pragma_table_info(?)`).bind(name).all<{ name: string }>();
    const names = columns.results.map((c) => c.name);
    if (names.includes("owner_id")) {
      rows[name] = (await env.DB.prepare(`SELECT * FROM "${name}" WHERE owner_id = ? ORDER BY rowid`).bind(aliceId).all()).results;
    }
  }
  rows.job_logs = (
    await env.DB.prepare(`SELECT l.* FROM job_logs l JOIN jobs j ON j.id = l.job_id WHERE j.owner_id = ? ORDER BY l.job_id, l.seq`)
      .bind(aliceId)
      .all()
  ).results;
  rows.users = (await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(aliceId).all()).results;
  const files = await env.FILES.list({ prefix: `owners/${aliceId}/` });
  const stored = files.objects.map((o) => `${o.key} ${o.size} ${o.etag}`);
  return JSON.stringify({ rows, stored });
}

/** Strings that must never reach bob: alice's ids, her names and her stored contents. */
function aliceSecrets(): string[] {
  return [
    aliceId,
    ALICE_MARKER,
    mine.geometryId,
    mine.simulationId,
    mine.meshId,
    mine.runId,
    mine.solvingRunId,
    ...mine.jobIds,
    ...Object.values(extra),
  ];
}

function expectNoSecrets(label: string, text: string): void {
  for (const secret of aliceSecrets()) expect(text.includes(secret), `${label} shows ${secret}`).toBe(false);
}

type Area = "owned" | "account" | "public" | "worker" | "admin";

interface Route {
  area: Area;
  /** For owned routes: the request with alice's ids, and the same with ids nobody owns. */
  owned?: (ids: Ids) => Request;
}

interface Ids {
  geometryId: string;
  simulationId: string;
  meshId: string;
  runId: string;
  solvingRunId: string;
  jobId: string;
  materialId: string;
  viewId: string;
}

const aliceIds = (): Ids => ({ ...mine, jobId: extra.noopJobId, materialId: extra.materialId, viewId: extra.viewId });

const nobodysIds = (): Ids => ({
  geometryId: crypto.randomUUID(),
  simulationId: crypto.randomUUID(),
  meshId: crypto.randomUUID(),
  runId: crypto.randomUUID(),
  solvingRunId: crypto.randomUUID(),
  jobId: crypto.randomUUID(),
  materialId: crypto.randomUUID(),
  viewId: crypto.randomUUID(),
});

const g = (i: Ids) => `/api/geometries/${i.geometryId}`;
const s = (i: Ids) => `/api/simulations/${i.simulationId}`;
const r = (i: Ids) => `/api/runs/${i.runId}`;

/**
 * Every route the app serves, by method and path as Hono lists them. An owned route acts on one
 * record named in its path; an account route acts on the signed-in user's own account; a public
 * route needs no sign-in (the share link's are reached by its token alone); a worker route needs
 * the worker token; an admin route answers the admin (ADMIN_EMAIL, alice in these tests) only.
 */
const ROUTES: Record<string, Route> = {
  "GET /api/health": { area: "public" },
  "POST /api/session": { area: "public" },
  "GET /api/session": { area: "public" },
  "DELETE /api/session": { area: "public" },
  "GET /api/session/options": { area: "public" },
  // Off without VERIFY_TOKEN; signs in only the verification account (ADR-104, verificationSignIn.test.ts).
  "POST /api/session/verification": { area: "public" },
  // Better Auth's routes, answered only in "google" mode (googleSignIn.test.ts).
  "GET /api/auth/*": { area: "public" },
  "POST /api/auth/*": { area: "public" },

  "GET /api/admin": { area: "admin" },
  "POST /api/admin/allowed": { area: "admin" },
  "DELETE /api/admin/allowed/:email": { area: "admin" },
  "PUT /api/admin/machine-sizes/:name": { area: "admin" },
  "PUT /api/admin/machine-hours-cap": { area: "admin" },
  "GET /api/admin/stats/jobs": { area: "admin" },
  "GET /api/admin/stats/host": { area: "admin" },
  "GET /api/admin/events": { area: "admin" },

  "POST /api/jobs": { area: "account" },
  "GET /api/jobs": { area: "account" },
  "GET /api/jobs/:id": { area: "owned", owned: (i) => ({ path: `/api/jobs/${i.jobId}` }) },

  "GET /api/project": { area: "account" },
  "PATCH /api/project": { area: "account" },

  "POST /api/geometries": { area: "account" },
  "GET /api/geometries": { area: "account" },
  "GET /api/geometries/:id": { area: "owned", owned: (i) => ({ path: g(i) }) },
  "GET /api/geometries/:id/topology": { area: "owned", owned: (i) => ({ path: `${g(i)}/topology` }) },
  "GET /api/geometries/:id/display": { area: "owned", owned: (i) => ({ path: `${g(i)}/display` }) },
  "POST /api/geometries/:id/unit": { area: "owned", owned: (i) => ({ path: `${g(i)}/unit`, json: { unit: "in" } }) },

  "POST /api/simulations": {
    area: "owned",
    // The geometry is named in the body, not the path.
    owned: (i) => ({ path: "/api/simulations", json: { name: "Taken", geometryId: i.geometryId } }),
  },
  "GET /api/simulations": { area: "account" },
  "GET /api/simulations/:id": { area: "owned", owned: (i) => ({ path: s(i) }) },
  "PUT /api/simulations/:id/spec": {
    area: "owned",
    owned: (i) => ({ path: `${s(i)}/spec`, json: { ...mine.spec, geometryId: i.geometryId } }),
  },
  "GET /api/simulations/:id/mesh": { area: "owned", owned: (i) => ({ path: `${s(i)}/mesh` }) },
  "POST /api/simulations/:id/mesh": { area: "owned", owned: (i) => ({ path: `${s(i)}/mesh` }) },
  "GET /api/simulations/:id/runs": { area: "owned", owned: (i) => ({ path: `${s(i)}/runs` }) },
  "POST /api/simulations/:id/runs": { area: "owned", owned: (i) => ({ path: `${s(i)}/runs`, json: {} }) },
  "GET /api/simulations/:id/estimate": { area: "owned", owned: (i) => ({ path: `${s(i)}/estimate` }) },
  "GET /api/simulations/:id/views": { area: "owned", owned: (i) => ({ path: `${s(i)}/views` }) },
  "POST /api/simulations/:id/views": {
    area: "owned",
    owned: (i) => ({
      path: `${s(i)}/views`,
      json: { name: "Taken", settings: { camera: { position: [1, 1, 1], target: [0, 0, 0] }, hiddenBodies: [], result: null } },
    }),
  },
  "DELETE /api/simulations/:id/views/:viewId": { area: "owned", owned: (i) => ({ path: `${s(i)}/views/${i.viewId}` }) },
  "GET /api/simulations/:id/report-options": { area: "owned", owned: (i) => ({ path: `${s(i)}/report-options` }) },
  "PUT /api/simulations/:id/report-options": {
    area: "owned",
    owned: (i) => ({
      path: `${s(i)}/report-options`,
      json: defaultReportOptions("Taken", "si"),
    }),
  },

  "GET /api/materials": { area: "account" },
  "POST /api/materials": { area: "account" },
  "DELETE /api/materials/:id": { area: "owned", owned: (i) => ({ path: `/api/materials/${i.materialId}` }) },

  "GET /api/meshes/:id": { area: "owned", owned: (i) => ({ path: `/api/meshes/${i.meshId}` }) },
  "GET /api/meshes/:id/display": { area: "owned", owned: (i) => ({ path: `/api/meshes/${i.meshId}/display` }) },

  "GET /api/runs/:id": { area: "owned", owned: (i) => ({ path: r(i) }) },
  "POST /api/runs/:id/cancel": { area: "owned", owned: (i) => ({ path: `/api/runs/${i.solvingRunId}/cancel` }) },
  "GET /api/runs/:id/log": { area: "owned", owned: (i) => ({ path: `${r(i)}/log?after=0` }) },
  "GET /api/runs/:id/surface": { area: "owned", owned: (i) => ({ path: `${r(i)}/surface` }) },
  "GET /api/runs/:id/fields": { area: "owned", owned: (i) => ({ path: `${r(i)}/fields` }) },
  "GET /api/runs/:id/mesh": { area: "owned", owned: (i) => ({ path: `${r(i)}/mesh` }) },
  "GET /api/runs/:id/nodes": { area: "owned", owned: (i) => ({ path: `${r(i)}/nodes` }) },
  "GET /api/runs/:id/files/:name": { area: "owned", owned: (i) => ({ path: `${r(i)}/files/deck.inp` }) },
  "PUT /api/runs/:id/pin": { area: "owned", owned: (i) => ({ path: `${r(i)}/pin`, json: { pinned: true } }) },
  "POST /api/runs/:id/rerun": { area: "owned", owned: (i) => ({ path: `${r(i)}/rerun` }) },
  // In an order alice's own calls at the end can all succeed in: each reads before it removes.
  "GET /api/runs/:id/figures": { area: "owned", owned: (i) => ({ path: `${r(i)}/figures` }) },
  "GET /api/runs/:id/figures/:kind/:item": { area: "owned", owned: (i) => ({ path: `${r(i)}/figures/support/fixed-1` }) },
  "DELETE /api/runs/:id/figures": { area: "owned", owned: (i) => ({ path: `${r(i)}/figures` }) },
  "PUT /api/runs/:id/figures/:kind/:item": {
    area: "owned",
    owned: (i) => ({ path: `${r(i)}/figures/load/pressure-1?caption=Taken&position=2`, bytes: png(64, 48) }),
  },
  "GET /api/runs/:id/report": { area: "owned", owned: (i) => ({ path: `${r(i)}/report` }) },
  "GET /api/runs/:id/report/:format{docx|pdf}": { area: "owned", owned: (i) => ({ path: `${r(i)}/report/pdf` }) },
  "POST /api/runs/:id/report": { area: "owned", owned: (i) => ({ path: `${r(i)}/report` }) },
  "GET /api/runs/:id/share": { area: "owned", owned: (i) => ({ path: `${r(i)}/share` }) },
  "POST /api/runs/:id/share": { area: "owned", owned: (i) => ({ path: `${r(i)}/share` }) },
  "DELETE /api/runs/:id/share": { area: "owned", owned: (i) => ({ path: `${r(i)}/share` }) },

  "GET /api/shared/:token": { area: "public" },
  "GET /api/shared/:token/topology": { area: "public" },
  "GET /api/shared/:token/surface": { area: "public" },
  "GET /api/shared/:token/fields": { area: "public" },
  "GET /api/shared/:token/mesh": { area: "public" },
  "GET /api/shared/:token/nodes": { area: "public" },

  "GET /api/report-branding": { area: "account" },
  "PUT /api/report-branding": { area: "account" },
  "POST /api/report-branding/logo": { area: "account" },
  "GET /api/report-branding/logo": { area: "account" },
  "DELETE /api/report-branding/logo": { area: "account" },

  "GET /api/wallet": { area: "account" },
  "GET /api/storage": { area: "account" },

  "POST /internal/jobs/claim": { area: "worker" },
  "GET /internal/jobs/:id/files/:name": { area: "worker" },
  "PUT /internal/jobs/:id/files/:name": { area: "worker" },
  "POST /internal/jobs/:id/heartbeat": { area: "worker" },
  "POST /internal/jobs/:id/complete": { area: "worker" },
  "POST /internal/hosts/check-in": { area: "worker" },
  "POST /internal/jobs/:id/stats": { area: "worker" },
};

/** Bob's calls on his own account, with a body where the route needs one. */
const ACCOUNT_CALLS: Record<string, Request> = {
  "POST /api/jobs": { path: "/api/jobs", json: { type: "noop" } },
  "GET /api/jobs": { path: "/api/jobs" },
  "GET /api/project": { path: "/api/project" },
  "PATCH /api/project": { path: "/api/project", json: { unitSystem: "si" } },
  "POST /api/geometries": { path: "/api/geometries?name=bob.step", bytes: new TextEncoder().encode("ISO-10303-21;\nbob") },
  "GET /api/geometries": { path: "/api/geometries" },
  "GET /api/simulations": { path: "/api/simulations" },
  "GET /api/materials": { path: "/api/materials" },
  "POST /api/materials": {
    path: "/api/materials",
    // The same name as alice's material: names are unique per user, not across users.
    json: {
      material: {
        id: "m",
        name: `${ALICE_MARKER} steel`.replace(ALICE_MARKER, "bob"),
        model: "isotropic_elastic",
        youngsModulus: { value: 200, unit: "GPa" },
        poissonsRatio: 0.3,
      },
    },
  },
  "GET /api/report-branding": { path: "/api/report-branding" },
  "PUT /api/report-branding": { path: "/api/report-branding", json: { companyName: "Bob Engineering" } },
  "POST /api/report-branding/logo": { path: "/api/report-branding/logo", bytes: png(10, 10) },
  "GET /api/report-branding/logo": { path: "/api/report-branding/logo" },
  "DELETE /api/report-branding/logo": { path: "/api/report-branding/logo" },
  "GET /api/wallet": { path: "/api/wallet" },
  "GET /api/storage": { path: "/api/storage" },
};

/** The admin routes' calls, in an order the admin's own calls at the end can all succeed in. */
const ADMIN_CALLS: Record<string, Request> = {
  "GET /api/admin": { path: "/api/admin" },
  "POST /api/admin/allowed": { path: "/api/admin/allowed", json: { email: "invited@example.com" } },
  "DELETE /api/admin/allowed/:email": { path: "/api/admin/allowed/invited%40example.com" },
  "PUT /api/admin/machine-sizes/:name": { path: "/api/admin/machine-sizes/large", json: { enabled: false } },
  "PUT /api/admin/machine-hours-cap": { path: "/api/admin/machine-hours-cap", json: { hours: 0 } },
  "GET /api/admin/stats/jobs": { path: "/api/admin/stats/jobs" },
  "GET /api/admin/stats/host": { path: "/api/admin/stats/host" },
  "GET /api/admin/events": { path: "/api/admin/events" },
};

/** The allowlist, the cloud size list and the settings as they stand, to show a refused call changed nothing. */
async function allowlistSnapshot(): Promise<string> {
  const { results } = await env.DB.prepare("SELECT * FROM allowed_emails ORDER BY email").all();
  const sizes = await env.DB.prepare("SELECT name, cloud FROM machine_sizes ORDER BY name").all();
  const settings = await env.DB.prepare("SELECT name, value FROM settings ORDER BY name").all();
  return JSON.stringify([results, sizes.results, settings.results]);
}

/** The routes the app serves, as "METHOD /path", without middleware entries. */
function servedRoutes(): string[] {
  const served = new Set<string>();
  for (const route of app.routes) {
    if (route.method === "ALL") continue;
    served.add(`${route.method} ${route.path}`);
  }
  return [...served].sort();
}

/** For the tests that call every route, about a hundred requests each: more than the 5 s default on a busy runner. */
const SWEEP_TIMEOUT_MS = 60_000;

const routesIn = (area: Area) => Object.entries(ROUTES).filter(([, route]) => route.area === area);

describe("the isolation sweep", () => {
  it("lists every route the app serves, and only those", () => {
    const served = servedRoutes();
    const unlisted = served.filter((key) => !(key in ROUTES));
    expect(unlisted, "routes missing from the isolation sweep: add each to ROUTES").toEqual([]);
    expect(Object.keys(ROUTES).filter((key) => !served.includes(key))).toEqual([]);
    for (const [key, route] of routesIn("owned")) expect(route.owned, key).toBeDefined();
    for (const [key] of routesIn("account")) expect(ACCOUNT_CALLS[key], key).toBeDefined();
    for (const [key] of routesIn("admin")) expect(ADMIN_CALLS[key], key).toBeDefined();
  });

  it("refuses every owned, account and admin route without a sign-in", async () => {
    for (const [key, route] of [...routesIn("owned"), ...routesIn("account"), ...routesIn("admin")]) {
      const method = key.split(" ")[0] ?? "";
      const request = route.owned?.(aliceIds()) ?? ACCOUNT_CALLS[key] ?? ADMIN_CALLS[key];
      if (request === undefined) throw new Error(key);
      const response = await call(method, request);
      expect(response.status, key).toBe(401);
    }
  }, SWEEP_TIMEOUT_MS);

  it("refuses every worker route without the worker token, even to a signed-in user", async () => {
    for (const [key] of routesIn("worker")) {
      const [method = "", path = ""] = key.split(" ");
      const filled = path.replace(":id", mine.jobIds[2] ?? "").replace(":name", "mesh.bin");
      const response = await call(method, method === "GET" ? { path: filled } : { path: filled, json: { workerId: "w" } }, alice);
      expect(response.status, key).toBe(401);
    }
  });
});

describe("bob, signed in", () => {
  let before = "";
  beforeAll(async () => {
    before = await aliceSnapshot();
  });

  it("gets exactly the answer for an id nobody owns from every route given alice's ids", async () => {
    for (const [key, route] of routesIn("owned")) {
      const method = key.split(" ")[0] ?? "";
      const build = route.owned;
      if (build === undefined) throw new Error(key);
      const theirs = await call(method, build(aliceIds()), bob);
      const nobodys = await call(method, build(nobodysIds()), bob);
      const text = await textOf(theirs);
      expect(theirs.status, `${key}: ${text}`).toBe(404);
      expect(text, key).toBe(await textOf(nobodys));
      expect(theirs.headers.get("Content-Type"), key).toBe(nobodys.headers.get("Content-Type"));
      expectNoSecrets(key, text);
    }
  }, SWEEP_TIMEOUT_MS);

  it("sees nothing of alice's on his own account's routes", async () => {
    for (const [key] of routesIn("account")) {
      const method = key.split(" ")[0] ?? "";
      const request = ACCOUNT_CALLS[key];
      if (request === undefined) throw new Error(key);
      const response = await call(method, request, bob);
      const text = await textOf(response);
      expect(response.status, `${key}: ${text}`).toBeLessThan(400);
      expectNoSecrets(key, text);
    }
  }, SWEEP_TIMEOUT_MS);

  it("cannot reach alice's records through his own", async () => {
    const view = `/api/runs/${bobs.runId}/figures/view`;
    const figure = (viewId: string) => call("PUT", { path: `${view}/${viewId}?caption=x&position=0`, bytes: png(8, 8) }, bob);
    const theirs = await figure(extra.viewId);
    expect(theirs.status).toBe(404);
    // The answer repeats the id bob sent, and is otherwise the one for an id nobody owns.
    const madeUp = crypto.randomUUID();
    const nobodys = await textOf(await figure(madeUp));
    expect((await textOf(theirs)).replace(extra.viewId, madeUp)).toBe(nobodys);

    const options = await (await call("GET", { path: `/api/simulations/${bobs.simulationId}/report-options` }, bob)).json();
    const picked = await call(
      "PUT",
      {
        path: `/api/simulations/${bobs.simulationId}/report-options`,
        json: { ...(options as { options: object }).options, views: [extra.viewId] },
      },
      bob,
    );
    expect(picked.status).toBe(400);

    const moved = await call("PUT", { path: `/api/simulations/${bobs.simulationId}/spec`, json: mine.spec }, bob);
    expect(moved.status).toBe(400);
    expectNoSecrets("moving a spec onto alice's geometry", await moved.text());
  });

  it("opens alice's share link only for the run it names, and a revoked or made-up one not at all", async () => {
    const shared = await call("GET", { path: `/api/shared/${extra.shareToken}` }, bob);
    expect(shared.status).toBe(200);
    const text = await shared.text();
    // The link shows the run's results; it never names her account or her other records.
    for (const secret of [aliceId, mine.solvingRunId, extra.materialId, extra.noopJobId, extra.reportJobId]) {
      expect(text.includes(secret), secret).toBe(false);
    }
    for (const [key] of routesIn("public").filter(([k]) => k.includes(":token"))) {
      const path = key.split(" ")[1] ?? "";
      const madeUp = await call("GET", { path: path.replace(":token", "A".repeat(43)) }, bob);
      expect(madeUp.status, key).toBe(404);
      expectNoSecrets(key, await madeUp.text());
    }
  });

  it("finds no admin route, and changes nothing through one", async () => {
    const allowlist = await allowlistSnapshot();
    const unknown = await call("GET", { path: "/api/admin/no-such-route" }, bob);
    expect(unknown.status).toBe(404);
    for (const [key] of routesIn("admin")) {
      const method = key.split(" ")[0] ?? "";
      const request = ADMIN_CALLS[key];
      if (request === undefined) throw new Error(key);
      const response = await call(method, request, bob);
      const text = await textOf(response);
      expect(response.status, `${key}: ${text}`).toBe(404);
      expect(text, key).toBe(await textOf(unknown.clone()));
      expectNoSecrets(key, text);
    }
    expect(await allowlistSnapshot()).toBe(allowlist);
  });

  it("left every row and file of alice's as it was", async () => {
    expect(await aliceSnapshot()).toBe(before);
  });

  it("stored his own files only under his own prefix", async () => {
    const listed = await env.FILES.list();
    const owners = new Set(listed.objects.map((o) => o.key.split("/").slice(0, 2).join("/")));
    expect([...owners].sort()).toEqual([`owners/${aliceId}`, `owners/${bobId}`].sort());
    const bobGeometry = await env.DB.prepare(`SELECT id FROM geometries WHERE owner_id = ? AND name = 'bob.step'`)
      .bind(bobId)
      .first<{ id: string }>();
    expect(listed.objects.some((o) => o.key === `owners/${bobId}/geometries/${bobGeometry?.id}/model.step`)).toBe(true);
  });
});

describe("alice, on her own records", () => {
  it("reaches every one of them through the same requests bob was refused", async () => {
    // Run last: some of these change her records. None answers 404, so bob's 404s above come
    // from the owner check and not from a request that could never succeed.
    for (const [key, route] of routesIn("owned")) {
      const method = key.split(" ")[0] ?? "";
      const build = route.owned;
      if (build === undefined) throw new Error(key);
      const response = await call(method, build(aliceIds()), alice);
      expect([400, 401, 404, 415], `${key}: ${await textOf(response.clone())}`).not.toContain(response.status);
    }
  }, SWEEP_TIMEOUT_MS);

  it("reaches every admin route bob could not find, as the admin", async () => {
    for (const [key] of routesIn("admin")) {
      const method = key.split(" ")[0] ?? "";
      const request = ADMIN_CALLS[key];
      if (request === undefined) throw new Error(key);
      const response = await call(method, request, alice);
      expect(response.status, `${key}: ${await textOf(response.clone())}`).toBe(200);
    }
  });
});

describe("file keys", () => {
  it("of every job of alice's lie under her own storage prefix", async () => {
    const jobIds = [...mine.jobIds, extra.reportJobId];
    for (const id of jobIds) {
      const job = await getJob(env.DB, aliceId, id);
      if (job === null) throw new Error(id);
      const files = jobFiles(job);
      expect(files.length, job.type).toBeGreaterThan(0);
      for (const file of files) expect(file.key.startsWith(`owners/${aliceId}/`), file.key).toBe(true);
    }
  });

  it("are served to a worker only for a job it holds", async () => {
    const worker = { Authorization: "Bearer test-worker-token" };
    const download = await call("GET", { path: `/internal/jobs/${mine.jobIds[3]}/files/mesh.bin?worker=w` }, undefined, worker);
    expect(download.status).toBe(404);
    expectNoSecrets("worker download", await download.text());
  });
});
