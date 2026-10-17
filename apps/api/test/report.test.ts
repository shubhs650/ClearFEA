// SPDX-License-Identifier: AGPL-3.0-or-later
// Report options per simulation and company name and logo per user (M7.1, ADR-073).
import {
  defaultReportOptions,
  type ReportOptions,
  type SimulationSpec,
  type ViewSettings,
  validateReportBrandingResponse,
  validateReportOptionsResponse,
  validateViewResponse,
} from "@clearfea/spec";
import fixture from "@clearfea/spec/fixtures/simulation-v1.json";
import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { imageInfo } from "../src/logo";

function call(
  method: string,
  path: string,
  options: { json?: unknown; bytes?: Uint8Array; type?: string; cookie?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.json !== undefined) headers["Content-Type"] = "application/json";
  if (options.bytes !== undefined) headers["Content-Type"] = options.type ?? "application/octet-stream";
  if (options.cookie) headers.Cookie = options.cookie;
  return exports.default.fetch(`http://localhost${path}`, {
    method,
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : options.bytes,
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
  const users = await env.DB.prepare("SELECT id, login FROM users").all<{ id: string; login: string }>();
  aliceId = users.results.find((u) => u.login === "alice")?.id ?? "";
});

let simulationId = "";

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM report_options"),
    env.DB.prepare("DELETE FROM report_branding"),
    env.DB.prepare("DELETE FROM views"),
    env.DB.prepare("DELETE FROM simulations"),
    env.DB.prepare("DELETE FROM geometries"),
  ]);
  const geometryId = crypto.randomUUID();
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
});

const viewSettings: ViewSettings = {
  camera: { position: [0.3, 0.2, 0.4], target: [0, 0, 0] },
  hiddenBodies: [],
  result: null,
};

async function saveView(name: string): Promise<string> {
  const response = await call("POST", `/api/simulations/${simulationId}/views`, {
    json: { name, settings: viewSettings },
    cookie: alice,
  });
  const checked = validateViewResponse(await response.json());
  if (!checked.ok) throw new Error(checked.errors.join(" "));
  return checked.value.view.id;
}

const optionsPath = () => `/api/simulations/${simulationId}/report-options`;

async function options(response: Response) {
  const checked = validateReportOptionsResponse(await response.json());
  if (!checked.ok) throw new Error(checked.errors.join(" "));
  return checked.value;
}

async function branding(response: Response) {
  const checked = validateReportBrandingResponse(await response.json());
  if (!checked.ok) throw new Error(checked.errors.join(" "));
  return checked.value.branding;
}

/** A PNG of the given size: signature and IHDR are all imageInfo and the API read. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** A JPEG with an APP0 segment before its baseline frame header. */
function jpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xc0, 0x00, 0x11, 0x08,
    height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03,
  ]);
}

describe("logo images", () => {
  it("are read as PNG or JPEG with their pixel size", () => {
    expect(imageInfo(png(320, 80))).toEqual({ contentType: "image/png", width: 320, height: 80 });
    expect(imageInfo(jpeg(640, 200))).toEqual({ contentType: "image/jpeg", width: 640, height: 200 });
  });

  it("are refused when they are something else or have no size", () => {
    expect(imageInfo(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(imageInfo(png(0, 10))).toBeNull();
    expect(imageInfo(png(10, 10).subarray(0, 20))).toBeNull();
    expect(imageInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
  });
});

describe("report options", () => {
  it("need a signed-in user", async () => {
    expect((await call("GET", optionsPath())).status).toBe(401);
    expect((await call("PUT", optionsPath(), { json: defaultReportOptions("x") })).status).toBe(401);
  });

  it("start from the defaults until saved", async () => {
    const response = await call("GET", optionsPath(), { cookie: alice });
    expect(response.status).toBe(200);
    expect(await options(response)).toEqual({ options: defaultReportOptions("Bracket"), saved: false, updatedAt: null });
  });

  it("are saved with sections in printing order and views as picked", async () => {
    const front = await saveView("Front");
    const iso = await saveView("Iso");
    const sent: ReportOptions = {
      sections: ["warnings", "project", "results"],
      views: [iso, front],
      titleBlock: { ...defaultReportOptions("Bracket").titleBlock, documentNumber: "CF-001", revision: "B" },
    };
    const response = await call("PUT", optionsPath(), { json: sent, cookie: alice });
    expect(response.status).toBe(200);
    const answer = await options(response);
    expect(answer.saved).toBe(true);
    expect(answer.options).toEqual({ ...sent, sections: ["project", "results", "warnings"] });
    expect(await options(await call("GET", optionsPath(), { cookie: alice }))).toEqual(answer);
  });

  it("refuse a view that is not one of the simulation's, and malformed options", async () => {
    const unknown = await call("PUT", optionsPath(), {
      json: { ...defaultReportOptions("x"), views: ["no-such-view"] },
      cookie: alice,
    });
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { error: string }).error).toContain("not a saved view of this simulation");
    for (const body of [
      { ...defaultReportOptions("x"), sections: ["verdict"] },
      { ...defaultReportOptions("x"), titleBlock: { title: "x" } },
      { sections: [], views: [] },
    ]) {
      expect((await call("PUT", optionsPath(), { json: body, cookie: alice })).status).toBe(400);
    }
  });

  it("leave out a view deleted after it was picked", async () => {
    const front = await saveView("Front");
    const iso = await saveView("Iso");
    await call("PUT", optionsPath(), { json: { ...defaultReportOptions("x"), views: [front, iso] }, cookie: alice });
    await call("DELETE", `/api/simulations/${simulationId}/views/${front}`, { cookie: alice });
    expect((await options(await call("GET", optionsPath(), { cookie: alice }))).options.views).toEqual([iso]);
  });

  it("belong to the simulation's owner only", async () => {
    expect((await call("GET", optionsPath(), { cookie: bob })).status).toBe(404);
    expect((await call("PUT", optionsPath(), { json: defaultReportOptions("x"), cookie: bob })).status).toBe(404);
    expect((await options(await call("GET", optionsPath(), { cookie: alice }))).saved).toBe(false);
  });
});

describe("company name and logo", () => {
  it("need a signed-in user", async () => {
    expect((await call("GET", "/api/report-branding")).status).toBe(401);
    expect((await call("POST", "/api/report-branding/logo", { bytes: png(1, 1) })).status).toBe(401);
  });

  it("start empty and keep the company name per user", async () => {
    expect(await branding(await call("GET", "/api/report-branding", { cookie: alice }))).toEqual({
      companyName: "",
      logo: null,
    });
    const saved = await call("PUT", "/api/report-branding", { json: { companyName: "Acme Engineering" }, cookie: alice });
    expect(saved.status).toBe(200);
    expect((await branding(saved)).companyName).toBe("Acme Engineering");
    expect((await branding(await call("GET", "/api/report-branding", { cookie: bob }))).companyName).toBe("");
    expect((await call("PUT", "/api/report-branding", { json: { companyName: "x".repeat(201) }, cookie: alice })).status).toBe(
      400,
    );
  });

  it("store a PNG or JPEG logo, serve it back to its owner and delete it", async () => {
    const image = png(320, 80);
    const uploaded = await call("POST", "/api/report-branding/logo", { bytes: image, cookie: alice });
    expect(uploaded.status).toBe(200);
    expect((await branding(uploaded)).logo).toMatchObject({ contentType: "image/png", sizeBytes: 33, width: 320, height: 80 });
    const served = await call("GET", "/api/report-branding/logo", { cookie: alice });
    expect(served.status).toBe(200);
    expect(served.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(image);
    expect((await call("GET", "/api/report-branding/logo", { cookie: bob })).status).toBe(404);

    const replaced = await call("POST", "/api/report-branding/logo", { bytes: jpeg(640, 200), cookie: alice });
    expect((await branding(replaced)).logo).toMatchObject({ contentType: "image/jpeg", width: 640, height: 200 });

    const name = await call("PUT", "/api/report-branding", { json: { companyName: "Acme" }, cookie: alice });
    expect((await branding(name)).logo?.contentType).toBe("image/jpeg");

    const deleted = await call("DELETE", "/api/report-branding/logo", { cookie: alice });
    expect(await branding(deleted)).toEqual({ companyName: "Acme", logo: null });
    expect((await call("GET", "/api/report-branding/logo", { cookie: alice })).status).toBe(404);
  });

  it("refuse other files, other content types and logos over 1 MB", async () => {
    const svg = await call("POST", "/api/report-branding/logo", {
      bytes: new TextEncoder().encode("<svg/>"),
      cookie: alice,
    });
    expect(svg.status).toBe(400);
    expect(((await svg.json()) as { error: string }).error).toContain("PNG or JPEG");
    expect((await call("POST", "/api/report-branding/logo", { bytes: png(1, 1), type: "image/png", cookie: alice })).status).toBe(
      415,
    );
    const big = new Uint8Array(1_000_001);
    big.set(png(10, 10));
    expect((await call("POST", "/api/report-branding/logo", { bytes: big, cookie: alice })).status).toBe(413);
  });
});
