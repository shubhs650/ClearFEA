// SPDX-License-Identifier: AGPL-3.0-or-later
// The admin's export of the dashboard's tables (M13.4, ADR-129): the CSV and Excel writers on their
// own, then the route: one table by date range, every table in one workbook, the tables as of now,
// the refusals, and nobody but the admin.
import { env } from "cloudflare:workers";
import { strFromU8, unzipSync } from "fflate";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { columnName, type Table, toCsv, toXlsx } from "../src/export/sheet";
import { EXPORT_TABLES } from "../src/export/tables";
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

/** The workbook's parts, as text. */
function parts(bytes: Uint8Array): Record<string, string> {
  return Object.fromEntries(Object.entries(unzipSync(bytes)).map(([name, data]) => [name, strFromU8(data)]));
}

/** A CSV answer's rows as cells, for files without quoted line breaks. */
async function csvRows(response: Response): Promise<string[][]> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  // The byte order mark, which decoding as UTF-8 drops.
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  return new TextDecoder()
    .decode(bytes)
    .split("\r\n")
    .filter((line) => line !== "")
    .map((line) => line.split(","));
}

const TABLE: Table = {
  sheet: "Jobs",
  columns: [
    { header: "Job", kind: "text" },
    { header: "Peak memory (bytes)", kind: "number" },
    { header: "Created (UTC)", kind: "time" },
    { header: "Out of memory", kind: "boolean" },
  ],
  rows: [
    ["j1", 1024, "2026-10-22T12:00:00.000Z", true],
    ['says "no", then\nstops', null, null, false],
    ["=HYPERLINK(\"http://x\")", -5, "not a time", null],
  ],
};

describe("the writers (M13.4)", () => {
  it("writes CSV with a byte order mark, quotes where needed and no formulas", () => {
    const text = toCsv(TABLE);
    expect(text).toBe(
      "\uFEFFJob,Peak memory (bytes),Created (UTC),Out of memory\r\n" +
        "j1,1024,2026-10-22T12:00:00.000Z,TRUE\r\n" +
        '"says ""no"", then\nstops",,,FALSE\r\n' +
        // Text that would run as a formula gets an apostrophe; a negative number stays a number.
        "\"'=HYPERLINK(\"\"http://x\"\")\",-5,not a time,\r\n",
    );
  });

  it("names columns as Excel does", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual([
      "A",
      "B",
      "Z",
      "AA",
      "AB",
      "AZ",
      "BA",
      "ZZ",
      "AAA",
    ]);
  });

  it("writes a workbook with typed cells, a bold frozen heading and a filter", () => {
    const files = parts(toXlsx([TABLE, { ...TABLE, sheet: "Jobs", rows: [] }, { ...TABLE, sheet: "a/b:c?" }]));
    expect(Object.keys(files).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
      "xl/worksheets/sheet3.xml",
    ]);
    // Sheet names are unique and without the characters Excel refuses.
    expect(files["xl/workbook.xml"]).toContain('<sheet name="Jobs" sheetId="1" r:id="rId1"/>');
    expect(files["xl/workbook.xml"]).toContain('<sheet name="Jobs 2" sheetId="2" r:id="rId2"/>');
    expect(files["xl/workbook.xml"]).toContain('<sheet name="a b c" sheetId="3" r:id="rId3"/>');
    expect(files["xl/workbook.xml"]).toContain("'Jobs'!$A$1:$D$4");
    const sheet = files["xl/worksheets/sheet1.xml"] ?? "";
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="1"><is><t>Job</t></is></c>');
    expect(sheet).toContain('<c r="B2"><v>1024</v></c>');
    // 2026-10-22 12:00 UTC is Excel day 46317.5.
    expect(sheet).toContain('<c r="C2" s="2"><v>46317.5</v></c>');
    expect(sheet).toContain('<c r="D2" t="b"><v>1</v></c>');
    expect(sheet).toContain('<c r="A3" t="inlineStr"><is><t>says &quot;no&quot;, then\nstops</t></is></c>');
    // Text is never a formula in a workbook, so it is kept as it is; a time that is not one stays text.
    expect(sheet).toContain("<t>=HYPERLINK(&quot;http://x&quot;)</t>");
    expect(sheet).toContain('<c r="C4" t="inlineStr"><is><t>not a time</t></is></c>');
    expect(sheet).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(sheet).toContain('<autoFilter ref="A1:D4"/>');
    expect(files["xl/worksheets/sheet2.xml"]).toContain('<dimension ref="A1:D1"/>');
  });

  it("leaves out characters XML does not allow and cuts text Excel cannot hold", () => {
    const table: Table = {
      sheet: "Log",
      columns: [{ header: "Line", kind: "text" }],
      rows: [["bell\u0007 & <tag> \uD800 tab\tok"], ["x".repeat(40_000)]],
    };
    const sheet = parts(toXlsx([table]))["xl/worksheets/sheet1.xml"] ?? "";
    expect(sheet).toContain("<t>bell &amp; &lt;tag&gt;  tab\tok</t>");
    expect(sheet).toContain(`<t>${"x".repeat(32_767)}</t>`);
    expect(sheet).not.toContain("x".repeat(32_768));
  });
});

describe("GET /api/admin/export (M13.4)", () => {
  beforeAll(async () => {
    const statements = env.TEST_SEED.flatMap((file) => file.queries);
    await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
    alice = await signIn("alice", "alice-local");
    bob = await signIn("bob", "bob-local");
  });

  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM events"),
      env.DB.prepare("DELETE FROM host_stats"),
      env.DB.prepare("DELETE FROM job_stats"),
      env.DB.prepare("DELETE FROM job_logs"),
      env.DB.prepare("DELETE FROM jobs"),
      env.DB.prepare(
        `INSERT INTO jobs (id, owner_id, type, status, created_at, finished_at, billed_seconds) VALUES
           ('sep', ?1, 'noop', 'succeeded', '2026-09-30T23:59:59.000Z', '2026-10-01T00:00:10.000Z', 10),
           ('oct1', ?1, 'solve', 'failed', '2026-10-01T00:00:00.000Z', '2026-10-01T01:00:00.000Z', 3600),
           ('oct22', ?2, 'mesh', 'queued', '2026-10-22T23:59:59.999Z', NULL, NULL),
           ('oct23', ?2, 'noop', 'queued', '2026-10-23T00:00:00.000Z', NULL, NULL)`,
      ).bind(ALICE, BOB),
      env.DB.prepare(
        `INSERT INTO events (at, kind, level, user_id, message) VALUES
           ('2026-10-05T08:00:00.000Z', 'sign_in', 'info', ?1, '=1+1 signed in'),
           ('2026-11-01T00:00:00.000Z', 'sign_in', 'info', ?1, 'next month')`,
      ).bind(ALICE),
    ]);
  });

  const get = (path: string, cookie = alice) => call("GET", `/api/admin/export/${path}`, { cookie });

  it("exports one table's rows of the days asked, both days included, oldest first", async () => {
    const response = await get("jobs.csv?from=2026-10-01&to=2026-10-22");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="clearfea-jobs-2026-10-01-to-2026-10-22.csv"',
    );
    const rows = await csvRows(response);
    expect(rows[0]?.slice(0, 4)).toEqual(["Job", "Type", "Lane", "Status"]);
    expect(rows.slice(1).map((row) => [row[0], row[1], row[6]])).toEqual([
      ["oct1", "solve", "alice@clearfea.test"],
      ["oct22", "mesh", "bob@clearfea.test"],
    ]);
    expect(rows[1]?.[19]).toBe("3600");
  });

  it("counts the users' and costs' jobs by when they finished, as the tabs do", async () => {
    const users = await csvRows(await get("users.csv?from=2026-10-01&to=2026-10-31"));
    const aliceRow = users.find((row) => row[0] === ALICE);
    expect(aliceRow?.slice(5)).toEqual(["2", "1", "3610"]);
    const costs = await csvRows(await get("costs-by-type.csv?from=2026-10-01&to=2026-10-01"));
    expect(costs.slice(1).map((row) => row.slice(0, 3))).toEqual([
      ["solve", "1", "3600"],
      ["noop", "1", "10"],
    ]);
  });

  it("guards text that would run as a formula", async () => {
    const rows = await csvRows(await get("events.csv?from=2026-10-01&to=2026-10-31"));
    expect(rows.length).toBe(2);
    expect(rows[1]?.[7]).toBe("'=1+1 signed in");
  });

  it("exports the settings and invited addresses as of now", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const response = await get("settings.csv?from=2020-01-01&to=2020-01-01");
    expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="clearfea-settings-${today}.csv"`);
    const rows = await csvRows(response);
    const retention = rows.find((row) => row[0] === "raw_output_retention_days");
    expect(retention?.[3]).toBe(retention?.[5]);
    expect(retention?.[4]).toBe("days");
    expect((await get("invited.xlsx")).status).toBe(200);
  });

  it("exports every table as a sheet of one workbook", async () => {
    const response = await get("all.xlsx?from=2026-10-01&to=2026-10-22");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const files = parts(new Uint8Array(await response.arrayBuffer()));
    const sheets = [...(files["xl/workbook.xml"] ?? "").matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
    expect(sheets).toEqual([
      "Jobs",
      "Tries",
      "Events",
      "Host load",
      "Users",
      "Invited",
      "Settings",
      "Costs by user",
      "Costs by job type",
    ]);
    expect(sheets.length).toBe(EXPORT_TABLES.length);
    expect(files["xl/worksheets/sheet1.xml"]).toContain("<t>oct22</t>");
    expect(files["xl/worksheets/sheet1.xml"]).not.toContain("<t>oct23</t>");
  });

  it("defaults to this month so far", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const response = await get("events.xlsx");
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="clearfea-events-${today.slice(0, 7)}-01-to-${today}.xlsx"`,
    );
  });

  it("refuses an unknown table, a CSV of every table and a range that is not one", async () => {
    expect((await get("ledger.csv")).status).toBe(404);
    expect((await get("jobs.pdf")).status).toBe(404);
    const all = await get("all.csv");
    expect(all.status).toBe(400);
    expect(((await all.json()) as { error: string }).error).toContain("Excel only");
    for (const query of ["from=2026-02-30", "from=yesterday", "to=2026-13-01"]) {
      expect((await get(`jobs.csv?${query}`)).status).toBe(400);
    }
    const backwards = await get("jobs.csv?from=2026-10-22&to=2026-10-01");
    expect(((await backwards.json()) as { error: string }).error).toBe(
      "The range ends before it starts. Choose a later end day.",
    );
  });

  it("answers anyone but the admin as an unknown address", async () => {
    expect((await get("jobs.csv", bob)).status).toBe(404);
    expect((await get("all.xlsx", bob)).status).toBe(404);
  });
});
