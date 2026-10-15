// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  type IsotropicMaterial,
  materialLibrary,
  validateMaterialResponse,
  validateMaterialsResponse,
} from "@clearfea/spec";
import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

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

async function list(cookie: string) {
  const response = await call("GET", "/api/materials", { cookie });
  expect(response.status).toBe(200);
  const checked = validateMaterialsResponse(await response.json());
  if (!checked.ok) throw new Error(checked.errors.join(" "));
  return checked.value;
}

async function save(cookie: string, material: IsotropicMaterial): Promise<Response> {
  return call("POST", "/api/materials", { json: { material }, cookie });
}

const steel: IsotropicMaterial = {
  id: "material-1",
  name: "Bracket steel",
  model: "isotropic_elastic",
  youngsModulus: { value: 205, unit: "GPa" },
  poissonsRatio: 0.29,
  density: { value: 7.85, unit: "g/cm³" },
  thermalExpansion: null,
  source: "Supplier test certificate 1234",
};

let alice = "";
let bob = "";

beforeAll(async () => {
  const statements = env.TEST_SEED.flatMap((file) => file.queries);
  await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
  alice = await signIn("alice", "alice-local");
  bob = await signIn("bob", "bob-local");
});

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM materials").run();
});

describe("materials", () => {
  it("need a signed-in user", async () => {
    expect((await call("GET", "/api/materials")).status).toBe(401);
    expect((await call("POST", "/api/materials", { json: { material: steel } })).status).toBe(401);
    expect((await call("DELETE", "/api/materials/x")).status).toBe(401);
  });

  it("lists the library, with its sources, and no custom materials at first", async () => {
    const { library, custom } = await list(alice);
    expect(library).toEqual(materialLibrary.materials);
    expect(library.every((m) => m.source?.startsWith("MIL-HDBK-5G"))).toBe(true);
    expect(custom).toEqual([]);
  });

  it("saves a user's material under a new id, as entered, for that user only", async () => {
    const response = await save(alice, steel);
    expect(response.status).toBe(201);
    const checked = validateMaterialResponse(await response.json());
    if (!checked.ok) throw new Error(checked.errors.join(" "));
    const saved = checked.value.material;
    expect(saved.id).not.toBe(steel.id);
    expect(saved).toEqual({ ...steel, id: saved.id });
    expect((await list(alice)).custom).toEqual([saved]);
    expect((await list(bob)).custom).toEqual([]);
  });

  it("lists a user's materials by name", async () => {
    for (const name of ["b steel", "A steel", "c steel"]) expect((await save(alice, { ...steel, name })).status).toBe(201);
    expect((await list(alice)).custom.map((m) => m.name)).toEqual(["A steel", "b steel", "c steel"]);
  });

  it("refuses a second material of the same name, but not another user's", async () => {
    expect((await save(alice, steel)).status).toBe(201);
    const again = await save(alice, steel);
    expect(again.status).toBe(409);
    expect((await again.json<{ error: string }>()).error).toBe(
      'You already have a material named "Bracket steel". Rename this one, or delete the saved one first.',
    );
    expect((await save(bob, steel)).status).toBe(201);
  });

  it("refuses a material without a modulus or Poisson's ratio, or with a wrong unit", async () => {
    const missing = await save(alice, { ...steel, youngsModulus: null, poissonsRatio: null });
    expect(missing.status).toBe(400);
    expect((await missing.json<{ error: string }>()).error).toBe(
      `Enter Young's modulus and Poisson's ratio of material "Bracket steel" before saving it.`,
    );
    const wrong = await save(alice, { ...steel, density: { value: 7.85, unit: "MPa" } });
    expect(wrong.status).toBe(400);
    expect((await wrong.json<{ error: string }>()).error).toMatch(/^The density of material "Bracket steel" is given in "MPa"/);
    const malformed = await call("POST", "/api/materials", { json: { material: { name: "x" } }, cookie: alice });
    expect(malformed.status).toBe(400);
    expect((await list(alice)).custom).toEqual([]);
  });

  it("deletes a user's own material only", async () => {
    const saved = (await (await save(alice, steel)).json<{ material: IsotropicMaterial }>()).material;
    expect((await call("DELETE", `/api/materials/${saved.id}`, { cookie: bob })).status).toBe(404);
    expect((await list(alice)).custom).toHaveLength(1);
    expect((await call("DELETE", `/api/materials/${saved.id}`, { cookie: alice })).status).toBe(204);
    expect((await list(alice)).custom).toEqual([]);
    expect((await call("DELETE", `/api/materials/${saved.id}`, { cookie: alice })).status).toBe(404);
    expect((await call("DELETE", "/api/materials/lib-al-6061", { cookie: alice })).status).toBe(404);
  });
});
