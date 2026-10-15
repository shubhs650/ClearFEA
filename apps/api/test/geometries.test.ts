// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  type ClaimResponse,
  type GeometryView,
  type ImportResult,
  validateClaimResponse,
  validateGeometryListResponse,
  validateGeometryResponse,
} from "@clearfea/spec";
import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getJob } from "../src/db/jobs";

const TOKEN = "test-worker-token";
const STEP = "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n";

function call(
  method: string,
  path: string,
  options: { json?: unknown; raw?: BodyInit; type?: string; cookie?: string; token?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.json !== undefined) headers["Content-Type"] = "application/json";
  if (options.type) headers["Content-Type"] = options.type;
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
    env.DB.prepare("DELETE FROM geometries"),
    env.DB.prepare("DELETE FROM jobs"),
  ]);
});

async function upload(cookie = alice, content: string = STEP, name = "bracket.step") {
  return call("POST", `/api/geometries?name=${encodeURIComponent(name)}`, {
    raw: content,
    type: "application/octet-stream",
    cookie,
  });
}

async function uploaded(cookie = alice): Promise<GeometryView> {
  const response = await upload(cookie);
  expect(response.status).toBe(201);
  const body = validateGeometryResponse(await response.json());
  if (!body.ok) throw new Error(body.errors.join(" "));
  return body.value.geometry;
}

async function geometry(id: string, cookie = alice): Promise<GeometryView> {
  const body = validateGeometryResponse(await (await call("GET", `/api/geometries/${id}`, { cookie })).json());
  if (!body.ok) throw new Error(body.errors.join(" "));
  return body.value.geometry;
}

async function claim(workerId = "w1"): Promise<ClaimResponse["job"]> {
  const response = await call("POST", "/internal/jobs/claim", {
    json: { workerId, jobTypes: ["import"] },
    token: TOKEN,
  });
  expect(response.status).toBe(200);
  const body = validateClaimResponse(await response.json());
  if (!body.ok) throw new Error(body.errors.join(" "));
  return body.value.job;
}

function transferPath(job: ClaimResponse["job"], name: string): string {
  const url = job.transfers.find((t) => t.name === name)?.url;
  if (url === undefined) throw new Error(`no transfer for ${name}`);
  const parsed = new URL(url);
  return parsed.pathname + parsed.search;
}

function result(overrides: Partial<ImportResult["unit"]> = {}, scaling = 1): ImportResult {
  return {
    unit: {
      declared: "SI_UNIT(.MILLI.,.METRE.)",
      detectedUnit: "mm",
      problem: null,
      readingFactor: 0.001,
      ...overrides,
    },
    scaling,
    bodies: 1,
    faces: 7,
    size: 0.113,
    bbox: [0, 0, 0, 0.1, 0.05, 0.02],
    displayTriangles: 1200,
  };
}

/** Plays the worker: claims the import, uploads both outputs, reports success. */
async function runImport(importResult: ImportResult = result(), workerId = "w1") {
  const job = await claim(workerId);
  for (const name of ["topology.json", "display.bin"]) {
    const put = await call("PUT", transferPath(job, name), {
      raw: `${name} content`,
      type: "application/octet-stream",
      token: TOKEN,
    });
    expect(put.status).toBe(200);
  }
  const done = await call("POST", `/internal/jobs/${job.id}/complete`, {
    json: { workerId, status: "succeeded", result: importResult },
    token: TOKEN,
  });
  expect(done.status).toBe(200);
  return job;
}

describe("uploading a STEP file", () => {
  it("needs a signed-in user", async () => {
    expect((await upload("")).status).toBe(401);
  });

  it("stores the file and queues its import", async () => {
    const created = await uploaded();
    expect(created).toMatchObject({ name: "bracket.step", status: "importing", sizeBytes: STEP.length });
    const stored = await env.FILES.get(`owners/${aliceId}/geometries/${created.id}/model.step`);
    expect(await stored?.text()).toBe(STEP);
    const job = await claim();
    expect(job).toMatchObject({ type: "import", targetId: created.id, params: { confirmedUnit: null } });
    expect(job.transfers.map((t) => [t.name, t.direction])).toEqual([
      ["model.step", "download"],
      ["topology.json", "upload"],
      ["display.bin", "upload"],
    ]);
  });

  it("refuses a body that is not a STEP file, or not sent as a file", async () => {
    const notStep = await upload(alice, "solid cube\nendsolid cube\n");
    expect(notStep.status).toBe(400);
    expect((await notStep.json<{ error: string }>()).error).toContain("not a STEP file");
    const asForm = await call("POST", "/api/geometries?name=a.step", {
      raw: STEP,
      type: "text/plain",
      cookie: alice,
    });
    expect(asForm.status).toBe(415);
    const unnamed = await call("POST", "/api/geometries", {
      raw: STEP,
      type: "application/octet-stream",
      cookie: alice,
    });
    expect(unnamed.status).toBe(400);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM geometries").first<{ n: number }>())?.n).toBe(0);
  });

  it("keeps only the file's own name", async () => {
    const response = await upload(alice, STEP, "C:\\parts\\flange.stp");
    expect((await response.json<{ geometry: GeometryView }>()).geometry.name).toBe("flange.stp");
  });
});

describe("the import job", () => {
  it("leaves a detected unit for the user to confirm", async () => {
    const created = await uploaded();
    await runImport();
    expect(await geometry(created.id)).toMatchObject({
      status: "unconfirmed",
      detectedUnit: "mm",
      declaredUnit: "SI_UNIT(.MILLI.,.METRE.)",
      confirmedUnit: null,
      bodyCount: 1,
      faceCount: 7,
      bbox: [0, 0, 0, 0.1, 0.05, 0.02],
    });
    const topology = await call("GET", `/api/geometries/${created.id}/topology`, { cookie: alice });
    expect(topology.status).toBe(200);
    expect(topology.headers.get("Content-Type")).toBe("application/json");
    expect(await topology.text()).toBe("topology.json content");
    const display = await call("GET", `/api/geometries/${created.id}/display`, { cookie: alice });
    expect(await display.text()).toBe("display.bin content");
  });

  it("asks for a unit when the file declares none", async () => {
    const created = await uploaded();
    await runImport(
      result({ declared: null, detectedUnit: null, problem: "No unit.", readingFactor: 1 }),
    );
    expect(await geometry(created.id)).toMatchObject({ status: "needs_unit", unitProblem: "No unit." });
  });

  it("serves the STEP file only to the worker holding the job", async () => {
    await uploaded();
    const job = await claim("w1");
    const path = transferPath(job, "model.step");
    const download = await call("GET", path, { token: TOKEN });
    expect(await download.text()).toBe(STEP);
    expect((await call("GET", path.replace("worker=w1", "worker=w2"), { token: TOKEN })).status).toBe(404);
    expect((await call("GET", path)).status).toBe(401);
    // A name the job does not have, or the wrong direction, is refused.
    expect((await call("GET", transferPath(job, "topology.json"), { token: TOKEN })).status).toBe(404);
    const put = await call("PUT", path, { raw: "x", type: "application/octet-stream", token: TOKEN });
    expect(put.status).toBe(404);
  });

  it("records the user's fault with the worker's explanation", async () => {
    const created = await uploaded();
    const job = await claim();
    await call("POST", `/internal/jobs/${job.id}/complete`, {
      json: {
        workerId: "w1",
        status: "failed",
        failureCategory: "user_fault",
        failureCause: "no_solids",
        failureMessage: "The file contains no solid bodies.",
      },
      token: TOKEN,
    });
    expect(await geometry(created.id)).toMatchObject({
      status: "failed",
      problem: "The file contains no solid bodies.",
    });
    expect((await getJob(env.DB, aliceId, job.id))?.failureMessage).toBe(
      "The file contains no solid bodies.",
    );
    expect((await call("GET", `/api/geometries/${created.id}/topology`, { cookie: alice })).status).toBe(409);
  });

  it("turns a success without its output files into a platform fault", async () => {
    const created = await uploaded();
    const job = await claim();
    await call("POST", `/internal/jobs/${job.id}/complete`, {
      json: { workerId: "w1", status: "succeeded", result: result() },
      token: TOKEN,
    });
    const stored = await getJob(env.DB, aliceId, job.id);
    expect(stored).toMatchObject({ status: "failed", failureCategory: "platform_fault", failureCause: "outputs_missing" });
    const failed = await geometry(created.id);
    expect(failed.status).toBe("failed");
    expect(failed.problem).toContain("not in your file");
  });

  it("turns a malformed result into a platform fault", async () => {
    await uploaded();
    const job = await claim();
    await call("POST", `/internal/jobs/${job.id}/complete`, {
      json: { workerId: "w1", status: "succeeded", result: { faces: "seven" } },
      token: TOKEN,
    });
    expect((await getJob(env.DB, aliceId, job.id))?.failureCause).toBe("invalid_result");
  });
});

describe("confirming the unit", () => {
  async function setUnit(id: string, unit: string, cookie = alice) {
    return call("POST", `/api/geometries/${id}/unit`, { json: { unit }, cookie });
  }

  it("makes the geometry ready without a new import when the unit is the detected one", async () => {
    const created = await uploaded();
    await runImport();
    const response = await setUnit(created.id, "mm");
    expect(response.status).toBe(200);
    expect((await response.json<{ geometry: GeometryView }>()).geometry).toMatchObject({
      status: "ready",
      confirmedUnit: "mm",
    });
    const pending = await env.DB.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status = 'queued'").first<{ n: number }>();
    expect(pending?.n).toBe(0);
  });

  it("imports the file again at a corrected unit", async () => {
    const created = await uploaded();
    await runImport();
    const response = await setUnit(created.id, "in");
    expect((await response.json<{ geometry: GeometryView }>()).geometry).toMatchObject({
      status: "importing",
      confirmedUnit: "in",
    });
    const job = await runImport(result({}, 25.4));
    expect(job.params).toEqual({ confirmedUnit: "in" });
    expect(await geometry(created.id)).toMatchObject({ status: "ready", confirmedUnit: "in" });
  });

  it("ignores a late answer from an older import", async () => {
    const created = await uploaded();
    const first = await claim("w1");
    // The first import is still running when another one is queued (simulated directly).
    await env.DB.prepare("UPDATE geometries SET status = 'unconfirmed', scaling = 1, detected_unit = 'mm' WHERE id = ?")
      .bind(created.id)
      .run();
    await setUnit(created.id, "in");
    await call("POST", `/internal/jobs/${first.id}/complete`, {
      json: {
        workerId: "w1",
        status: "failed",
        failureCategory: "platform_fault",
        failureCause: "internal_error",
      },
      token: TOKEN,
    });
    expect((await geometry(created.id)).status).toBe("importing");
  });

  it("refuses units that are not lengths, and changes while importing", async () => {
    const created = await uploaded();
    const notLength = await setUnit(created.id, "MPa");
    expect(notLength.status).toBe(400);
    expect((await notLength.json<{ error: string }>()).error).toContain("not a length unit");
    expect((await setUnit(created.id, "mm")).status).toBe(409);
  });
});

describe("geometry isolation", () => {
  it("does not show one user's geometry to another", async () => {
    const created = await uploaded(alice);
    await runImport();
    const list = validateGeometryListResponse(
      await (await call("GET", "/api/geometries", { cookie: bob })).json(),
    );
    expect(list.ok && list.value.geometries).toEqual([]);
    for (const path of ["", "/topology", "/display"]) {
      const response = await call("GET", `/api/geometries/${created.id}${path}`, { cookie: bob });
      expect(response.status).toBe(404);
    }
    expect((await setUnit(created.id, "mm", bob)).status).toBe(404);
    const own = validateGeometryListResponse(
      await (await call("GET", "/api/geometries", { cookie: alice })).json(),
    );
    expect(own.ok && own.value.geometries.map((g) => g.id)).toEqual([created.id]);
  });

  async function setUnit(id: string, unit: string, cookie: string) {
    return call("POST", `/api/geometries/${id}/unit`, { json: { unit }, cookie });
  }
});
