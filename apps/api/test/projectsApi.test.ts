// SPDX-License-Identifier: AGPL-3.0-or-later
// The projects home's API (M14.2, ADR-114, ADR-124): folders and projects made, renamed, moved,
// duplicated, put in the trash and restored, the trash purged by the storage sweep with every
// file, and the unit system and lists read from a simulation's own project.
import {
  defaultReportOptions,
  type FolderView,
  type HomeResponse,
  type ProjectView,
  type SimulationSpec,
  validateFolderResponse,
  validateHomeResponse,
  validateProjectResponse,
} from "@clearfea/spec";
import fixture from "@clearfea/spec/fixtures/simulation-v1.json";
import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sweepStorage } from "../src/db/storage";

function call(method: string, path: string, cookie: string, body?: unknown): Promise<Response> {
  return exports.default.fetch(`http://localhost${path}`, {
    method,
    headers: { Cookie: cookie, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function signIn(login: string, password: string): Promise<string> {
  const response = await exports.default.fetch("http://localhost/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, password }),
  });
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

beforeEach(async () => {
  const listed = await env.FILES.list();
  if (listed.objects.length > 0) await env.FILES.delete(listed.objects.map((o) => o.key));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM share_links"),
    env.DB.prepare("DELETE FROM report_figures"),
    env.DB.prepare("DELETE FROM storage_charges"),
    env.DB.prepare("DELETE FROM ledger_entries WHERE reason <> 'grant'"),
    env.DB.prepare("DELETE FROM runs"),
    env.DB.prepare("DELETE FROM views"),
    env.DB.prepare("DELETE FROM report_options"),
    env.DB.prepare("DELETE FROM simulations"),
    env.DB.prepare("DELETE FROM meshes"),
    env.DB.prepare("DELETE FROM geometries"),
    env.DB.prepare("DELETE FROM job_logs"),
    env.DB.prepare("DELETE FROM jobs"),
    env.DB.prepare("DELETE FROM projects"),
    env.DB.prepare("UPDATE folders SET parent_id = NULL"),
    env.DB.prepare("DELETE FROM folders"),
    env.DB.prepare("UPDATE settings SET value = 30 WHERE name = 'trash_retention_days'"),
  ]);
});

async function json<T>(response: Response, status: number, validate: (v: unknown) => { ok: true; value: T } | { ok: false; errors: string[] }): Promise<T> {
  const text = await response.text();
  expect(response.status, text).toBe(status);
  const checked = validate(JSON.parse(text));
  if (!checked.ok) throw new Error(checked.errors.join(" "));
  return checked.value;
}

async function homeOf(cookie: string): Promise<HomeResponse> {
  return json(await call("GET", "/api/projects", cookie), 200, validateHomeResponse);
}

async function newProject(cookie: string, name: string, folderId: string | null = null): Promise<ProjectView> {
  return (await json(await call("POST", "/api/projects", cookie, { name, folderId }), 201, validateProjectResponse)).project;
}

async function newFolder(cookie: string, name: string, parentId: string | null = null): Promise<FolderView> {
  return (await json(await call("POST", "/api/folders", cookie, { name, parentId }), 201, validateFolderResponse)).folder;
}

async function project(cookie: string, id: string, action?: string, body?: unknown, status = 200): Promise<ProjectView> {
  const path = `/api/projects/${id}${action === undefined ? "" : `/${action}`}`;
  const method = action === undefined ? (body === undefined ? "GET" : "PATCH") : "POST";
  return (await json(await call(method, path, cookie, body), status, validateProjectResponse)).project;
}

async function folder(cookie: string, id: string, action?: string, body?: unknown, status = 200): Promise<FolderView> {
  const path = `/api/folders/${id}${action === undefined ? "" : `/${action}`}`;
  return (await json(await call(action === undefined ? "PATCH" : "POST", path, cookie, body), status, validateFolderResponse)).folder;
}

async function errorOf(response: Response, status: number): Promise<string> {
  const text = await response.text();
  expect(response.status, text).toBe(status);
  return (JSON.parse(text) as { error: string }).error;
}

const count = async (sql: string, ...values: unknown[]) =>
  (await env.DB.prepare(sql).bind(...values).first<{ n: number }>())?.n ?? -1;

/** Alice's geometry with its files, a simulation with a saved view and report options, a mesh and a finished run. */
async function work(projectId: string, marker = "w") {
  const ids = {
    geometryId: crypto.randomUUID(),
    simulationId: crypto.randomUUID(),
    meshId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    jobId: crypto.randomUUID(),
    viewId: crypto.randomUUID(),
  };
  const spec: SimulationSpec = { ...(JSON.parse(JSON.stringify(fixture)) as SimulationSpec), geometryId: ids.geometryId };
  const options = { ...defaultReportOptions("Report", "si"), views: [ids.viewId] };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO jobs (id, owner_id, type, target_id, status, machine_size, rate_per_hour, cost)
       VALUES (?, ?, 'solve', ?, 'succeeded', 'small', 500000, 100)`,
    ).bind(ids.jobId, aliceId, ids.runId),
    env.DB.prepare(
      `INSERT INTO ledger_entries (owner_id, amount, balance, reason, job_id)
       SELECT ?, -100, balance - 100, 'solve', ? FROM ledger_entries WHERE owner_id = ? ORDER BY seq DESC LIMIT 1`,
    ).bind(aliceId, ids.jobId, aliceId),
    env.DB.prepare(
      `INSERT INTO geometries (id, owner_id, project_id, name, size_bytes, status, confirmed_unit, scaling, body_count, face_count)
       VALUES (?, ?, ?, ?, 100, 'ready', 'mm', 1, 1, 3)`,
    ).bind(ids.geometryId, aliceId, projectId, `${marker}.step`),
    env.DB.prepare(
      `INSERT INTO meshes (id, owner_id, geometry_id, size, element_order, status)
       VALUES (?, ?, ?, '{"value":5,"unit":"mm"}', 2, 'ready')`,
    ).bind(ids.meshId, aliceId, ids.geometryId),
    env.DB.prepare(
      `INSERT INTO simulations (id, owner_id, geometry_id, project_id, name, analysis_type, spec_version, spec, mesh_id)
       VALUES (?, ?, ?, ?, ?, 'linear_static', 1, ?, ?)`,
    ).bind(ids.simulationId, aliceId, ids.geometryId, projectId, `${marker} simulation`, JSON.stringify(spec), ids.meshId),
    env.DB.prepare(
      `INSERT INTO views (id, owner_id, simulation_id, name, settings) VALUES (?, ?, ?, 'Front', '{"camera":{}}')`,
    ).bind(ids.viewId, aliceId, ids.simulationId),
    env.DB.prepare("INSERT INTO report_options (simulation_id, owner_id, options) VALUES (?, ?, ?)").bind(
      ids.simulationId,
      aliceId,
      JSON.stringify(options),
    ),
    env.DB.prepare(
      `INSERT INTO runs (id, owner_id, simulation_id, mesh_id, spec, status, job_id, files, finished_at)
       VALUES (?, ?, ?, ?, ?, 'succeeded', ?, '["deck.inp"]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    ).bind(ids.runId, aliceId, ids.simulationId, ids.meshId, JSON.stringify(spec), ids.jobId),
  ]);
  const owner = `owners/${aliceId}`;
  for (const file of ["model.step", "topology.json", "display.bin"]) {
    await env.FILES.put(`${owner}/geometries/${ids.geometryId}/${file}`, `${marker} ${file}`);
  }
  await env.FILES.put(`${owner}/meshes/${ids.meshId}/mesh.bin`, "mesh");
  await env.FILES.put(`${owner}/runs/${ids.runId}/deck.inp`, "deck");
  await env.FILES.put(`${owner}/runs/${ids.runId}/reports/r.pdf`, "report");
  await env.FILES.put(`${owner}/projects/${projectId}/thumbnail.png`, "thumbnail");
  return ids;
}

async function keys(prefix = `owners/${aliceId}/`): Promise<string[]> {
  return (await env.FILES.list({ prefix })).objects.map((o) => o.key).sort();
}

/** Moves an item's trash time back, as if it had gone to the trash `days` days ago. */
async function age(table: "projects" | "folders", days: number): Promise<void> {
  const stamp = new Date(Date.now() - days * 86_400_000).toISOString();
  await env.DB.prepare(`UPDATE ${table} SET deleted_at = ? WHERE deleted_at IS NOT NULL`).bind(stamp).run();
}

describe("the home", () => {
  it("needs a signed-in user", async () => {
    for (const [method, path] of [
      ["GET", "/api/projects"],
      ["POST", "/api/projects"],
      ["POST", "/api/folders"],
      ["POST", `/api/projects/${crypto.randomUUID()}/trash`],
    ] as const) {
      expect((await call(method, path, "")).status, path).toBe(401);
    }
  });

  it("lists every folder and project, the first project made on first use, with the trash period", async () => {
    const first = await homeOf(alice);
    expect(first.projects.map((p) => p.name)).toEqual(["My first project"]);
    expect(first.trashRetentionDays).toBe(30);
    const pumps = await newFolder(alice, "  Pumps  ");
    expect(pumps).toMatchObject({ name: "Pumps", parentId: null, deletedAt: null });
    const housing = await newProject(alice, "Housing", pumps.id);
    expect(housing).toMatchObject({ name: "Housing", folderId: pumps.id, unitSystem: "metric-mm", deletedAt: null });
    const home = await homeOf(alice);
    expect(home.folders.map((f) => f.id)).toEqual([pumps.id]);
    expect(home.projects.map((p) => p.name)).toEqual(["My first project", "Housing"]);
    expect((await homeOf(bob)).projects.map((p) => p.name)).toEqual(["My first project"]);
  });

  it("refuses an empty name and a folder that is not the user's outside the trash", async () => {
    expect(await errorOf(await call("POST", "/api/projects", alice, { name: "   " }), 400)).toMatch(/Give a name/);
    expect(await errorOf(await call("POST", "/api/folders", alice, { name: "" }), 400)).toMatch(/ProjectCreate|FolderCreate/);
    const bobs = await newFolder(bob, "Bob's");
    for (const id of [bobs.id, crypto.randomUUID()]) {
      expect(await errorOf(await call("POST", "/api/projects", alice, { name: "X", folderId: id }), 400)).toMatch(
        /no folder with that id/,
      );
      expect((await call("POST", "/api/folders", alice, { name: "X", parentId: id })).status).toBe(400);
    }
  });

  it("records when a project was opened", async () => {
    const housing = await newProject(alice, "Housing");
    expect(housing.lastOpenedAt).toBeNull();
    expect((await project(alice, housing.id, "opened")).lastOpenedAt).not.toBeNull();
    expect((await call("POST", `/api/projects/${housing.id}/opened`, bob)).status).toBe(404);
  });
});

describe("renaming and moving", () => {
  it("renames and moves a project, and sets its unit system", async () => {
    const pumps = await newFolder(alice, "Pumps");
    const housing = await newProject(alice, "Housing");
    const moved = await project(alice, housing.id, undefined, { name: "Pump housing", folderId: pumps.id, unitSystem: "us-in" });
    expect(moved).toMatchObject({ name: "Pump housing", folderId: pumps.id, unitSystem: "us-in" });
    expect((await project(alice, housing.id, undefined, { folderId: null })).folderId).toBeNull();
    expect((await project(alice, housing.id, undefined, { name: "Kept" })).unitSystem).toBe("us-in");
    expect(await errorOf(await call("PATCH", `/api/projects/${housing.id}`, alice, { unitSystem: "imperial" }), 400)).toMatch(
      /not a unit system/,
    );
    expect((await call("PATCH", `/api/projects/${housing.id}`, alice, {})).status).toBe(400);
  });

  it("refuses a move into another user's folder or into the trash, and any change to a project in the trash", async () => {
    const housing = await newProject(alice, "Housing");
    const bobs = await newFolder(bob, "Bob's");
    expect((await call("PATCH", `/api/projects/${housing.id}`, alice, { folderId: bobs.id })).status).toBe(400);
    const old = await newFolder(alice, "Old");
    await folder(alice, old.id, "trash");
    expect((await call("PATCH", `/api/projects/${housing.id}`, alice, { folderId: old.id })).status).toBe(400);
    await project(alice, housing.id, "trash");
    expect(await errorOf(await call("PATCH", `/api/projects/${housing.id}`, alice, { name: "X" }), 409)).toMatch(/Restore it first/);
    expect((await call("PATCH", `/api/projects/${housing.id}`, bob, { name: "X" })).status).toBe(404);
  });

  it("moves a folder but never into itself or a folder inside it", async () => {
    const a = await newFolder(alice, "A");
    const b = await newFolder(alice, "B", a.id);
    const c = await newFolder(alice, "C", b.id);
    for (const parentId of [a.id, b.id, c.id]) {
      expect(await errorOf(await call("PATCH", `/api/folders/${a.id}`, alice, { parentId }), 400)).toMatch(/inside itself/);
    }
    const moved = await folder(alice, c.id, undefined, { parentId: null, name: "C at the top" });
    expect(moved).toMatchObject({ parentId: null, name: "C at the top" });
    expect((await folder(alice, a.id, undefined, { parentId: c.id })).parentId).toBe(c.id);
    expect((await call("PATCH", `/api/folders/${a.id}`, bob, { name: "X" })).status).toBe(404);
  });
});

describe("the trash", () => {
  it("takes a folder with everything in it, and brings back exactly what went with it", async () => {
    const pumps = await newFolder(alice, "Pumps");
    const inner = await newFolder(alice, "Impellers", pumps.id);
    const housing = await newProject(alice, "Housing", pumps.id);
    const blade = await newProject(alice, "Blade", inner.id);
    const scrap = await newProject(alice, "Scrap", inner.id);
    // Trashed on its own first: it stays in the trash when the folder comes back.
    await project(alice, scrap.id, "trash");
    const trashed = await folder(alice, pumps.id, "trash");
    expect(trashed.deletedAt).not.toBeNull();
    const home = await homeOf(alice);
    const deleted = (id: string) =>
      [...home.folders, ...home.projects].find((item) => item.id === id)?.deletedAt ?? null;
    for (const id of [inner.id, housing.id, blade.id]) expect(deleted(id), id).toBe(trashed.deletedAt);
    expect(deleted(scrap.id)).not.toBe(trashed.deletedAt);
    expect((await call("POST", "/api/projects", alice, { name: "X", folderId: pumps.id })).status).toBe(400);

    expect((await folder(alice, pumps.id, "restore")).deletedAt).toBeNull();
    const back = await homeOf(alice);
    expect(back.folders.every((f) => f.deletedAt === null)).toBe(true);
    expect(back.projects.filter((p) => p.deletedAt !== null).map((p) => p.name)).toEqual(["Scrap"]);
  });

  it("restores a project or folder to the top of the home when its folder is still in the trash", async () => {
    const pumps = await newFolder(alice, "Pumps");
    const inner = await newFolder(alice, "Impellers", pumps.id);
    const housing = await newProject(alice, "Housing", inner.id);
    await folder(alice, pumps.id, "trash");
    expect(await project(alice, housing.id, "restore")).toMatchObject({ deletedAt: null, folderId: null });
    expect(await folder(alice, inner.id, "restore")).toMatchObject({ deletedAt: null, parentId: null });
    expect((await homeOf(alice)).folders.find((f) => f.id === pumps.id)?.deletedAt).not.toBeNull();
  });

  it("refuses to restore an item past the retention period, and another user's at all", async () => {
    const housing = await newProject(alice, "Housing");
    const pumps = await newFolder(alice, "Pumps");
    await project(alice, housing.id, "trash");
    await folder(alice, pumps.id, "trash");
    expect((await call("POST", `/api/projects/${housing.id}/restore`, bob)).status).toBe(404);
    expect((await call("POST", `/api/folders/${pumps.id}/trash`, bob)).status).toBe(404);
    await age("projects", 31);
    await age("folders", 31);
    expect(await errorOf(await call("POST", `/api/projects/${housing.id}/restore`, alice), 409)).toMatch(/more than 30 days/);
    expect((await call("POST", `/api/folders/${pumps.id}/restore`, alice)).status).toBe(409);
  });

  it("is purged by the storage sweep after the retention period, with every file, keeping jobs and the ledger", async () => {
    const pumps = await newFolder(alice, "Pumps");
    const inner = await newFolder(alice, "Impellers", pumps.id);
    const housing = await newProject(alice, "Housing", inner.id);
    const kept = await newProject(alice, "Kept");
    const gone = await work(housing.id, "gone");
    const stays = await work(kept.id, "stays");
    await env.DB.prepare("INSERT INTO share_links (run_id, owner_id, token_hash) VALUES (?, ?, 'hash-gone')").bind(gone.runId, aliceId).run();
    await folder(alice, pumps.id, "trash");

    // Not yet past the period: nothing goes.
    expect(await sweepStorage(env.DB, env.FILES, new Date())).toMatchObject({ purgedProjects: 0, purgedFolders: 0 });
    await age("projects", 30.5);
    await age("folders", 30.5);
    // A job still going holds its project back.
    await env.DB.prepare("UPDATE jobs SET status = 'running' WHERE id = ?").bind(gone.jobId).run();
    expect(await sweepStorage(env.DB, env.FILES, new Date())).toMatchObject({ purgedProjects: 0, purgedFolders: 0 });
    await env.DB.prepare("UPDATE jobs SET status = 'succeeded' WHERE id = ?").bind(gone.jobId).run();

    expect(await sweepStorage(env.DB, env.FILES, new Date())).toMatchObject({ purgedProjects: 1, purgedFolders: 2 });
    const owner = `owners/${aliceId}`;
    expect(await keys()).toEqual(
      [
        `${owner}/geometries/${stays.geometryId}/display.bin`,
        `${owner}/geometries/${stays.geometryId}/model.step`,
        `${owner}/geometries/${stays.geometryId}/topology.json`,
        `${owner}/meshes/${stays.meshId}/mesh.bin`,
        `${owner}/projects/${kept.id}/thumbnail.png`,
        `${owner}/runs/${stays.runId}/deck.inp`,
        `${owner}/runs/${stays.runId}/reports/r.pdf`,
      ].sort(),
    );
    for (const [table, id] of [
      ["projects", housing.id],
      ["geometries", gone.geometryId],
      ["simulations", gone.simulationId],
      ["meshes", gone.meshId],
      ["runs", gone.runId],
      ["views", gone.viewId],
      ["folders", pumps.id],
      ["folders", inner.id],
    ] as const) {
      expect(await count(`SELECT COUNT(*) AS n FROM ${table} WHERE id = ?`, id), `${table} ${id}`).toBe(0);
    }
    expect(await count("SELECT COUNT(*) AS n FROM share_links WHERE run_id = ?", gone.runId)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM report_options WHERE simulation_id = ?", gone.simulationId)).toBe(0);
    // The record of what was charged stays.
    expect(await count("SELECT COUNT(*) AS n FROM jobs WHERE id = ?", gone.jobId)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM ledger_entries WHERE job_id = ?", gone.jobId)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM runs WHERE id = ?", stays.runId)).toBe(1);
  });

  it("purges a folder only once it is empty", async () => {
    const pumps = await newFolder(alice, "Pumps");
    const housing = await newProject(alice, "Housing", pumps.id);
    await folder(alice, pumps.id, "trash");
    await age("folders", 31);
    // The project went with the folder but its time is still recent: both stay.
    await env.DB.prepare("UPDATE projects SET deleted_at = ? WHERE id = ?").bind(new Date().toISOString(), housing.id).run();
    expect(await sweepStorage(env.DB, env.FILES, new Date())).toMatchObject({ purgedProjects: 0, purgedFolders: 0 });
  });
});

describe("duplicating", () => {
  it("copies a project's geometries with their files and its simulations' setup, not meshes or runs", async () => {
    const pumps = await newFolder(alice, "Pumps");
    const housing = await newProject(alice, "Housing", pumps.id);
    await project(alice, housing.id, undefined, { unitSystem: "us-in" });
    const original = await work(housing.id);
    const copy = await project(alice, housing.id, "duplicate", undefined, 201);
    expect(copy).toMatchObject({ name: "Housing (copy)", folderId: pumps.id, unitSystem: "us-in", deletedAt: null });

    const geometry = await env.DB.prepare("SELECT * FROM geometries WHERE project_id = ?").bind(copy.id).first<Record<string, unknown>>();
    expect(geometry).toMatchObject({ name: "w.step", status: "ready", confirmed_unit: "mm", face_count: 3, import_job_id: null });
    const geometryId = geometry?.id as string;
    expect(geometryId).not.toBe(original.geometryId);
    const owner = `owners/${aliceId}`;
    expect(await keys(`${owner}/geometries/${geometryId}/`)).toEqual(
      ["display.bin", "model.step", "topology.json"].map((f) => `${owner}/geometries/${geometryId}/${f}`),
    );
    expect(await (await env.FILES.get(`${owner}/geometries/${geometryId}/model.step`))?.text()).toBe("w model.step");
    expect(await keys(`${owner}/projects/${copy.id}/`)).toEqual([`${owner}/projects/${copy.id}/thumbnail.png`]);

    const simulation = await env.DB.prepare("SELECT * FROM simulations WHERE project_id = ?")
      .bind(copy.id)
      .first<{ id: string; geometry_id: string; spec: string; mesh_id: string | null; name: string }>();
    expect(simulation).toMatchObject({ geometry_id: geometryId, mesh_id: null, name: "w simulation" });
    expect((JSON.parse(simulation?.spec ?? "{}") as SimulationSpec).geometryId).toBe(geometryId);
    const view = await env.DB.prepare("SELECT id FROM views WHERE simulation_id = ?").bind(simulation?.id).first<{ id: string }>();
    const options = await env.DB.prepare("SELECT options FROM report_options WHERE simulation_id = ?")
      .bind(simulation?.id)
      .first<{ options: string }>();
    expect((JSON.parse(options?.options ?? "{}") as { views: string[] }).views).toEqual([view?.id]);
    expect(await count("SELECT COUNT(*) AS n FROM runs WHERE simulation_id = ?", simulation?.id)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM meshes WHERE geometry_id = ?", geometryId)).toBe(0);

    const named = await project(alice, housing.id, "duplicate", { name: "Elsewhere", folderId: null }, 201);
    expect(named).toMatchObject({ name: "Elsewhere", folderId: null });
  });

  it("waits for an import to finish, and refuses another user's project or a project in the trash", async () => {
    const housing = await newProject(alice, "Housing");
    const original = await work(housing.id);
    expect((await call("POST", `/api/projects/${housing.id}/duplicate`, bob)).status).toBe(404);
    await env.DB.prepare("UPDATE geometries SET status = 'importing' WHERE id = ?").bind(original.geometryId).run();
    expect(await errorOf(await call("POST", `/api/projects/${housing.id}/duplicate`, alice), 409)).toMatch(/still being imported/);
    await env.DB.prepare("UPDATE geometries SET status = 'ready' WHERE id = ?").bind(original.geometryId).run();
    await project(alice, housing.id, "trash");
    expect((await call("POST", `/api/projects/${housing.id}/duplicate`, alice)).status).toBe(409);
    expect(await count("SELECT COUNT(*) AS n FROM projects WHERE owner_id = ?", aliceId)).toBe(1);
  });

  it("copies a folder with its folders and projects outside the trash", async () => {
    const pumps = await newFolder(alice, "Pumps");
    const inner = await newFolder(alice, "Impellers", pumps.id);
    const blade = await newProject(alice, "Blade", inner.id);
    await work(blade.id, "blade");
    const scrap = await newProject(alice, "Scrap", pumps.id);
    await project(alice, scrap.id, "trash");
    const copy = await folder(alice, pumps.id, "duplicate", undefined, 201);
    expect(copy).toMatchObject({ name: "Pumps (copy)", parentId: null });
    const home = await homeOf(alice);
    const innerCopy = home.folders.find((f) => f.parentId === copy.id);
    expect(innerCopy?.name).toBe("Impellers");
    const bladeCopy = home.projects.find((p) => p.folderId === innerCopy?.id);
    expect(bladeCopy?.name).toBe("Blade");
    expect(home.projects.filter((p) => p.name === "Scrap")).toHaveLength(1);
    expect(await count("SELECT COUNT(*) AS n FROM geometries WHERE project_id = ?", bladeCopy?.id)).toBe(1);
    // Into a folder of its own is allowed: the copy is made from what was there before.
    const nested = await folder(alice, pumps.id, "duplicate", { folderId: inner.id }, 201);
    expect(nested.parentId).toBe(inner.id);
  });
});

describe("a simulation's own project", () => {
  it("gives the report's unit system and filters the geometry and simulation lists", async () => {
    const first = (await homeOf(alice)).projects[0];
    const housing = await newProject(alice, "Housing");
    await project(alice, housing.id, undefined, { unitSystem: "us-in" });
    const ids = await work(housing.id);
    await env.DB.prepare("DELETE FROM report_options").run();
    const options = await call("GET", `/api/simulations/${ids.simulationId}/report-options`, alice);
    expect(((await options.json()) as { options: { unitSystem: string } }).options.unitSystem).toBe("us-in");

    const listed = async (path: string) => ((await (await call("GET", path, alice)).json()) as Record<string, Array<{ id: string }>>);
    expect((await listed(`/api/geometries?projectId=${housing.id}`)).geometries?.map((g) => g.id)).toEqual([ids.geometryId]);
    expect((await listed(`/api/geometries?projectId=${first?.id}`)).geometries).toEqual([]);
    expect((await listed("/api/geometries")).geometries).toHaveLength(1);
    expect((await listed(`/api/simulations?projectId=${housing.id}`)).simulations?.map((s) => s.id)).toEqual([ids.simulationId]);
    expect((await listed(`/api/simulations?projectId=${first?.id}`)).simulations).toEqual([]);
  });

  it("takes an upload into the project named, never one in the trash or another user's", async () => {
    const housing = await newProject(alice, "Housing");
    const upload = (cookie: string, projectId: string) =>
      exports.default.fetch(`http://localhost/api/geometries?name=a.step&projectId=${projectId}`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/octet-stream" },
        body: new TextEncoder().encode("ISO-10303-21;\nx"),
      });
    const made = await upload(alice, housing.id);
    expect(made.status).toBe(201);
    const { geometry } = (await made.json()) as { geometry: { id: string } };
    expect(await count("SELECT COUNT(*) AS n FROM geometries WHERE id = ? AND project_id = ?", geometry.id, housing.id)).toBe(1);
    expect((await upload(bob, housing.id)).status).toBe(404);
    await project(alice, housing.id, "trash");
    expect(await errorOf(await upload(alice, housing.id), 404)).toMatch(/outside the trash/);
  });
});

describe("the thumbnail", () => {
  /** A PNG of the given size: signature and IHDR are all the API reads. */
  function png(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(33);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width);
    view.setUint32(20, height);
    return bytes;
  }
  const put = (cookie: string, id: string, body: Uint8Array, type = "application/octet-stream") =>
    exports.default.fetch(`http://localhost/api/projects/${id}/thumbnail`, {
      method: "PUT",
      headers: { Cookie: cookie, "Content-Type": type },
      body,
    });

  it("is stored as a PNG, served back to its owner and stamped on the project", async () => {
    const housing = await newProject(alice, "Housing");
    expect(housing.thumbnailAt).toBeNull();
    expect((await call("GET", `/api/projects/${housing.id}/thumbnail`, alice)).status).toBe(404);
    const stored = await json(await put(alice, housing.id, png(320, 200)), 200, validateProjectResponse);
    expect(stored.project.thumbnailAt).not.toBeNull();
    const served = await call("GET", `/api/projects/${housing.id}/thumbnail`, alice);
    expect(served.status).toBe(200);
    expect(served.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(png(320, 200));
    expect(await env.FILES.head(`owners/${aliceId}/projects/${housing.id}/thumbnail.png`)).not.toBeNull();
    expect((await call("GET", `/api/projects/${housing.id}/thumbnail`, bob)).status).toBe(404);
    expect((await put(bob, housing.id, png(320, 200))).status).toBe(404);
  });

  it("refuses anything but a small PNG, and a project in the trash", async () => {
    const housing = await newProject(alice, "Housing");
    expect((await put(alice, housing.id, png(320, 200), "image/png")).status).toBe(415);
    expect(await errorOf(await put(alice, housing.id, new TextEncoder().encode("not a picture")), 400)).toMatch(/PNG/);
    expect(await errorOf(await put(alice, housing.id, png(2000, 200)), 400)).toMatch(/1024 pixels/);
    await project(alice, housing.id, "trash");
    expect(await errorOf(await put(alice, housing.id, png(320, 200)), 409)).toMatch(/Restore it first/);
  });
});
