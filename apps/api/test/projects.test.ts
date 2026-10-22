// SPDX-License-Identifier: AGPL-3.0-or-later
import { type ProjectView, unitsTable, validateProjectResponse } from "@clearfea/spec";
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

async function projectOf(response: Response): Promise<ProjectView> {
  expect(response.status).toBe(200);
  const checked = validateProjectResponse(await response.json());
  if (!checked.ok) throw new Error(checked.errors.join(" "));
  return checked.value.project;
}

let alice = "";
let bob = "";

beforeAll(async () => {
  const statements = env.TEST_SEED.flatMap((file) => file.queries);
  await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
  alice = await signIn("alice", "alice-local");
  bob = await signIn("bob", "bob-local");
});

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM projects").run();
});

describe("the user's project", () => {
  it("needs a signed-in user", async () => {
    expect((await call("GET", "/api/project")).status).toBe(401);
    expect((await call("PATCH", "/api/project", { json: { unitSystem: "si" } })).status).toBe(401);
  });

  it("is made on first use with the table's default unit system, once", async () => {
    const first = await projectOf(await call("GET", "/api/project", { cookie: alice }));
    expect(first).toMatchObject({ name: "My first project", unitSystem: unitsTable.defaultSystem });
    const again = await projectOf(await call("GET", "/api/project", { cookie: alice }));
    expect(again.id).toBe(first.id);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM projects").first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("makes one project even when two first requests arrive together", async () => {
    const users = await env.DB.prepare("SELECT id FROM users WHERE login = 'alice'").first<{ id: string }>();
    const userId = users?.id ?? "";
    const [a, b] = await Promise.all([userProject(env.DB, userId), userProject(env.DB, userId)]);
    expect(a.id).toBe(b.id);
  });

  it("keeps the unit system the user chooses, for that user only", async () => {
    const changed = await projectOf(await call("PATCH", "/api/project", { json: { unitSystem: "us-in" }, cookie: alice }));
    expect(changed.unitSystem).toBe("us-in");
    expect((await projectOf(await call("GET", "/api/project", { cookie: alice }))).unitSystem).toBe("us-in");
    const bobs = await projectOf(await call("GET", "/api/project", { cookie: bob }));
    expect(bobs.unitSystem).toBe(unitsTable.defaultSystem);
    expect(bobs.id).not.toBe(changed.id);
  });

  it("refuses a unit system the table does not list, naming the ones it does", async () => {
    const response = await call("PATCH", "/api/project", { json: { unitSystem: "imperial" }, cookie: alice });
    expect(response.status).toBe(400);
    const { error } = await response.json<{ error: string }>();
    expect(error).toBe("'imperial' is not a unit system. Use one of: metric-mm, si, us-in.");
    const malformed = await call("PATCH", "/api/project", { json: { system: "si" }, cookie: alice });
    expect(malformed.status).toBe(400);
  });

  it("shows a stored system that the table no longer lists as the default", async () => {
    await call("GET", "/api/project", { cookie: alice });
    await env.DB.prepare("UPDATE projects SET default_unit_system = 'retired'").run();
    expect((await projectOf(await call("GET", "/api/project", { cookie: alice }))).unitSystem).toBe(
      unitsTable.defaultSystem,
    );
  });
});
