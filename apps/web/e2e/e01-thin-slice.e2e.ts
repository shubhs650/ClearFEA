// SPDX-License-Identifier: AGPL-3.0-or-later
// E-01 (docs/VERIFICATION.md): upload, select faces, material, support, pressure, mesh, run, see
// the contour and switch to other result quantities (M3.1), read reactions (M3.2), and read the
// min/max markers and probe a node (M3.3), cut it with a plane (M3.4), show the safety factor against
// yield (M3.5), save a view and bring it back (M3.6), show the result in other units (M3.7) and
// export it as CSV and VTK files (M3.8), set the report options with a logo (M7.1) and unit system
// (M7.6) and draw the report's figures (M7.2), all through the UI. The model is a 40 × 20 × 10 mm block (e2e/block.py), fixed at its
// x = 40 mm end and pressed on its top face, z = 10 mm. Both faces look towards the viewer's
// starting camera, so they can be clicked without turning the model.
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { deflateSync } from "node:zlib";
import { expect, type Locator, type Page, test } from "@playwright/test";

const MODEL = process.env.CLEARFEA_E2E_MODEL ?? "";
const OUT = process.env.CLEARFEA_E2E_OUT ?? "e2e-results";

type Face = { tag: number; bbox: number[] };

/** The tag of the one face of the newest geometry whose box is the given one, in metres. */
async function faceWithBox(page: Page, lo: number[], hi: number[]): Promise<number> {
  const list = await page.request.get("/api/geometries");
  expect(list.ok()).toBe(true);
  const { geometries } = (await list.json()) as { geometries: { id: string }[] };
  const newest = geometries[0];
  if (!newest) throw new Error("The API lists no geometry.");
  const reply = await page.request.get(`/api/geometries/${newest.id}/topology`);
  expect(reply.ok()).toBe(true);
  const { faces } = (await reply.json()) as { faces: Face[] };
  const close = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 1e-6;
  const matches = faces.filter(
    (face) => lo.every((v, i) => close(face.bbox[i], v)) && hi.every((v, i) => close(face.bbox[3 + i], v)),
  );
  expect(matches, `one face with box ${lo} to ${hi}`).toHaveLength(1);
  return (matches[0] as Face).tag;
}

/**
 * Clicks the face in the viewer, the way a user does: moves the pointer over the model until the
 * viewer names that face under it, then clicks there. It finds the face whatever the framing.
 */
async function clickFace(page: Page, tag: number): Promise<void> {
  const canvas = page.locator(".viewer-canvas canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("The viewer has no canvas.");
  const hover = page.locator(".viewer-hover");
  const steps = 24;
  for (let i = 1; i < steps; i++) {
    for (let j = 1; j < steps; j++) {
      const x = box.x + (box.width * i) / steps;
      const y = box.y + (box.height * j) / steps;
      await page.mouse.move(x, y);
      if ((await hover.textContent())?.startsWith(`Face ${tag},`)) {
        await page.mouse.click(x, y);
        return;
      }
    }
  }
  throw new Error(`Face ${tag} was not found under the pointer anywhere on the viewer.`);
}

/** Opens a row of the simulation tree by its label. */
function treeRow(page: Page, label: string): Locator {
  return page.getByRole("navigation", { name: "Simulation tree" }).getByRole("button", { name: new RegExp(`^${label},`) });
}

/** A small PNG logo made here (no image is kept in the repository): a dark bar on white. */
function logoPng(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const b of bytes) c = (crcTable[(c ^ b) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 3 + 1) * height, 0xff);
  for (let y = 0; y < height; y++) {
    rows[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      if (y > height / 3 && y < (2 * height) / 3 && x > width / 10 && x < (9 * width) / 10) {
        rows.set([0x1f, 0x4e, 0x79], y * (width * 3 + 1) + 1 + x * 3);
      }
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function saved(page: Page): Promise<void> {
  await expect(page.getByText("All changes saved.")).toBeVisible();
}

test("E-01: from a STEP file to a stress contour in the browser", async ({ page }) => {
  expect(MODEL, "CLEARFEA_E2E_MODEL names the STEP file; run the test with `make e2e`").not.toBe("");

  await test.step("sign in", async () => {
    await page.goto("/");
    await page.getByLabel("Login").fill("alice");
    await page.getByLabel("Password").fill("alice-local");
    await page.getByRole("button", { name: "Sign in" }).click();
  });

  const geometry = page.getByRole("region", { name: "Geometry", exact: true });
  await test.step("upload the STEP file and confirm its unit", async () => {
    await geometry.locator('input[type="file"]').setInputFiles({
      name: basename(MODEL),
      mimeType: "application/step",
      buffer: readFileSync(MODEL),
    });
    await expect(geometry.getByText("The file says its length unit is")).toBeVisible({ timeout: 120_000 });
    await expect(geometry.getByLabel("Length unit of the file")).toHaveValue("mm");
    await geometry.getByRole("button", { name: "Confirm unit" }).click();
    await expect(geometry.getByText("40 × 20 × 10 mm")).toBeVisible();
  });

  await test.step("start the setup", async () => {
    await page.getByRole("button", { name: "Start setup" }).click();
    await expect(treeRow(page, "Materials")).toBeVisible();
  });

  const settings = page.getByRole("complementary", { name: "Settings" });
  await test.step("material", async () => {
    await treeRow(page, "Materials").click();
    await page.getByRole("button", { name: "Add an empty material" }).click();
    const material = page.getByRole("region", { name: "Material", exact: true });
    await material.getByLabel("Young's modulus", { exact: true }).fill("200");
    await material.getByLabel("Young's modulus unit").selectOption("GPa");
    await material.getByLabel("Poisson's ratio").fill("0.3");
    await material.getByLabel("Yield strength", { exact: true }).fill("250");
    await material.getByLabel("Yield strength unit").selectOption("MPa");
    await expect(material.getByRole("checkbox", { name: "Body 1" })).toBeChecked();
    await saved(page);
  });

  const end = await faceWithBox(page, [0.04, 0, 0], [0.04, 0.02, 0.01]);
  const top = await faceWithBox(page, [0, 0, 0.01], [0.04, 0.02, 0.01]);
  const selection = page.getByRole("region", { name: "Selected faces", exact: true });

  await test.step("fixed support on the end face", async () => {
    await clickFace(page, end);
    await expect(selection).toContainText(`1 face selected: ${end}`);
    await treeRow(page, "Supports").click();
    await page.getByRole("button", { name: "Add a fixed support" }).click();
    const support = page.getByRole("region", { name: "Fixed support", exact: true });
    await expect(support.getByText(String(end), { exact: true })).toBeVisible();
    await saved(page);
  });

  await test.step("pressure on the top face", async () => {
    await selection.getByRole("button", { name: "Clear" }).click();
    await clickFace(page, top);
    await expect(selection).toContainText(`1 face selected: ${top}`);
    await treeRow(page, "Loads").click();
    await page.getByRole("button", { name: "Add a pressure" }).click();
    const pressure = page.getByRole("region", { name: "Pressure", exact: true });
    await expect(pressure.getByText(String(top), { exact: true })).toBeVisible();
    await pressure.getByLabel("Magnitude", { exact: true }).fill("1");
    await pressure.getByLabel("Magnitude unit").selectOption("MPa");
    await saved(page);
  });

  await test.step("mesh", async () => {
    await treeRow(page, "Mesh").click();
    const mesh = page.getByRole("region", { name: "Mesh", exact: true });
    await mesh.getByLabel("Global size", { exact: true }).fill("5");
    await mesh.getByLabel("Global size unit").selectOption("mm");
    await saved(page);
    await mesh.getByRole("button", { name: "Generate mesh" }).click();
    await expect(page.getByText(/^Mesh: [\d,]+ elements, [\d,]+ nodes$/)).toBeVisible({ timeout: 120_000 });
  });

  await test.step("run and see the von Mises contour", async () => {
    await treeRow(page, "Run").click();
    const run = settings.getByRole("region", { name: "Run", exact: true });
    await expect(run.getByRole("region", { name: "Before running", exact: true })).toHaveCount(0);
    // The estimate before the run (M2.12): the small block fits the smallest machine size.
    const estimate = run.getByRole("region", { name: "Estimate", exact: true });
    await expect(estimate).toContainText(/about [\d.]+ (MiB|GiB) at its peak/);
    await expect(estimate.getByLabel("Machine size")).toHaveValue("small");
    await page.screenshot({ path: `${OUT}/e01-estimate.png` });
    // The equation solver (ADR-063): PaStiX by default; an iterative one shows its accuracy note.
    const solver = run.getByRole("region", { name: "Solver", exact: true });
    const choice = solver.getByLabel("Equation solver");
    await expect(choice).toHaveValue("pastix");
    await choice.selectOption("iterative_cholesky");
    await expect(solver).toContainText("Iterative solvers stop at a fixed relative residual");
    await page.screenshot({ path: `${OUT}/e01-solver-iterative.png` });
    await choice.selectOption("pastix");
    await expect(solver).not.toContainText("Iterative solvers stop");
    await page.screenshot({ path: `${OUT}/e01-solver.png` });
    await expect(run.getByRole("button", { name: "Run", exact: true })).toBeEnabled({ timeout: 10_000 });
    await run.getByRole("button", { name: "Run", exact: true }).click();
    await expect(run.getByLabel("Run results")).toContainText("Largest von Mises stress", { timeout: 180_000 });
    await expect(run.getByLabel("Run record")).toContainText(/Estimate.*about \d+ s/);
    await expect(run.getByLabel("Run record")).toContainText(/Solver\s*PaStiX/);

    const legend = page.getByRole("region", { name: "Legend", exact: true });
    await expect(legend).toContainText("Von Mises stress (MPa)", { timeout: 60_000 });
    await expect(legend.getByRole("listitem")).toHaveCount(9);
    await expect(legend).toContainText("Deformed shape, scale ×");
    await page.screenshot({ path: `${OUT}/e01-contour.png` });
  });

  await test.step("switch to a principal stress and a strain component (M3.1)", async () => {
    const quantity = settings.getByLabel("Quantity");
    const legend = page.getByRole("region", { name: "Legend", exact: true });
    await quantity.selectOption("principal3");
    await expect(legend).toContainText("Minimum principal stress σ3 (MPa)");
    await page.screenshot({ path: `${OUT}/e01-principal.png` });
    await quantity.selectOption("strainZZ");
    await expect(legend).toContainText("Normal strain εzz (mm/mm)");
    await page.screenshot({ path: `${OUT}/e01-strain.png` });
  });

  await test.step("read the reactions, the load totals and the balance (M3.2)", async () => {
    const results = settings.getByLabel("Run results");
    await expect(results).toContainText(/Reaction, .*\(.*\) N/);
    await expect(results).toContainText(/moment \(.*\) N·mm about the faces' centre at \(.*\) mm/);
    await expect(results).toContainText(/Applied, /);
    await expect(results).toContainText(/Out of balance.*force [\d.e-]+ % of [\d.]+ N, moment [\d.e-]+ % of [\d.]+ N·mm/);
    await results.getByText("Out of balance").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/e01-reactions.png` });
  });

  await test.step("read the min/max markers and probe a node on the top face (M3.3)", async () => {
    await settings.getByLabel("Quantity").selectOption("vonMises");
    const legend = page.getByRole("region", { name: "Legend", exact: true });
    await expect(legend).toContainText("Von Mises stress (MPa)");
    const number = (text: string | null) => Number(/(-?[\d.e+-]+) MPa/.exec(text ?? "")?.[1]);
    const max = page.locator(".viewer-marker-max");
    const min = page.locator(".viewer-marker-min");
    await expect(max).toHaveText(/^Max [\d.e+-]+ MPa$/);
    await expect(min).toHaveText(/^Min [\d.e+-]+ MPa$/);
    const probes = page.getByRole("region", { name: "Probes", exact: true });
    await expect(probes).toHaveText("Click the model to probe the value at the nearest node.");
    await clickFace(page, top);
    // A node of the top face: its undeformed z is 10 mm.
    const row = probes.getByRole("listitem");
    await expect(row).toHaveText(/^1: [\d.e+-]+ MPa at \([\d.e+-]+, [\d.e+-]+, 10\) mm$/);
    await expect(page.locator(".viewer-marker-probe")).toHaveText(/^1: [\d.e+-]+ MPa$/);
    const value = number(await row.textContent());
    expect(value).toBeGreaterThanOrEqual(number(await min.textContent()));
    expect(value).toBeLessThanOrEqual(number(await max.textContent()));
    await page.screenshot({ path: `${OUT}/e01-probe.png` });
  });

  await test.step("cut the model across x and then y (M3.4)", async () => {
    await page.getByRole("button", { name: "Clear probes" }).click();
    await page.getByLabel("Cut plane", { exact: true }).check();
    const cut = page.getByRole("region", { name: "Cut plane", exact: true });
    // Across x through the middle of the block, x = 20 mm.
    await expect(cut).toContainText("x = 20 mm");
    await expect(cut).toContainText(/Cuts [\d,]+ elements\./, { timeout: 60_000 });
    const legend = page.getByRole("region", { name: "Legend", exact: true });
    await expect(legend.getByRole("listitem")).toHaveCount(9);
    await expect(page.locator(".viewer-marker-max")).toHaveText(/^Max [\d.e+-]+ MPa$/);
    await page.screenshot({ path: `${OUT}/e01-cut.png` });
    await cut.getByLabel("y", { exact: true }).check();
    await expect(cut).toContainText("y = 10 mm");
    await expect(cut).toContainText(/Cuts [\d,]+ elements\./);
    await expect(page.locator("body")).not.toContainText(/\b(PASS|FAIL)\b|compliant/i);
    await page.screenshot({ path: `${OUT}/e01-cut-y.png` });
  });

  await test.step("show the safety factor against yield (M3.5)", async () => {
    await page.getByRole("checkbox", { name: "Cut plane", exact: true }).uncheck();
    const quantity = settings.getByLabel("Quantity");
    const max = page.locator(".viewer-marker-max");
    const min = page.locator(".viewer-marker-min");
    await quantity.selectOption("vonMises");
    await expect(max).toHaveText(/^Max [\d.e+-]+ MPa$/);
    const largestStress = Number(/Max ([\d.e+-]+) MPa/.exec((await max.textContent()) ?? "")?.[1]);
    await quantity.selectOption("safetyFactor");
    const legend = page.getByRole("region", { name: "Legend", exact: true });
    await expect(legend).toContainText("Safety factor against yield");
    await expect(legend).not.toContainText("Safety factor against yield (");
    // A number without a unit; the smallest factor sits where von Mises is largest: 250 MPa over it.
    await expect(min).toHaveText(/^Min [\d.e+-]+$/);
    const smallest = Number(/Min ([\d.e+-]+)/.exec((await min.textContent()) ?? "")?.[1]);
    expect(Math.abs(smallest - 250 / largestStress) / smallest).toBeLessThan(2e-3);
    const results = settings.getByLabel("Run results");
    await expect(results).toContainText(/Smallest safety factor against yield[\d.]+ at \(.*\) mm/);
    await expect(page.locator("body")).not.toContainText(/\b(PASS|FAIL)\b|compliant/i);
    await page.screenshot({ path: `${OUT}/e01-safety.png` });
  });

  await test.step("save a view and bring it back (M3.6)", async () => {
    // One body: nothing to hide, so the viewer has no Bodies button (the tree's Bodies row,
    // M4.1, is not it).
    const viewer = page.getByRole("main", { name: "3D viewer" });
    await expect(viewer.getByRole("button", { name: /^Bodies/ })).toHaveCount(0);
    const quantity = settings.getByLabel("Quantity");
    const legend = page.getByRole("region", { name: "Legend", exact: true });
    await quantity.selectOption("principal1");
    await page.getByRole("checkbox", { name: "Cut plane", exact: true }).check();
    const cut = page.getByRole("region", { name: "Cut plane", exact: true });
    await expect(cut).toContainText(/Cuts [\d,]+ elements\./, { timeout: 60_000 });
    await page.getByRole("button", { name: "Views", exact: true }).click();
    const views = page.getByRole("region", { name: "Saved views", exact: true });
    await expect(views).toContainText("No saved views yet.");
    await views.getByLabel("View name").fill("σ1 cut at mid-length");
    await views.getByRole("button", { name: "Save view" }).click();
    await expect(views).toContainText('Saved the view "σ1 cut at mid-length".');
    // Kept by the API, so it is there for the report and after a reload.
    const list = await page.request.get("/api/simulations");
    const { simulations } = (await list.json()) as { simulations: { id: string }[] };
    const stored = await page.request.get(`/api/simulations/${simulations[0]?.id}/views`);
    expect(((await stored.json()) as { views: { name: string }[] }).views.map((v) => v.name)).toEqual([
      "σ1 cut at mid-length",
    ]);

    await page.getByRole("checkbox", { name: "Cut plane", exact: true }).uncheck();
    await quantity.selectOption("displacement");
    await page.getByRole("button", { name: "Reset view" }).click();
    await expect(legend).toContainText("Displacement magnitude (mm)");
    await views.getByRole("button", { name: "σ1 cut at mid-length", exact: true }).click();
    await expect(legend).toContainText("Maximum principal stress σ1 (MPa)");
    await expect(quantity).toHaveValue("principal1");
    await expect(page.getByRole("checkbox", { name: "Cut plane", exact: true })).toBeChecked();
    await expect(cut).toContainText("x = 20 mm");
    await page.screenshot({ path: `${OUT}/e01-view.png` });
  });

  await test.step("show the result in units of its own without running again (M3.7)", async () => {
    // The one units table, so the test has no conversion factor of its own (CLAUDE.md).
    const table = JSON.parse(readFileSync(new URL("../../../packages/spec/units.json", import.meta.url), "utf8")) as {
      kinds: Record<string, { units: Record<string, { factor: number }> }>;
    };
    const factor = (kind: string, unit: string) => table.kinds[kind]?.units[unit]?.factor ?? Number.NaN;
    const quantity = settings.getByLabel("Quantity");
    const legend = page.getByRole("region", { name: "Legend", exact: true });
    const max = page.locator(".viewer-marker-max");
    await quantity.selectOption("vonMises");
    await expect(max).toHaveText(/^Max [\d.e+-]+ MPa$/);
    const inMpa = Number(/Max ([\d.e+-]+) MPa/.exec((await max.textContent()) ?? "")?.[1]);
    await settings.getByRole("combobox", { name: "Stress", exact: true }).selectOption("ksi");
    await expect(legend).toContainText("Von Mises stress (ksi)");
    await expect(max).toHaveText(/^Max [\d.e+-]+ ksi$/);
    const inKsi = Number(/Max ([\d.e+-]+) ksi/.exec((await max.textContent()) ?? "")?.[1]);
    const same = (inKsi * factor("pressure", "ksi")) / (inMpa * factor("pressure", "MPa"));
    expect(Math.abs(same - 1)).toBeLessThan(2e-3);
    const results = settings.getByLabel("Run results");
    await expect(results).toContainText(/Largest von Mises stress[\d.e+-]+ ksi/);
    // The cut plane's position follows a picked length unit: x = 20 mm is 0.7874 in.
    await settings.getByRole("combobox", { name: "Length", exact: true }).selectOption("in");
    await expect(results).toContainText(/Largest displacement[\d.e+-]+ in at \(.*\) in/);
    await page.getByRole("checkbox", { name: "Cut plane", exact: true }).check();
    const cut = page.getByRole("region", { name: "Cut plane", exact: true });
    await expect(cut).toContainText("x = 0.7874 in");
    await expect(cut).toContainText(/Cuts [\d,]+ elements\./, { timeout: 60_000 });
    await page.getByRole("checkbox", { name: "Cut plane", exact: true }).uncheck();
    await quantity.selectOption("strainZZ");
    await expect(legend).toContainText("Normal strain εzz (mm/mm)");
    await settings.getByRole("combobox", { name: "Strain", exact: true }).selectOption("µε");
    await expect(legend).toContainText("Normal strain εzz (µε)");
    await quantity.selectOption("vonMises");
    await settings.getByRole("group", { name: "Units shown", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/e01-units.png` });
    // Kept for the user after the page is opened again; the input units stay the system's.
    await page.reload();
    await treeRow(page, "Run").click();
    await expect(legend).toContainText("Von Mises stress (ksi)", { timeout: 60_000 });
    await expect(page.getByRole("combobox", { name: "Unit system", exact: true })).toHaveValue("metric-mm");
    await settings.getByRole("button", { name: "Show all in the unit system" }).click();
    await expect(legend).toContainText("Von Mises stress (MPa)");
    await expect(page.locator("body")).not.toContainText(/\b(PASS|FAIL)\b|compliant/i);
  });

  await test.step("export the results as CSV and VTK files (M3.8)", async () => {
    const exports = settings.getByRole("region", { name: "Export", exact: true });
    const download = async (name: string) => {
      const [file] = await Promise.all([
        page.waitForEvent("download"),
        exports.getByRole("button", { name, exact: true }).click(),
      ]);
      const path = `${OUT}/${file.suggestedFilename()}`;
      await file.saveAs(path);
      return { name: file.suggestedFilename(), bytes: readFileSync(path) };
    };
    const record = settings.getByLabel("Run record");
    const nodeCount = Number(/elements, ([\d,]+) nodes/.exec((await record.textContent()) ?? "")?.[1]?.replaceAll(",", ""));
    expect(nodeCount).toBeGreaterThan(0);
    const results = settings.getByLabel("Run results");
    const largest = Number(/Largest von Mises stress([\d.e+-]+) MPa/.exec((await results.textContent()) ?? "")?.[1]);

    // A row per node in the units shown; its largest von Mises stress is the run's.
    const nodes = await download("Results at every node (CSV)");
    expect(nodes.name).toMatch(/^clearfea-run-[0-9a-f]{8}-nodes\.csv$/);
    const lines = nodes.bytes.toString("utf8").replace(/^\uFEFF/, "").trimEnd().split("\r\n");
    expect(lines).toHaveLength(nodeCount + 1);
    const header = (lines[0] ?? "").split(",");
    expect(header.slice(0, 4)).toEqual(["node", "x (mm)", "y (mm)", "z (mm)"]);
    const column = header.indexOf("von Mises stress (MPa)");
    expect(column).toBeGreaterThan(0);
    expect(header).toContain("safety factor");
    const vonMises = lines.slice(1).map((line) => Number(line.split(",")[column]));
    expect(Math.abs(Math.max(...vonMises) / largest - 1)).toBeLessThan(1e-3);

    // The support's reaction and the pressure's total, which balance.
    const reactions = await download("Reactions and loads (CSV)");
    const rows = reactions.bytes.toString("utf8").replace(/^\uFEFF/, "").trimEnd().split("\r\n");
    expect(rows[0]).toMatch(/^item,name,Fx \(N\),Fy \(N\),Fz \(N\),Mx \(N·mm\)/);
    expect(rows.map((r) => r.split(",")[0])).toEqual(["item", "reaction", "applied load"]);
    const fz = rows.slice(1).map((r) => Number(r.split(",")[4]));
    expect(Math.abs((fz[0] ?? 0) + (fz[1] ?? 0))).toBeLessThan(1e-3 * Math.abs(fz[1] ?? 1));

    // The mesh and every field, kept with the other outputs for a look in ParaView.
    const vtk = await download("Mesh and results (VTK)");
    expect(vtk.name).toMatch(/^clearfea-run-[0-9a-f]{8}\.vtu$/);
    const head = vtk.bytes.subarray(0, 4000).toString("latin1");
    expect(head).toMatch(/^<\?xml version="1.0"\?>\n<VTKFile type="UnstructuredGrid"/);
    expect(head).toContain(`NumberOfPoints="${nodeCount}"`);
    expect(head).toContain('Name="vonMises (Pa)"');
    await exports.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/e01-export.png` });
  });

  await test.step("set the report options with a logo (M7.1) and the report's unit system (M7.6)", async () => {
    await treeRow(page, "Report").click();
    const report = settings.getByRole("region", { name: "Report", exact: true });
    await expect(report.getByLabel("Report title", { exact: true })).toHaveValue(/.+/);
    await report.getByRole("checkbox", { name: "Run warnings" }).uncheck();
    await report.getByRole("checkbox", { name: "σ1 cut at mid-length" }).check();
    await report.getByLabel("Document number", { exact: true }).fill("CF-E01-001");
    await report.getByLabel("Revision", { exact: true }).fill("A");
    await report.getByLabel("Prepared by", { exact: true }).fill("Alice");
    // The report prints in its own system, starting as the project's, whatever the results show.
    const reportUnits = report.getByLabel("Report unit system", { exact: true });
    await expect(reportUnits).toHaveValue("metric-mm");
    await reportUnits.selectOption("us-in");
    await report.getByLabel("Company name", { exact: true }).fill("Example Engineering");
    const logo = `${OUT}/e01-logo.png`;
    writeFileSync(logo, logoPng(240, 80));
    await report.getByLabel("Upload a logo", { exact: true }).setInputFiles(logo);
    await expect(report.getByText("PNG, 240 × 80 pixels")).toBeVisible();
    await expect(report.getByRole("img", { name: "Your logo" })).toHaveJSProperty("naturalWidth", 240);
    await report.getByRole("button", { name: "Save report options" }).click();
    await expect(report.getByText("Report options saved.")).toBeVisible();

    // Kept by the API: they come back after a reload.
    await page.reload();
    await treeRow(page, "Report").click();
    await expect(report.getByLabel("Document number", { exact: true })).toHaveValue("CF-E01-001");
    await expect(report.getByLabel("Company name", { exact: true })).toHaveValue("Example Engineering");
    await expect(report.getByLabel("Report unit system", { exact: true })).toHaveValue("us-in");
    await expect(page.getByLabel("Unit system", { exact: true })).toHaveValue("metric-mm");
    await expect(report.getByRole("checkbox", { name: "Run warnings" })).not.toBeChecked();
    await expect(report.getByRole("checkbox", { name: "σ1 cut at mid-length" })).toBeChecked();
    await expect(report.getByRole("img", { name: "Your logo" })).toHaveJSProperty("naturalWidth", 240);
    await expect(page.locator("body")).not.toContainText(/\b(PASS|FAIL)\b|compliant/i);
    await page.screenshot({ path: `${OUT}/e01-report-options.png`, fullPage: true });
    await report.getByRole("group", { name: "Units" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/e01-report-units.png` });
    await report.getByRole("group", { name: "Company" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/e01-report-company.png` });
  });

  await test.step("draw the report's figures (M7.2)", async () => {
    const report = settings.getByRole("region", { name: "Report", exact: true });
    const figuresGroup = report.getByRole("group", { name: "Figures" });
    await figuresGroup.getByRole("button", { name: "Draw the figures" }).click();
    // One for the support, one for the pressure, one for the view picked.
    await expect(figuresGroup.getByText("Drew 3 figures.")).toBeVisible({ timeout: 60_000 });
    const list = figuresGroup.getByRole("list", { name: "Figures" });
    const captions = ["Fixed support 1", "Pressure 1", 'Maximum principal stress σ1, view "σ1 cut at mid-length"'];
    for (const caption of captions) {
      await expect(list.getByRole("img", { name: caption })).toHaveJSProperty("naturalWidth", 1600);
    }
    // Stored on the run: a reload lists them again, in the report's order.
    await page.reload();
    await treeRow(page, "Report").click();
    await expect(list.getByRole("listitem")).toHaveText(captions);
    const sources = await list.getByRole("img").evaluateAll((images) => images.map((i) => (i as HTMLImageElement).src));
    for (const [k, source] of sources.entries()) {
      const image = await page.request.get(source);
      expect(image.headers()["content-type"]).toBe("image/png");
      writeFileSync(`${OUT}/e01-figure-${k + 1}.png`, await image.body());
    }
    await figuresGroup.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/e01-report-figures.png` });
  });

  await test.step("open the wallet (M8.1)", async () => {
    await page.getByRole("contentinfo", { name: "Status" }).getByRole("button", { name: "Wallet" }).click();
    const wallet = page.getByRole("region", { name: "Wallet" });
    const ledger = wallet.getByRole("table", { name: "Ledger" });
    // The seed's grant, the mesh and every run E-01 made, each with what it paid for.
    await expect(ledger.getByRole("row").last()).toContainText("Credit grant");
    await expect(ledger.getByRole("row", { name: /Mesh of block\.step/ }).first()).toBeVisible();
    await expect(ledger.getByRole("row", { name: /Run of “/ }).first()).toBeVisible();
    await expect(wallet.getByTestId("wallet-balance")).toHaveText(/^99\.\d+ credits$/);
    await page.screenshot({ path: `${OUT}/e01-wallet.png` });
    await wallet.getByRole("button", { name: "Back to the workbench" }).click();
    await expect(wallet).toBeHidden();
  });
});
