// SPDX-License-Identifier: AGPL-3.0-or-later
// The dashboard's Users, Settings and Costs tabs (M13.3, ADR-113, ADR-128): every setting listed
// and editable within its range, each change recorded in the event log; each user's jobs this
// month; one month's machine time and charges by user and job type beside the beta's fixed costs.
import { validateAdminResponse, validateCostsResponse, validateSettingsResponse } from "@clearfea/spec";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { currentMonth } from "../src/db/costs";
import { SETTINGS } from "../src/db/settings";
import type { Env } from "../src/env";
import { app } from "../src/index";

const BINDINGS: Env = { ...env, ADMIN_EMAIL: "alice@clearfea.test" };
const ALICE = "00000000-0000-4000-8000-00000000a11c";
const BOB = "00000000-0000-4000-8000-000000000b0b";

function call(method: string, path: string, options: { json?: unknown; cookie?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.json !== undefined) headers["Content-Type"] = "application/json";
  if (options.cookie) headers.Cookie = options.cookie;
  const body = options.json !== undefined ? JSON.stringify(options.json) : undefined;
  return Promise.resolve(app.request(`http://localhost${path}`, { method, headers, body }, BINDINGS));
}

let alice = "";
let bob = "";

async function signIn(login: string, password: string): Promise<string> {
  const response = await call("POST", "/api/session", { json: { login, password } });
  expect(response.status).toBe(200);
  return (response.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
}

async function settings(response?: Response) {
  const answer = validateSettingsResponse(await (response ?? (await call("GET", "/api/admin/settings", { cookie: alice }))).json());
  if (!answer.ok) throw new Error(answer.errors.join("; "));
  return answer.value.settings;
}

const put = (name: string, value: unknown) => call("PUT", `/api/admin/settings/${name}`, { cookie: alice, json: { value } });

async function actions(): Promise<unknown[]> {
  const { results } = await env.DB.prepare(
    "SELECT message, json_extract(detail, '$.name') AS name, json_extract(detail, '$.from') AS 'from', json_extract(detail, '$.to') AS 'to' FROM events WHERE kind = 'admin_action' ORDER BY id",
  ).all();
  return results;
}

beforeAll(async () => {
  const statements = env.TEST_SEED.flatMap((file) => file.queries);
  await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
  alice = await signIn("alice", "alice-local");
  bob = await signIn("bob", "bob-local");
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM events"),
    env.DB.prepare("DELETE FROM ledger_entries WHERE amount < 0"),
    env.DB.prepare("DELETE FROM jobs"),
  ]);
});

describe("the Settings tab (M13.3)", () => {
  it("lists every row of settings but the queue pause, with its value and range", async () => {
    const { results } = await env.DB.prepare("SELECT name, value FROM settings ORDER BY name").all<{
      name: string;
      value: number;
    }>();
    const listed = await settings();
    expect(listed.map((s) => s.name).sort()).toEqual(results.map((r) => r.name).filter((n) => n !== "queue_paused"));
    for (const setting of listed) {
      expect(setting.value).toBe(results.find((r) => r.name === setting.name)?.value);
      expect(setting.min).toBeLessThanOrEqual(setting.value);
      expect(setting.max).toBeGreaterThanOrEqual(setting.value);
    }
    expect(listed.find((s) => s.name === "storage_free_bytes")).toMatchObject({ unit: "GiB", scale: 2 ** 30, value: 5 * 2 ** 30 });
    expect(listed.find((s) => s.name === "solver_host_monthly_cents")).toMatchObject({ group: "costs", unit: "USD", value: 1700 });
    expect(SETTINGS.map((s) => s.name)).toEqual(listed.map((s) => s.name));
  });

  it("changes a setting within its range and records who changed what", async () => {
    const changed = await settings(await put("trash_retention_days", 14));
    expect(changed.find((s) => s.name === "trash_retention_days")?.value).toBe(14);
    expect((await put("storage_free_bytes", 10 * 2 ** 30)).status).toBe(200);
    expect((await put("solver_host_monthly_cents", 1850)).status).toBe(200);
    // The same value again changes nothing and is not recorded.
    expect((await put("trash_retention_days", 14)).status).toBe(200);
    expect(await actions()).toEqual([
      { message: 'Changed "Days in the trash" from 30 days to 14 days.', name: "trash_retention_days", from: 30, to: 14 },
      {
        message: 'Changed "Free storage per user" from 5 GiB to 10 GiB.',
        name: "storage_free_bytes",
        from: 5 * 2 ** 30,
        to: 10 * 2 ** 30,
      },
      { message: 'Changed "Solver host per month" from 17 USD to 18.5 USD.', name: "solver_host_monthly_cents", from: 1700, to: 1850 },
    ]);
    const row = await env.DB.prepare("SELECT value FROM settings WHERE name = 'trash_retention_days'").first<{ value: number }>();
    expect(row?.value).toBe(14);
    for (const [name, value] of [
      ["trash_retention_days", 30],
      ["storage_free_bytes", 5 * 2 ** 30],
      ["solver_host_monthly_cents", 1700],
    ] as const) {
      expect((await put(name, value)).status).toBe(200);
    }
  });

  it("refuses a value out of range, not whole, of the wrong type or for an unknown setting, changing nothing", async () => {
    const before = await settings();
    for (const value of [0, 3651, 2.5, "30", null]) {
      const refused = await put("trash_retention_days", value);
      expect(refused.status).toBe(400);
      expect(((await refused.json()) as { error: string }).error).toBe(
        'Give "Days in the trash" a value from 1 days to 3650 days. Nothing was changed.',
      );
    }
    expect((await put("queue_paused", 1)).status).toBe(404);
    expect((await put("no_such_setting", 1)).status).toBe(404);
    expect(await settings()).toEqual(before);
    expect(await actions()).toEqual([]);
  });

  it("answers anyone but the admin as an unknown address", async () => {
    expect((await call("GET", "/api/admin/settings", { cookie: bob })).status).toBe(404);
    expect((await call("PUT", "/api/admin/settings/trash_retention_days", { cookie: bob, json: { value: 1 } })).status).toBe(404);
    expect((await call("GET", "/api/admin/costs", { cookie: bob })).status).toBe(404);
  });
});

/** A finished job of `owner`'s with its billed time and, when `cost` is set, its charge. */
async function finished(id: string, owner: string, type: string, status: string, seconds: number, cost: number, at: string) {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO jobs (id, owner_id, type, status, created_at, finished_at, billed_seconds, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, owner, type, status, at, at, seconds, cost),
    ...(cost === 0
      ? []
      : [
          env.DB.prepare(
            "INSERT INTO ledger_entries (owner_id, amount, balance, reason, job_id, created_at) VALUES (?, ?, 0, ?, ?, ?)",
          ).bind(owner, -cost, type, id, at),
        ]),
  ]);
}

describe("the Users tab (M13.3)", () => {
  it("counts each user's jobs and failed jobs that finished this month", async () => {
    const now = new Date().toISOString();
    await finished("a1", ALICE, "solve", "succeeded", 100, 0, now);
    await finished("a2", ALICE, "mesh", "failed", 20, 0, now);
    await finished("a3", ALICE, "mesh", "failed", 20, 0, "2020-01-15T00:00:00.000Z");
    const answer = validateAdminResponse(await (await call("GET", "/api/admin", { cookie: alice })).json());
    if (!answer.ok) throw new Error(answer.errors.join("; "));
    const users = answer.value.users;
    expect(users.find((u) => u.id === ALICE)).toMatchObject({ machineSecondsThisMonth: 120, jobsThisMonth: 2, failedJobsThisMonth: 1 });
    expect(users.find((u) => u.id === BOB)).toMatchObject({ machineSecondsThisMonth: 0, jobsThisMonth: 0, failedJobsThisMonth: 0 });
  });
});

describe("the Costs tab (M13.3)", () => {
  async function costs(query = "") {
    const response = await call("GET", `/api/admin/costs${query}`, { cookie: alice });
    expect(response.status).toBe(200);
    const answer = validateCostsResponse(await response.json());
    if (!answer.ok) throw new Error(answer.errors.join("; "));
    return answer.value;
  }

  it("sums one month's machine time and charges by user and by job type", async () => {
    await finished("a1", ALICE, "solve", "succeeded", 3000, 500_000, "2026-09-10T12:00:00.000Z");
    await finished("a2", ALICE, "mesh", "succeeded", 600, 100_000, "2026-09-11T12:00:00.000Z");
    await finished("b1", BOB, "solve", "failed", 0, 0, "2026-09-30T23:59:59.999Z");
    await finished("b2", BOB, "solve", "succeeded", 900, 150_000, "2026-10-01T00:00:00.000Z");
    await env.DB.prepare(
      "INSERT INTO ledger_entries (owner_id, amount, balance, reason, created_at) VALUES (?, -2000, 0, 'storage', '2026-09-20T03:00:00.000Z')",
    )
      .bind(BOB)
      .run();

    const september = await costs("?month=2026-09");
    expect(september).toMatchObject({ month: "2026-09", solverHostCents: 1700, platformCents: 500 });
    expect(september.totals).toEqual({
      jobs: 3,
      solveRuns: 2,
      machineSeconds: 3600,
      jobMicroCredits: 600_000,
      storageMicroCredits: 2000,
    });
    expect(september.byUser.map((u) => [u.email, u.jobs, u.solveRuns, u.machineSeconds, u.jobMicroCredits, u.storageMicroCredits])).toEqual([
      ["alice@clearfea.test", 2, 1, 3600, 600_000, 0],
      ["bob@clearfea.test", 1, 1, 0, 0, 2000],
    ]);
    expect(september.byType).toEqual([
      { type: "solve", jobs: 2, machineSeconds: 3000, jobMicroCredits: 500_000 },
      { type: "mesh", jobs: 1, machineSeconds: 600, jobMicroCredits: 100_000 },
    ]);

    const october = await costs("?month=2026-10");
    expect(october.totals).toMatchObject({ jobs: 1, machineSeconds: 900, jobMicroCredits: 150_000 });
    expect(october.byUser.map((u) => u.userId)).toEqual([BOB]);
    expect((await costs("?month=2020-01")).byUser).toEqual([]);
  });

  it("reads this month by default and refuses a month it cannot read", async () => {
    expect((await costs()).month).toBe(currentMonth());
    for (const month of ["2026-13", "2026-9", "october", "2026-10-01"]) {
      const refused = await call("GET", `/api/admin/costs?month=${month}`, { cookie: alice });
      expect(refused.status).toBe(400);
    }
  });
});
