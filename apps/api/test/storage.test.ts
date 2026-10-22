// SPDX-License-Identifier: AGPL-3.0-or-later
// Storage per user (M8.6, ADR-086): what is kept, by kind, against the free allowance; pins;
// the daily sweep that removes raw solver output past its retention period and charges storage
// above the allowance once a day; and a rerun of a run's frozen setup that regenerates it.
import {
  type SimulationSpec,
  validateRunResponse,
  validateStorageResponse,
  validateWalletResponse,
} from "@clearfea/spec";
import fixture from "@clearfea/spec/fixtures/simulation-v1.json";
import { createScheduledController } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GIB, storageDayCost } from "../src/billing/storage";
import { storageKind, sweepStorage } from "../src/db/storage";
import handler from "../src/index";
import { userProject } from "../src/db/projects";

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

let simulationId = "";
let geometryId = "";
let meshId = "";

const RESULT = { nodes: 100, software: { calculix: "2.21" } };
const RUN_FILES = ["deck.inp", "solver.log", "results.frd", "results.dat", "surface.bin", "fields.bin", "nodes.bin"];
const DAY = 86_400_000;

/** Alice's run of the fixture's setup, ended `ageDays` days ago, with its job and stored files. */
async function runRow(ageDays: number, status: "succeeded" | "solving" = "succeeded"): Promise<string> {
  const id = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const done = status !== "solving";
  const finished = new Date(Date.now() - ageDays * DAY).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO jobs (id, owner_id, type, target_id, status, machine_size, rate_per_hour)
       VALUES (?, ?, 'solve', ?, ?, 'small', 500000)`,
    ).bind(jobId, aliceId, id, done ? status : "running"),
    env.DB.prepare(
      `INSERT INTO runs (id, owner_id, simulation_id, mesh_id, spec, status, job_id, files, result, created_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      aliceId,
      simulationId,
      meshId,
      JSON.stringify({ ...fixture, geometryId }),
      status,
      jobId,
      done ? JSON.stringify(RUN_FILES) : null,
      done ? JSON.stringify(RESULT) : null,
      finished,
      done ? finished : null,
    ),
  ]);
  if (done) {
    for (const name of RUN_FILES) {
      await env.FILES.put(`owners/${aliceId}/runs/${id}/${name}`, name.startsWith("results.") ? "x".repeat(1000) : "y");
    }
  }
  return id;
}

async function setting(name: string, value: number): Promise<void> {
  await env.DB.prepare("UPDATE settings SET value = ? WHERE name = ?").bind(value, name).run();
}

async function storageOf(cookie: string) {
  const response = await call("GET", "/api/storage", cookie);
  expect(response.status).toBe(200);
  const checked = validateStorageResponse(await response.json());
  if (!checked.ok) throw new Error(checked.errors.join(" "));
  return checked.value.storage;
}

async function runOf(id: string) {
  const response = await call("GET", `/api/runs/${id}`, alice);
  expect(response.status).toBe(200);
  const checked = validateRunResponse(await response.json());
  if (!checked.ok) throw new Error(checked.errors.join(" "));
  return checked.value.run;
}

async function walletOf(cookie: string) {
  const response = await call("GET", "/api/wallet", cookie);
  const checked = validateWalletResponse(await response.json());
  if (!checked.ok) throw new Error(checked.errors.join(" "));
  return checked.value.wallet;
}

beforeEach(async () => {
  const listed = await env.FILES.list();
  if (listed.objects.length > 0) await env.FILES.delete(listed.objects.map((o) => o.key));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM storage_charges"),
    env.DB.prepare("DELETE FROM ledger_entries WHERE reason <> 'grant'"),
    env.DB.prepare("DELETE FROM runs"),
    env.DB.prepare("DELETE FROM meshes"),
    env.DB.prepare("DELETE FROM jobs"),
    env.DB.prepare("DELETE FROM simulations"),
    env.DB.prepare("DELETE FROM geometries"),
    env.DB.prepare("UPDATE settings SET value = 5368709120 WHERE name = 'storage_free_bytes'"),
    env.DB.prepare("UPDATE settings SET value = 30 WHERE name = 'raw_output_retention_days'"),
    env.DB.prepare("UPDATE settings SET value = 10000 WHERE name = 'storage_rate_per_gib_day'"),
  ]);
  geometryId = crypto.randomUUID();
  simulationId = crypto.randomUUID();
  meshId = crypto.randomUUID();
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
    env.DB.prepare(
      `INSERT INTO meshes (id, owner_id, geometry_id, size, element_order, status, node_count, element_count)
       VALUES (?, ?, ?, '{"value":5,"unit":"mm"}', 2, 'ready', 100, 40)`,
    ).bind(meshId, aliceId, geometryId),
  ]);
  await env.FILES.put(`owners/${aliceId}/geometries/${geometryId}/model.step`, "s".repeat(100));
  await env.FILES.put(`owners/${aliceId}/meshes/${meshId}/mesh.bin`, "m".repeat(50));
  await env.FILES.put(`owners/${aliceId}/report/logo`, "l".repeat(7));
});

describe("storageDayCost", () => {
  it("is zero at or below the allowance", () => {
    expect(storageDayCost(0, 0, 10000)).toBe(0);
    expect(storageDayCost(GIB, GIB, 10000)).toBe(0);
  });

  it("charges the bytes above the allowance at the rate per GiB, rounded to the nearest micro-credit", () => {
    expect(storageDayCost(3 * GIB, GIB, 10000)).toBe(20000);
    expect(storageDayCost(GIB + GIB / 2, GIB, 3)).toBe(2); // 1.5 rounds up
    expect(storageDayCost(GIB + GIB / 4, GIB, 2)).toBe(1); // 0.5 rounds up
    expect(storageDayCost(GIB + 1000, GIB, 10000)).toBe(0); // 0.0093 rounds down
  });

  it("stays exact for sizes whose product passes 2^53", () => {
    expect(storageDayCost(1000 * GIB, 0, 1_000_000_007)).toBe(1_000_000_007_000);
  });

  it("refuses sizes that are not whole numbers of bytes", () => {
    expect(() => storageDayCost(1.5, 0, 1)).toThrow(RangeError);
    expect(() => storageDayCost(1, -1, 1)).toThrow(RangeError);
  });
});

describe("storageKind", () => {
  it("sorts every key the API writes", () => {
    expect(storageKind("geometries/g/model.step")).toBe("geometry");
    expect(storageKind("meshes/m/mesh.bin")).toBe("mesh");
    expect(storageKind("runs/r/results.frd")).toBe("rawOutput");
    expect(storageKind("runs/r/results.dat")).toBe("rawOutput");
    expect(storageKind("runs/r/nodes.bin")).toBe("results");
    expect(storageKind("runs/r/deck.inp")).toBe("results");
    expect(storageKind("runs/r/figures/load-1.png")).toBe("report");
    expect(storageKind("runs/r/reports/j.docx")).toBe("report");
    expect(storageKind("report/logo")).toBe("report");
  });
});

describe("GET /api/storage", () => {
  it("adds up the user's files by kind and lists the runs holding raw output", async () => {
    const run = await runRow(1);
    const storage = await storageOf(alice);
    expect(storage.freeBytes).toBe(5 * GIB);
    expect(storage.retentionDays).toBe(30);
    expect(storage.ratePerGibDay).toBe(10000);
    expect(storage.parts).toEqual([
      { kind: "geometry", bytes: 100, files: 1 },
      { kind: "mesh", bytes: 50, files: 1 },
      { kind: "results", bytes: 5, files: 5 },
      { kind: "rawOutput", bytes: 2000, files: 2 },
      { kind: "report", bytes: 7, files: 1 },
    ]);
    expect(storage.usedBytes).toBe(2162);
    expect(storage.runs).toHaveLength(1);
    expect(storage.runs[0]).toMatchObject({ id: run, simulationName: "Bracket", bytes: 2000, pinned: false });
    const finished = (await runOf(run)).finishedAt ?? "";
    expect(storage.runs[0]?.keptUntil).toBe(new Date(Date.parse(finished) + 30 * DAY).toISOString());
  });

  it("shows another user none of alice's files or runs", async () => {
    await runRow(1);
    const storage = await storageOf(bob);
    expect(storage.usedBytes).toBe(0);
    expect(storage.runs).toEqual([]);
  });

  it("needs a signed-in user", async () => {
    const response = await exports.default.fetch("http://localhost/api/storage");
    expect(response.status).toBe(401);
  });
});

describe("pinning a run", () => {
  it("keeps the raw output with no end date, and unpinning brings the date back", async () => {
    const run = await runRow(1);
    expect((await runOf(run)).rawOutput).toMatchObject({ pinned: false, removedAt: null, rerunOf: null });
    expect((await runOf(run)).rawOutput.keptUntil).not.toBeNull();
    const pinned = await call("PUT", `/api/runs/${run}/pin`, alice, { pinned: true });
    expect(pinned.status).toBe(200);
    expect((await runOf(run)).rawOutput).toMatchObject({ pinned: true, keptUntil: null });
    expect((await storageOf(alice)).runs[0]).toMatchObject({ pinned: true, keptUntil: null });
    await call("PUT", `/api/runs/${run}/pin`, alice, { pinned: false });
    expect((await runOf(run)).rawOutput.pinned).toBe(false);
  });

  it("answers another user's run like a missing one", async () => {
    const run = await runRow(1);
    const response = await call("PUT", `/api/runs/${run}/pin`, bob, { pinned: true });
    expect(response.status).toBe(404);
    expect((await runOf(run)).rawOutput.pinned).toBe(false);
  });

  it("refuses a body that is not a PinRunRequest", async () => {
    const run = await runRow(1);
    expect((await call("PUT", `/api/runs/${run}/pin`, alice, { pinned: "yes" })).status).toBe(400);
  });
});

describe("the storage sweep", () => {
  it("removes raw output past the retention period unless the run is pinned, and keeps everything else", async () => {
    const old = await runRow(31);
    const pinned = await runRow(40);
    const recent = await runRow(29);
    await call("PUT", `/api/runs/${pinned}/pin`, alice, { pinned: true });
    const summary = await sweepStorage(env.DB, env.FILES, new Date());
    expect(summary.removed).toBe(1);
    for (const name of RUN_FILES) {
      const kept = await env.FILES.head(`owners/${aliceId}/runs/${old}/${name}`);
      expect(kept === null).toBe(name.startsWith("results."));
      expect(await env.FILES.head(`owners/${aliceId}/runs/${pinned}/${name}`)).not.toBeNull();
      expect(await env.FILES.head(`owners/${aliceId}/runs/${recent}/${name}`)).not.toBeNull();
    }
    const removed = await runOf(old);
    expect(removed.rawOutput.removedAt).not.toBeNull();
    expect(removed.rawOutput.keptUntil).toBeNull();
    // The results the viewer and a share link draw are kept.
    expect((await call("GET", `/api/runs/${old}/fields`, alice)).status).toBe(200);
    const download = await call("GET", `/api/runs/${old}/files/results.frd`, alice);
    expect(download.status).toBe(410);
    expect(((await download.json()) as { error: string }).error).toContain("Run it again to regenerate it");
    // A removed run cannot be pinned.
    expect((await call("PUT", `/api/runs/${old}/pin`, alice, { pinned: true })).status).toBe(409);
    expect((await storageOf(alice)).runs.map((r) => r.id).sort()).toEqual([pinned, recent].sort());
    // Running the sweep again removes nothing more.
    expect((await sweepStorage(env.DB, env.FILES, new Date())).removed).toBe(0);
  });

  it("charges storage above the allowance once per day, and the ledger adds up exactly", async () => {
    await runRow(1);
    // 2162 bytes stored against a 162-byte allowance: 2000 bytes above it.
    await setting("storage_free_bytes", 162);
    await setting("storage_rate_per_gib_day", GIB);
    const before = (await walletOf(alice)).balance;
    const day = new Date("2026-10-17T03:00:00Z");
    expect((await sweepStorage(env.DB, env.FILES, day)).charged).toBe(1);
    expect((await sweepStorage(env.DB, env.FILES, new Date("2026-10-17T15:00:00Z"))).charged).toBe(0);
    const wallet = await walletOf(alice);
    expect(wallet.balance).toBe(before - 2000);
    expect(wallet.granted + wallet.charged).toBe(wallet.balance);
    expect(wallet.entries[0]).toMatchObject({
      reason: "storage",
      amount: -2000,
      balance: before - 2000,
      job: null,
      run: null,
      mesh: null,
      storage: { day: "2026-10-17", usedBytes: 2162, freeBytes: 162, ratePerGibDay: GIB },
    });
    // The next day is charged again; bob, with nothing stored, never is.
    expect((await sweepStorage(env.DB, env.FILES, new Date("2026-10-18T03:00:00Z"))).charged).toBe(1);
    expect((await walletOf(alice)).balance).toBe(before - 4000);
    expect((await walletOf(bob)).entries.filter((e) => e.reason === "storage")).toEqual([]);
  });

  it("charges nothing within the allowance", async () => {
    await runRow(1);
    expect((await sweepStorage(env.DB, env.FILES, new Date())).charged).toBe(0);
    expect((await walletOf(alice)).entries.filter((e) => e.reason === "storage")).toEqual([]);
  });

  it("runs from the scheduled handler", async () => {
    const old = await runRow(31);
    const controller = createScheduledController({ scheduledTime: Date.now(), cron: "0 3 * * *" });
    await handler.scheduled(controller, env);
    expect((await runOf(old)).rawOutput.removedAt).not.toBeNull();
  });
});

describe("raw output download", () => {
  it("downloads results.frd and results.dat as files while they are kept", async () => {
    const run = await runRow(1);
    const response = await call("GET", `/api/runs/${run}/files/results.frd`, alice);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    expect((await response.arrayBuffer()).byteLength).toBe(1000);
    expect((await call("GET", `/api/runs/${run}/files/results.dat`, bob)).status).toBe(404);
  });
});

describe("POST /api/runs/:id/rerun", () => {
  it("solves the run's frozen setup again on the same mesh as a new run", async () => {
    const old = await runRow(31);
    await sweepStorage(env.DB, env.FILES, new Date());
    // The simulation's setup changed since; the rerun still uses the run's own.
    await env.DB.prepare("UPDATE simulations SET spec = json_set(spec, '$.solver', 'spooles') WHERE id = ?")
      .bind(simulationId)
      .run();
    const response = await call("POST", `/api/runs/${old}/rerun`, alice);
    expect(response.status).toBe(201);
    const checked = validateRunResponse(await response.json());
    if (!checked.ok) throw new Error(checked.errors.join(" "));
    const run = checked.value.run;
    expect(run.id).not.toBe(old);
    expect(run.status).toBe("solving");
    expect(run.meshId).toBe(meshId);
    expect(run.simulationId).toBe(simulationId);
    expect(run.spec).toEqual((await runOf(old)).spec);
    expect(run.rawOutput.rerunOf).toBe(old);
    // On the size the run was billed on.
    expect(run.machine?.size).toBe("small");
    // The old run predates the stop limit, so the rerun takes the default (M8.3).
    expect(run.stopLimit?.multiplier).toBe(3);
    const job = await env.DB.prepare("SELECT type, status, params FROM jobs WHERE target_id = ?")
      .bind(run.id)
      .first<{ type: string; status: string; params: string }>();
    expect(job).toMatchObject({ type: "solve", status: "queued" });
    expect(JSON.parse(job?.params ?? "{}").meshId).toBe(meshId);
    // While it solves, another rerun is refused.
    expect((await call("POST", `/api/runs/${old}/rerun`, alice)).status).toBe(409);
  });

  it("answers another user's run like a missing one", async () => {
    const old = await runRow(31);
    expect((await call("POST", `/api/runs/${old}/rerun`, bob)).status).toBe(404);
  });

  it("refuses a run that is still solving", async () => {
    const run = await runRow(0, "solving");
    expect((await call("POST", `/api/runs/${run}/rerun`, alice)).status).toBe(409);
  });

  it("refuses a rerun the wallet cannot cover", async () => {
    const old = await runRow(31);
    await env.DB.prepare(
      `INSERT INTO ledger_entries (owner_id, amount, balance, reason)
       SELECT ?, -balance, 0, 'solve' FROM ledger_entries WHERE owner_id = ? ORDER BY seq DESC LIMIT 1`,
    )
      .bind(aliceId, aliceId)
      .run();
    const response = await call("POST", `/api/runs/${old}/rerun`, alice);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toContain("wallet");
  });
});
