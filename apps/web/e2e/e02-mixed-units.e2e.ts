// SPDX-License-Identifier: AGPL-3.0-or-later
// E-02 (docs/VERIFICATION.md): values entered in mixed units, through the UI. The project's unit
// system is US (in, lbf, psi), the STEP file is in millimetres, and the setup mixes units on
// purpose: Young's modulus in GPa, yield strength in ksi, a pressure in MPa, a force in lbf, the
// mesh size in mm. Each field offers the system's unit first and keeps the unit it was typed in,
// through a reload and a change of system; the solver deck gets SI values, and the run's load
// totals and reactions come back in the system's units. Switching the units results are shown in
// is E-01's (M3.7) and is not repeated here.
//
// The model is E-01's 40 × 20 × 10 mm block (e2e/block.py): the x = 40 mm end is fixed, and the
// top face, z = 10 mm and 800 mm² (1.24 in²), carries 0.5 MPa and 100 lbf downwards. The test
// signs in as the first seeded user, after E-01, and leaves its unit system as it found it.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { newProject } from "./home";

const MODEL = process.env.CLEARFEA_E2E_MODEL ?? "";
const OUT = process.env.CLEARFEA_E2E_OUT ?? "e2e-results";

// The one units table, so the test has no conversion factor of its own (CLAUDE.md).
const table = JSON.parse(readFileSync(new URL("../../../packages/spec/units.json", import.meta.url), "utf8")) as {
  kinds: Record<string, { units: Record<string, { factor: number; offset?: number }> }>;
};
/** A value in a unit, in SI. Only kinds without an offset are used here. */
function si(value: number, kind: string, unit: string): number {
  const entry = table.kinds[kind]?.units[unit];
  if (!entry) throw new Error(`units.json has no ${kind} unit ${unit}.`);
  return value * entry.factor;
}

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
 * Clicks the face in the viewer the way a user does: moves the pointer until the viewer names it.
 * Returns the hover line it clicked on, which carries the face's area in the system's unit.
 */
async function clickFace(page: Page, tag: number): Promise<string> {
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
      const text = (await hover.textContent()) ?? "";
      if (text.startsWith(`Face ${tag},`)) {
        await page.mouse.click(x, y);
        return text;
      }
    }
  }
  throw new Error(`Face ${tag} was not found under the pointer anywhere on the viewer.`);
}

/** Opens a row of the simulation tree by its label. */
function treeRow(page: Page, label: string): Locator {
  return page.getByRole("navigation", { name: "Simulation tree" }).getByRole("button", { name: new RegExp(`^${label},`) });
}

async function saved(page: Page): Promise<void> {
  await expect(page.getByText("All changes saved.")).toBeVisible();
}

/** The numbers of a "(x, y, z) unit" text that follows a label. */
function vector(text: string, label: string, unit: string): number[] {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\(([^)]*)\\) ${unit}`).exec(text);
  if (!match?.[1]) throw new Error(`No "${label}" in ${unit} in: ${text}`);
  return match[1].split(",").map(Number);
}

const relative = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

test("E-02: values entered in mixed units", async ({ page }) => {
  expect(MODEL, "CLEARFEA_E2E_MODEL names the STEP file; run the test with `make e2e`").not.toBe("");
  const system = page.getByRole("combobox", { name: "Unit system", exact: true });

  await test.step("sign in and choose the US unit system", async () => {
    await page.goto("/app");
    await page.getByLabel("Login").fill("alice");
    await page.getByLabel("Password").fill("alice-local");
    await page.getByRole("button", { name: "Sign in" }).click();
    // The new project's system loads with it; newProject waits for it, so a choice is not drawn over.
    await newProject(page, "E-02 mixed units");
    await expect(system).toHaveValue("metric-mm");
    await system.selectOption("us-in");
    await expect(system).toHaveValue("us-in");
  });

  await test.step("upload the block, which is in millimetres, and start the setup", async () => {
    const geometry = page.getByRole("region", { name: "Geometry", exact: true });
    await geometry.locator('input[type="file"]').setInputFiles({
      name: basename(MODEL),
      mimeType: "application/step",
      buffer: readFileSync(MODEL),
    });
    await expect(geometry.getByText("The file says its length unit is")).toBeVisible({ timeout: 120_000 });
    // The file's own unit, not the system's.
    await expect(geometry.getByLabel("Length unit of the file")).toHaveValue("mm");
    await geometry.getByRole("button", { name: "Confirm unit" }).click();
    await expect(geometry.getByText("40 × 20 × 10 mm")).toBeVisible();
    await page.getByRole("button", { name: "Start setup" }).click();
    await expect(treeRow(page, "Materials")).toBeVisible();
  });

  const settings = page.getByRole("complementary", { name: "Settings" });
  const material = page.getByRole("region", { name: "Material", exact: true });

  await test.step("a material in GPa and ksi", async () => {
    await treeRow(page, "Materials").click();
    await page.getByRole("button", { name: "Add an empty material" }).click();
    await material.getByLabel("Name", { exact: true }).fill("Steel");
    // An empty field offers the system's unit; the user picks another.
    await expect(material.getByLabel("Young's modulus unit")).toHaveValue("psi");
    await material.getByLabel("Young's modulus", { exact: true }).fill("200");
    await material.getByLabel("Young's modulus unit").selectOption("GPa");
    await material.getByLabel("Poisson's ratio").fill("0.3");
    await expect(material.getByLabel("Yield strength unit")).toHaveValue("psi");
    await material.getByLabel("Yield strength", { exact: true }).fill("36");
    await material.getByLabel("Yield strength unit").selectOption("ksi");
    await saved(page);
    await expect(treeRow(page, "Steel")).toHaveAccessibleName("Steel, complete");
    await page.screenshot({ path: `${OUT}/e02-material.png` });
  });

  const end = await faceWithBox(page, [0.04, 0, 0], [0.04, 0.02, 0.01]);
  const top = await faceWithBox(page, [0, 0, 0.01], [0.04, 0.02, 0.01]);
  const selection = page.getByRole("region", { name: "Selected faces", exact: true });

  await test.step("fixed support on the end face", async () => {
    await clickFace(page, end);
    await expect(selection).toContainText(`1 face selected: ${end}`);
    await treeRow(page, "Supports").click();
    await page.getByRole("button", { name: "Add a fixed support" }).click();
    await saved(page);
  });

  await test.step("a pressure in MPa and a force in lbf on the top face", async () => {
    await selection.getByRole("button", { name: "Clear" }).click();
    const hover = await clickFace(page, top);
    // The hover line gives the face's area in the system's unit: 800 mm² is 1.24 in².
    const area = Number(/, ([\d.e+-]+) in²$/.exec(hover)?.[1]);
    expect(relative(si(area, "area", "in²"), si(800, "area", "mm²"))).toBeLessThan(1e-3);
    await expect(selection).toContainText(`1 face selected: ${top}`);

    await treeRow(page, "Loads").click();
    await page.getByRole("button", { name: "Add a pressure" }).click();
    const pressure = page.getByRole("region", { name: "Pressure", exact: true });
    await pressure.getByLabel("Name", { exact: true }).fill("Top pressure");
    await expect(pressure.getByLabel("Magnitude unit")).toHaveValue("psi");
    await pressure.getByLabel("Magnitude", { exact: true }).fill("0.5");
    await pressure.getByLabel("Magnitude unit").selectOption("MPa");
    await saved(page);

    await treeRow(page, "Loads").click();
    await page.getByRole("button", { name: "Add a force" }).click();
    const force = page.getByRole("region", { name: "Force", exact: true });
    await force.getByLabel("Name", { exact: true }).fill("Top force");
    const components = force.getByRole("group", { name: "Force (global axes)" });
    for (const [axis, value] of [
      ["x", "0"],
      ["y", "0"],
      ["z", "-100"],
    ] as const) {
      await expect(components.getByLabel(`${axis} unit`)).toHaveValue("lbf");
      await components.getByLabel(axis, { exact: true }).fill(value);
    }
    await saved(page);
    await expect(treeRow(page, "Top force")).toHaveAccessibleName("Top force, complete");
    await page.screenshot({ path: `${OUT}/e02-force.png` });
  });

  await test.step("a mesh size in mm", async () => {
    await treeRow(page, "Mesh").click();
    const mesh = page.getByRole("region", { name: "Mesh", exact: true });
    await expect(mesh.getByLabel("Global size unit")).toHaveValue("in");
    await mesh.getByLabel("Global size", { exact: true }).fill("5");
    await mesh.getByLabel("Global size unit").selectOption("mm");
    await saved(page);
  });

  await test.step("the setup keeps each value in the unit it was typed in", async () => {
    // As stored by the API: the value and unit as typed, converted only for the solver (ADR-038).
    const list = await page.request.get("/api/simulations");
    const { simulations } = (await list.json()) as { simulations: { id: string; spec: Spec }[] };
    const spec = simulations[0]?.spec;
    expect(spec?.materials[0]?.youngsModulus).toEqual({ value: 200, unit: "GPa" });
    expect(spec?.materials[0]?.yieldStrength).toEqual({ value: 36, unit: "ksi" });
    const loads = new Map(spec?.loads.map((load) => [load.name, load]));
    expect(loads.get("Top pressure")?.magnitude).toEqual({ value: 0.5, unit: "MPa" });
    expect(loads.get("Top force")?.z).toEqual({ value: -100, unit: "lbf" });
    expect(spec?.mesh.size).toEqual({ value: 5, unit: "mm" });

    // And in the browser after the page is opened again.
    await page.reload();
    await expect(system).toHaveValue("us-in");
    await treeRow(page, "Steel").click();
    await expect(material.getByLabel("Young's modulus", { exact: true })).toHaveValue("200");
    await expect(material.getByLabel("Young's modulus unit")).toHaveValue("GPa");
    await expect(material.getByLabel("Yield strength unit")).toHaveValue("ksi");
    await treeRow(page, "Top pressure").click();
    await expect(page.getByRole("region", { name: "Pressure", exact: true }).getByLabel("Magnitude unit")).toHaveValue(
      "MPa",
    );
  });

  const run = settings.getByRole("region", { name: "Run", exact: true });
  const results = run.getByLabel("Run results");
  // What each load totals to, in N, from the values as typed and the units table.
  const pressureN = -si(0.5, "pressure", "MPa") * si(800, "area", "mm²");
  const forceN = si(-100, "force", "lbf");

  await test.step("mesh and run", async () => {
    await treeRow(page, "Mesh").click();
    await page.getByRole("region", { name: "Mesh", exact: true }).getByRole("button", { name: "Generate mesh" }).click();
    await expect(page.getByText(/^Mesh: [\d,]+ elements, [\d,]+ nodes$/)).toBeVisible({ timeout: 120_000 });
    await treeRow(page, "Run").click();
    await expect(run.getByRole("region", { name: "Before running", exact: true })).toHaveCount(0);
    await expect(run.getByRole("button", { name: "Run", exact: true })).toBeEnabled({ timeout: 10_000 });
    await run.getByRole("button", { name: "Run", exact: true }).click();
    await expect(results).toContainText("Largest von Mises stress", { timeout: 180_000 });
  });

  await test.step("the solver got SI values", async () => {
    const list = await page.request.get("/api/simulations");
    const { simulations } = (await list.json()) as { simulations: { id: string }[] };
    const runs = await page.request.get(`/api/simulations/${simulations[0]?.id}/runs`);
    const { runs: all } = (await runs.json()) as { runs: { id: string }[] };
    const deck = await page.request.get(`/api/runs/${all[0]?.id}/files/deck.inp`);
    expect(deck.ok()).toBe(true);
    const lines = (await deck.text()).split(/\r?\n/);
    const elastic = lines[lines.indexOf("*ELASTIC") + 1]?.split(",").map(Number) ?? [];
    expect(relative(elastic[0] ?? 0, si(200, "pressure", "GPa"))).toBeLessThan(1e-12);
    expect(elastic[1]).toBe(0.3);
  });

  await test.step("load totals and reactions in the system's units", async () => {
    const text = (await results.textContent()) ?? "";
    const lbf = (newtons: number) => newtons / si(1, "force", "lbf");
    // Four figures are shown.
    expect(relative(vector(text, "Applied, Top pressure", "lbf")[2] ?? 0, lbf(pressureN))).toBeLessThan(1e-3);
    expect(vector(text, "Applied, Top force", "lbf")).toEqual([0, 0, -100]);
    const reaction = vector(text, "Reaction, Fixed support 1", "lbf");
    expect(relative(reaction[2] ?? 0, -lbf(pressureN + forceN))).toBeLessThan(1e-3);
    const balance = /Out of balance.*force ([\d.e+-]+) % of [\d.]+ lbf/;
    expect(text).toMatch(balance);
    expect(Number(balance.exec(text)?.[1])).toBeLessThan(0.1);
    await expect(page.locator("body")).not.toContainText(/\b(PASS|FAIL)\b|compliant/i);
    await results.getByText("Applied, Top pressure").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/e02-totals-us.png` });
  });

  await test.step("back to the metric system: typed values keep their units", async () => {
    await system.selectOption("metric-mm");
    await expect(system).toHaveValue("metric-mm");
    await expect(results).toContainText(/Applied, Top force\s*\(0, 0, -444\.8\) N/);
    const text = (await results.textContent()) ?? "";
    expect(relative(vector(text, "Applied, Top pressure", "N")[2] ?? 0, pressureN)).toBeLessThan(1e-3);
    await results.getByText("Applied, Top pressure").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/e02-totals-metric.png` });
    await treeRow(page, "Top force").click();
    const components = page.getByRole("region", { name: "Force", exact: true }).getByRole("group", { name: "Force (global axes)" });
    await expect(components.getByLabel("z unit")).toHaveValue("lbf");
    await treeRow(page, "Steel").click();
    await expect(material.getByLabel("Young's modulus unit")).toHaveValue("GPa");
    await expect(material.getByLabel("Yield strength unit")).toHaveValue("ksi");
    await page.screenshot({ path: `${OUT}/e02-metric-material.png` });
  });
});

type Spec = {
  materials: { youngsModulus: unknown; yieldStrength: unknown }[];
  loads: { name: string; magnitude?: unknown; z?: unknown }[];
  mesh: { size: unknown };
};
