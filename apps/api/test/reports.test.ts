// SPDX-License-Identifier: AGPL-3.0-or-later
// A run's Word report (M7.3, ADR-077): queued as a report job with everything it prints frozen
// in its params, made by the worker, downloaded by its owner.
import {
  type ClaimResponse,
  type ReportJobParams,
  type RunReport,
  type SimulationSpec,
  validateClaimResponse,
  validateReportJobParams,
  validateRunReportResponse,
} from "@clearfea/spec";
import fixture from "@clearfea/spec/fixtures/simulation-v1.json";
import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { reportFilename } from "../src/routes/reports";
import { userProject } from "../src/db/projects";

const TOKEN = "test-worker-token";

function call(
  method: string,
  path: string,
  options: { json?: unknown; raw?: string; cookie?: string; token?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.json !== undefined) headers["Content-Type"] = "application/json";
  if (options.raw !== undefined) headers["Content-Length"] = String(options.raw.length);
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

let simulationId = "";
let geometryId = "";
let runId = "";

const RESULT = { nodes: 100, software: { calculix: "2.21" } };

/** Alice's run of the fixture's setup, in the given state, with its job and mesh. */
async function runRow(status: "succeeded" | "solving"): Promise<string> {
  const id = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const meshId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO jobs (id, owner_id, type, target_id, status) VALUES (?, ?, 'solve', ?, ?)`).bind(
      jobId,
      aliceId,
      id,
      status === "succeeded" ? "succeeded" : "running",
    ),
    env.DB.prepare(
      `INSERT INTO meshes (id, owner_id, geometry_id, size, element_order, status, node_count, element_count, quality)
       VALUES (?, ?, ?, '{"value":5,"unit":"mm"}', 2, 'ready', 100, 40,
               '{"shapeMin":0.3,"shapeMean":0.8,"shapeHistogram":[0,0,0,1,2,3,4,10,10,10],"jacobianMin":0.9}')`,
    ).bind(meshId, aliceId, geometryId),
    env.DB.prepare(
      `INSERT INTO runs (id, owner_id, simulation_id, mesh_id, spec, status, job_id, files, result)
       VALUES (?, ?, ?, ?, ?, ?, ?, '["deck.inp","solver.log"]', ?)`,
    ).bind(
      id,
      aliceId,
      simulationId,
      meshId,
      JSON.stringify({ ...fixture, geometryId }),
      status,
      jobId,
      status === "succeeded" ? JSON.stringify(RESULT) : null,
    ),
  ]);
  return id;
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM report_figures"),
    env.DB.prepare("DELETE FROM report_options"),
    env.DB.prepare("DELETE FROM report_branding"),
    env.DB.prepare("DELETE FROM runs"),
    env.DB.prepare("DELETE FROM meshes"),
    env.DB.prepare("DELETE FROM jobs"),
    env.DB.prepare("DELETE FROM simulations"),
    env.DB.prepare("DELETE FROM geometries"),
  ]);
  geometryId = crypto.randomUUID();
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

async function report(response: Response): Promise<RunReport | null> {
  const checked = validateRunReportResponse(await response.json());
  if (!checked.ok) throw new Error(checked.errors.join(" "));
  return checked.value.report;
}

/** Stores a figure row for the run, as the browser's capture does (M7.2). */
async function figureRow(kind: "support" | "load" | "view", item: string, position: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO report_figures (run_id, owner_id, kind, item, caption, position, width, height, size_bytes)
     VALUES (?, ?, ?, ?, ?, ?, 1600, 1000, 10)`,
  )
    .bind(runId, aliceId, kind, item, `${kind} ${item}`, position)
    .run();
}

async function claimReport(): Promise<ClaimResponse["job"]> {
  const response = await call("POST", "/internal/jobs/claim", {
    json: { workerId: "w1", jobTypes: ["report"] },
    token: TOKEN,
  });
  expect(response.status).toBe(200);
  const body = validateClaimResponse(await response.json());
  if (!body.ok) throw new Error(body.errors.join(" "));
  return body.value.job;
}

function transferPath(job: ClaimResponse["job"], name: string, direction: string): string {
  const url = job.transfers.find((t) => t.name === name && t.direction === direction)?.url;
  if (url === undefined) throw new Error(`no ${direction} for ${name}`);
  const parsed = new URL(url);
  return parsed.pathname + parsed.search;
}

async function complete(jobId: string, body: Record<string, unknown>): Promise<void> {
  const done = await call("POST", `/internal/jobs/${jobId}/complete`, {
    json: { workerId: "w1", metering: { billableMs: 900 }, ...body },
    token: TOKEN,
  });
  expect(done.status).toBe(200);
}

describe("a run's report", () => {
  it("is none until one is asked for", async () => {
    expect(await report(await call("GET", `/api/runs/${runId}/report`, { cookie: alice }))).toBeNull();
  });

  it("is queued with everything it prints frozen in its job", async () => {
    await figureRow("support", "s1", 0);
    await figureRow("load", "l1", 1);
    const response = await call("POST", `/api/runs/${runId}/report`, { cookie: alice });
    expect(response.status).toBe(202);
    const queued = await report(response);
    expect(queued?.status).toBe("queued");
    const job = await claimReport();
    expect(job.type).toBe("report");
    expect(job.targetId).toBe(runId);
    const checked = validateReportJobParams(job.params);
    if (!checked.ok) throw new Error(checked.errors.join(" "));
    const params: ReportJobParams = checked.value;
    expect(params.runId).toBe(runId);
    expect(params.sections).toContain("loadsSupports");
    expect(params.titleBlock.title).toBe("Bracket");
    expect(params.unitSystem).toBe("metric-mm"); // the project's, units.json's default
    expect(params.geometry).toEqual({ name: "block.step", unit: "mm" });
    expect(params.meshQuality).toMatchObject({ shapeMin: 0.3 });
    expect(params.logo).toBeNull();
    expect(params.figures.map((f) => [f.file, f.kind, f.item])).toEqual([
      ["figure-0.png", "support", "s1"],
      ["figure-1.png", "load", "l1"],
    ]);
    expect(params.statements.map((s) => s.id)).toEqual(["toolPositioning", "softwareVersions", "verificationLink"]);
    expect(job.transfers.map((t) => `${t.direction} ${t.name}`)).toEqual([
      "download topology.json",
      "download solver.log",
      "download figure-0.png",
      "download figure-1.png",
      "upload report.docx",
      "upload report.pdf",
    ]);
  });

  it("prints the saved options, unit system and branding, without figures of sections left out", async () => {
    await figureRow("support", "s1", 0);
    await figureRow("view", "v1", 1);
    await env.DB.prepare("INSERT INTO report_options (simulation_id, owner_id, options) VALUES (?, ?, ?)")
      .bind(
        simulationId,
        aliceId,
        JSON.stringify({
          sections: ["project", "results"],
          views: [],
          titleBlock: { title: "T", documentNumber: "D-1", revision: "B", preparedBy: "", checkedBy: "", approvedBy: "" },
          unitSystem: "us-in",
        }),
      )
      .run();
    await env.DB.prepare(
      `INSERT INTO report_branding (owner_id, company_name, logo_type, logo_bytes, logo_width, logo_height, logo_updated_at)
       VALUES (?, 'Acme', 'image/png', 10, 40, 20, '2026-10-17T00:00:00.000Z')`,
    )
      .bind(aliceId)
      .run();
    expect((await call("POST", `/api/runs/${runId}/report`, { cookie: alice })).status).toBe(202);
    const job = await claimReport();
    const params = job.params as unknown as ReportJobParams;
    expect(params.sections).toEqual(["project", "results"]);
    expect(params.unitSystem).toBe("us-in");
    expect(params.companyName).toBe("Acme");
    expect(params.logo).toMatchObject({ width: 40, height: 20 });
    expect(params.figures.map((f) => f.item)).toEqual(["v1"]);
    expect(job.transfers.map((t) => t.name)).toContain("logo");
  });

  it("is made by the worker and downloaded by its owner only, as a Word file and a PDF", async () => {
    await call("POST", `/api/runs/${runId}/report`, { cookie: alice });
    const job = await claimReport();
    const making = await report(await call("GET", `/api/runs/${runId}/report`, { cookie: alice }));
    expect(making?.status).toBe("queued");
    expect((await call("GET", `/api/runs/${runId}/report/docx`, { cookie: alice })).status).toBe(404);
    expect((await call("GET", `/api/runs/${runId}/report/pdf`, { cookie: alice })).status).toBe(404);
    const put = await call("PUT", transferPath(job, "report.docx", "upload"), { raw: "docx bytes", token: TOKEN });
    expect(put.status).toBe(200);
    const putPdf = await call("PUT", transferPath(job, "report.pdf", "upload"), { raw: "%PDF bytes", token: TOKEN });
    expect(putPdf.status).toBe(200);
    await complete(job.id, { status: "succeeded", result: { sizeBytes: 10, pdfSizeBytes: 10, figures: 0 } });
    const made = await report(await call("GET", `/api/runs/${runId}/report`, { cookie: alice }));
    expect(made).toMatchObject({ id: job.id, status: "succeeded", sizeBytes: 10, pdfSizeBytes: 10, problem: null });
    const download = await call("GET", `/api/runs/${runId}/report/docx`, { cookie: alice });
    expect(download.status).toBe(200);
    expect(download.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(download.headers.get("Content-Disposition")).toBe('attachment; filename="Bracket.docx"');
    expect(new TextDecoder().decode(await download.arrayBuffer())).toBe("docx bytes");
    const pdf = await call("GET", `/api/runs/${runId}/report/pdf`, { cookie: alice });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("Content-Type")).toBe("application/pdf");
    expect(pdf.headers.get("Content-Disposition")).toBe('attachment; filename="Bracket.pdf"');
    expect(new TextDecoder().decode(await pdf.arrayBuffer())).toBe("%PDF bytes");
    expect((await call("GET", `/api/runs/${runId}/report/docx`, { cookie: bob })).status).toBe(404);
    expect((await call("GET", `/api/runs/${runId}/report/pdf`, { cookie: bob })).status).toBe(404);
    expect((await call("GET", `/api/runs/${runId}/report/odt`, { cookie: alice })).status).toBe(404);
    expect((await call("GET", `/api/runs/${runId}/report`, { cookie: bob })).status).toBe(404);
    // Each report is kept under its own job; a new one can be asked for once one has finished.
    expect((await call("POST", `/api/runs/${runId}/report`, { cookie: alice })).status).toBe(202);
  });

  it("says a report made before M7.4 has no PDF and how to get one", async () => {
    await call("POST", `/api/runs/${runId}/report`, { cookie: alice });
    const job = await claimReport();
    await env.DB.prepare("UPDATE jobs SET status = 'succeeded', result = ? WHERE id = ?")
      .bind(JSON.stringify({ sizeBytes: 10, figures: 0 }), job.id)
      .run();
    const made = await report(await call("GET", `/api/runs/${runId}/report`, { cookie: alice }));
    expect(made).toMatchObject({ status: "succeeded", sizeBytes: 10, pdfSizeBytes: null });
    const pdf = await call("GET", `/api/runs/${runId}/report/pdf`, { cookie: alice });
    expect(pdf.status).toBe(404);
    expect(await pdf.json()).toEqual({
      error: "This report was made before reports had a PDF. Make the report again to get one.",
    });
  });

  it("says what went wrong when the job did not store its files", async () => {
    await call("POST", `/api/runs/${runId}/report`, { cookie: alice });
    const job = await claimReport();
    await call("PUT", transferPath(job, "report.docx", "upload"), { raw: "docx bytes", token: TOKEN });
    await complete(job.id, { status: "succeeded", result: { sizeBytes: 10, pdfSizeBytes: 10, figures: 0 } });
    const failed = await report(await call("GET", `/api/runs/${runId}/report`, { cookie: alice }));
    expect(failed?.status).toBe("failed");
    expect(failed?.problem).toContain("fault in ClearFEA, not in your run (outputs_missing)");
  });

  it("is refused while one is being made, for a run that has not succeeded, and for another user", async () => {
    expect((await call("POST", `/api/runs/${runId}/report`, { cookie: alice })).status).toBe(202);
    const again = await call("POST", `/api/runs/${runId}/report`, { cookie: alice });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "A report of this run is already being made. Wait for it to finish." });
    const solving = await runRow("solving");
    expect((await call("POST", `/api/runs/${solving}/report`, { cookie: alice })).status).toBe(409);
    expect((await call("POST", `/api/runs/${runId}/report`, { cookie: bob })).status).toBe(404);
  });
});

describe("the report's file name", () => {
  it("comes from the title block with only safe characters", () => {
    const params = {
      titleBlock: { title: 'Bracket "A"/1', documentNumber: "CF-001", revision: "B" },
    } as unknown as Record<string, unknown>;
    expect(reportFilename(params, "abcdef123")).toBe("CF-001 Bracket A 1 rev B.docx");
    expect(reportFilename(null, "abcdef123")).toBe("clearfea-report-abcdef12.docx");
    expect(reportFilename(params, "abcdef123", "pdf")).toBe("CF-001 Bracket A 1 rev B.pdf");
  });
});
