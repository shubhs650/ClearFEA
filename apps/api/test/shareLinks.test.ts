// SPDX-License-Identifier: AGPL-3.0-or-later
// Read-only share links of runs (M8.7, ADR-083): made, read and revoked by the run's owner;
// opened by anyone holding the link, for the run's results only, until the link is revoked.
import {
  type SimulationSpec,
  validateCreatedShareLinkResponse,
  validateShareLinkResponse,
  validateSharedRunResponse,
} from "@clearfea/spec";
import fixture from "@clearfea/spec/fixtures/simulation-v1.json";
import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashShareToken } from "../src/db/shareLinks";
import { LINK_NOT_WORKING } from "../src/routes/shareLinks";

function call(method: string, path: string, cookie?: string): Promise<Response> {
  return exports.default.fetch(`http://localhost${path}`, { method, headers: cookie ? { Cookie: cookie } : {} });
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

const RESULT = { nodes: 100, software: { calculix: "2.21" } };
const RUN_FILES = ["surface.bin", "fields.bin", "nodes.bin", "deck.inp", "solver.log"];

/** Alice's run of the fixture's setup, in the given state, with its job, mesh and stored files. */
async function runRow(status: "succeeded" | "solving" | "failed"): Promise<string> {
  const id = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const meshId = crypto.randomUUID();
  const done = status !== "solving";
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO jobs (id, owner_id, type, target_id, status) VALUES (?, ?, 'solve', ?, ?)`).bind(
      jobId,
      aliceId,
      id,
      done ? status : "running",
    ),
    env.DB.prepare(
      `INSERT INTO meshes (id, owner_id, geometry_id, size, element_order, status, node_count, element_count)
       VALUES (?, ?, ?, '{"value":5,"unit":"mm"}', 2, 'ready', 100, 40)`,
    ).bind(meshId, aliceId, geometryId),
    env.DB.prepare(
      `INSERT INTO runs (id, owner_id, simulation_id, mesh_id, spec, status, job_id, files, result, problem)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      aliceId,
      simulationId,
      meshId,
      JSON.stringify({ ...fixture, geometryId }),
      status,
      jobId,
      done ? JSON.stringify(RUN_FILES) : null,
      status === "succeeded" ? JSON.stringify(RESULT) : null,
      status === "failed" ? "The setup could not be solved." : null,
    ),
  ]);
  for (const name of RUN_FILES) await env.FILES.put(`owners/${aliceId}/runs/${id}/${name}`, `${name} content`);
  await env.FILES.put(`owners/${aliceId}/meshes/${meshId}/mesh.bin`, "mesh.bin content");
  return id;
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM share_links"),
    env.DB.prepare("DELETE FROM runs"),
    env.DB.prepare("DELETE FROM meshes"),
    env.DB.prepare("DELETE FROM jobs"),
    env.DB.prepare("DELETE FROM simulations"),
    env.DB.prepare("DELETE FROM geometries"),
  ]);
  geometryId = crypto.randomUUID();
  simulationId = crypto.randomUUID();
  const spec: SimulationSpec = { ...(JSON.parse(JSON.stringify(fixture)) as SimulationSpec), geometryId };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO geometries (id, owner_id, name, size_bytes, status, detected_unit, reading_factor,
         confirmed_unit, scaling, body_count, face_count)
       VALUES (?, ?, 'block.step', 100, 'ready', 'mm', 0.001, 'mm', 1, 1, 6)`,
    ).bind(geometryId, aliceId),
    env.DB.prepare(
      `INSERT INTO simulations (id, owner_id, geometry_id, name, analysis_type, spec_version, spec)
       VALUES (?, ?, ?, 'Bracket', 'linear_static', 1, ?)`,
    ).bind(simulationId, aliceId, geometryId, JSON.stringify(spec)),
  ]);
  await env.FILES.put(`owners/${aliceId}/geometries/${geometryId}/topology.json`, '{"faces":[]}');
});

/** Makes a link for the run as alice and answers its token. */
async function share(runId: string): Promise<string> {
  const response = await call("POST", `/api/runs/${runId}/share`, alice);
  expect(response.status).toBe(201);
  const checked = validateCreatedShareLinkResponse(await response.json());
  if (!checked.ok) throw new Error(checked.errors.join(" "));
  return checked.value.token;
}

async function shareOf(runId: string, cookie = alice) {
  const response = await call("GET", `/api/runs/${runId}/share`, cookie);
  expect(response.status).toBe(200);
  const checked = validateShareLinkResponse(await response.json());
  if (!checked.ok) throw new Error(checked.errors.join(" "));
  return checked.value.share;
}

async function notWorking(response: Response): Promise<void> {
  expect(response.status).toBe(404);
  expect(((await response.json()) as { error: string }).error).toBe(LINK_NOT_WORKING);
}

const SHARED_FILES = [
  ["surface", "surface.bin content"],
  ["fields", "fields.bin content"],
  ["mesh", "mesh.bin content"],
  ["nodes", "nodes.bin content"],
  ["topology", '{"faces":[]}'],
] as const;

describe("a run's share link", () => {
  it("opens the run's results without signing in, and nothing of the owner's account", async () => {
    const runId = await runRow("succeeded");
    expect(await shareOf(runId)).toBeNull();
    const token = await share(runId);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await shareOf(runId))?.createdAt).toMatch(/^\d{4}-\d\d-\d\dT/);

    const response = await call("GET", `/api/shared/${token}`);
    expect(response.status).toBe(200);
    const checked = validateSharedRunResponse(await response.json());
    if (!checked.ok) throw new Error(checked.errors.join(" "));
    expect(checked.value.simulationName).toBe("Bracket");
    expect(checked.value.unitSystem).toBe("metric-mm");
    expect(checked.value.run.id).toBe(runId);
    expect(checked.value.run.result).toEqual(RESULT);
    // The owner's machine, estimate and cost are not part of what is shared.
    expect(Object.keys(checked.value.run)).not.toContain("cost");
    expect(Object.keys(checked.value.run)).not.toContain("machine");

    for (const [file, content] of SHARED_FILES) {
      const got = await call("GET", `/api/shared/${token}/${file}`);
      expect(got.status, file).toBe(200);
      expect(new TextDecoder().decode(await got.arrayBuffer())).toBe(content);
    }
    // The solver input and log, and the owner's routes, stay the owner's.
    for (const path of [`/api/shared/${token}/files/deck.inp`, `/api/shared/${token}/log`]) {
      expect((await call("GET", path)).status).toBe(404);
    }
    expect((await call("GET", `/api/runs/${runId}`)).status).toBe(401);
  });

  it("stores only the hash of the token", async () => {
    const runId = await runRow("succeeded");
    const token = await share(runId);
    const rows = await env.DB.prepare("SELECT * FROM share_links").all<Record<string, string>>();
    expect(rows.results).toHaveLength(1);
    expect(JSON.stringify(rows.results)).not.toContain(token);
    expect(rows.results[0]?.token_hash).toBe(await hashShareToken(token));
  });

  it("stops working when the owner revokes it", async () => {
    const runId = await runRow("succeeded");
    const token = await share(runId);
    const revoked = await call("DELETE", `/api/runs/${runId}/share`, alice);
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toEqual({ share: null });
    expect(await shareOf(runId)).toBeNull();
    await notWorking(await call("GET", `/api/shared/${token}`));
    for (const [file] of SHARED_FILES) await notWorking(await call("GET", `/api/shared/${token}/${file}`));
    // Revoking again changes nothing.
    expect((await call("DELETE", `/api/runs/${runId}/share`, alice)).status).toBe(200);
  });

  it("is replaced by a new link, and the old one stops working", async () => {
    const runId = await runRow("succeeded");
    const first = await share(runId);
    const second = await share(runId);
    expect(second).not.toBe(first);
    await notWorking(await call("GET", `/api/shared/${first}`));
    expect((await call("GET", `/api/shared/${second}`)).status).toBe(200);
  });

  it("opens only its own run", async () => {
    const one = await runRow("succeeded");
    const other = await runRow("succeeded");
    const token = await share(one);
    const response = await call("GET", `/api/shared/${token}`);
    expect(((await response.json()) as { run: { id: string } }).run.id).toBe(one);
    expect((await call("GET", `/api/shared/${token}/${other}`)).status).toBe(404);
  });

  it("answers a mistyped or made-up token like a revoked one", async () => {
    const runId = await runRow("succeeded");
    const token = await share(runId);
    await notWorking(await call("GET", `/api/shared/${token.slice(0, -1)}`));
    const changed = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    await notWorking(await call("GET", `/api/shared/${changed}`));
    await notWorking(await call("GET", `/api/shared/${"A".repeat(43)}`));
    await notWorking(await call("GET", `/api/shared/${await hashShareToken(token)}`));
  });

  it("is made only for a succeeded run", async () => {
    for (const status of ["solving", "failed"] as const) {
      const runId = await runRow(status);
      const response = await call("POST", `/api/runs/${runId}/share`, alice);
      expect(response.status, status).toBe(409);
    }
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM share_links").first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it("is made, read and revoked only by the run's owner", async () => {
    const runId = await runRow("succeeded");
    const token = await share(runId);
    for (const method of ["GET", "POST", "DELETE"]) {
      const response = await call(method, `/api/runs/${runId}/share`, bob);
      expect(response.status, method).toBe(404);
      expect(((await response.json()) as { error: string }).error).toBe("There is no run with that id in your account.");
      expect((await call(method, `/api/runs/${runId}/share`)).status, method).toBe(401);
    }
    // Bob's attempts left alice's link working.
    expect((await call("GET", `/api/shared/${token}`)).status).toBe(200);
  });
});
