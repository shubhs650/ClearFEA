// SPDX-License-Identifier: AGPL-3.0-or-later
// E-01 (docs/VERIFICATION.md): upload, select faces, material, support, pressure, mesh, run, see
// the contour and switch to other result quantities (M3.1), read reactions (M3.2), and read the
// min/max markers and probe a node (M3.3), cut it with a plane (M3.4) and show the safety factor against
// yield (M3.5), all through the UI. The model is a
// 40 × 20 × 10 mm block (e2e/block.py), fixed at its x = 40 mm end and pressed on its top face,
// z = 10 mm. Both faces look towards the viewer's starting camera, so they can be clicked
// without turning the model.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
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
    await run.getByRole("button", { name: "Run", exact: true }).click();
    await expect(run.getByLabel("Run results")).toContainText("Largest von Mises stress", { timeout: 180_000 });
    await expect(run.getByLabel("Run record")).toContainText(/Estimate.*about \d+ s/);

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
});
