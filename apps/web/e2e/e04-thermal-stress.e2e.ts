// SPDX-License-Identifier: AGPL-3.0-or-later
// E-04 (docs/VERIFICATION.md): a thermal stress analysis from upload to results, through the UI
// (M5.4). The setup takes the thermal stress analysis type and its stress-free temperature, a
// material with both elastic and thermal values, a support, a fixed temperature and convection; the run
// shows its stresses on the deformed shape and its temperatures, heat flows and heat balance,
// and the temperature can be drawn from the same result.
//
// The model is E-01's 40 × 20 × 10 mm block (e2e/block.py). Its top face, z = 10 mm, is held at
// 120 °C, and its x = 40 mm end is fixed and cooled by convection to 20 °C, the stress-free
// temperature. (Two fixed temperatures on faces that share an edge are refused, ADR-064.) Both
// faces look towards the viewer's starting camera, as in E-01. The test signs in as the second
// seeded user, as E-03 does, after it.
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

/** Clicks the face in the viewer the way a user does: moves the pointer until the viewer names it. */
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
      if (((await hover.textContent()) ?? "").startsWith(`Face ${tag},`)) {
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

test("E-04: a thermal stress analysis from upload to results", async ({ page }) => {
  expect(MODEL, "CLEARFEA_E2E_MODEL names the STEP file; run the test with `make e2e`").not.toBe("");

  await test.step("sign in", async () => {
    await page.goto("/");
    await page.getByLabel("Login").fill("bob");
    await page.getByLabel("Password").fill("bob-local");
    await page.getByRole("button", { name: "Sign in" }).click();
  });

  await test.step("upload the block and start the setup", async () => {
    const geometry = page.getByRole("region", { name: "Geometry", exact: true });
    await geometry.locator('input[type="file"]').setInputFiles({
      name: basename(MODEL),
      mimeType: "application/step",
      buffer: readFileSync(MODEL),
    });
    await expect(geometry.getByText("The file says its length unit is")).toBeVisible({ timeout: 120_000 });
    await geometry.getByRole("button", { name: "Confirm unit" }).click();
    await expect(geometry.getByText("40 × 20 × 10 mm")).toBeVisible();
    await page.getByRole("button", { name: "Start setup" }).click();
    await expect(treeRow(page, "Analysis")).toBeVisible();
  });

  const settings = page.getByRole("complementary", { name: "Settings" });

  await test.step("choose a thermal stress analysis and its stress-free temperature", async () => {
    await treeRow(page, "Analysis").click();
    const analysis = settings.getByRole("region", { name: "Analysis", exact: true });
    await analysis.getByRole("radio", { name: "Thermal stress" }).check();
    await expect(analysis.getByText("Enter the stress-free temperature.")).toBeVisible();
    await analysis.getByLabel("Stress-free temperature", { exact: true }).fill("20");
    await expect(analysis.getByLabel("Stress-free temperature unit")).toHaveValue("°C");
    await saved(page);
    await expect(treeRow(page, "Analysis")).toHaveAccessibleName("Analysis, complete");
    await page.screenshot({ path: `${OUT}/e04-analysis.png` });
  });

  await test.step("a material with elastic and thermal values", async () => {
    await treeRow(page, "Materials").click();
    await page.getByRole("button", { name: "Add an empty material" }).click();
    const material = page.getByRole("region", { name: "Material", exact: true });
    await material.getByLabel("Name", { exact: true }).fill("Steel");
    await material.getByLabel("Young's modulus", { exact: true }).fill("200");
    await material.getByLabel("Young's modulus unit").selectOption("GPa");
    await material.getByLabel("Poisson's ratio").fill("0.3");
    await material.getByLabel("Thermal expansion", { exact: true }).fill("12");
    await material.getByLabel("Thermal expansion unit").selectOption("µm/(m·K)");
    await material.getByLabel("Thermal conductivity", { exact: true }).fill("45");
    await material.getByLabel("Thermal conductivity unit").selectOption("W/(m·K)");
    await saved(page);
  });

  const end = await faceWithBox(page, [0.04, 0, 0], [0.04, 0.02, 0.01]);
  const top = await faceWithBox(page, [0, 0, 0.01], [0.04, 0.02, 0.01]);
  const selection = page.getByRole("region", { name: "Selected faces", exact: true });

  await test.step("fixed support and convection on the end", async () => {
    await clickFace(page, end);
    await expect(selection).toContainText(`1 face selected: ${end}`);
    await treeRow(page, "Supports").click();
    await page.getByRole("button", { name: "Add a fixed support" }).click();
    await saved(page);

    // Both kinds of load are offered; a uniform temperature change is not.
    await treeRow(page, "Loads").click();
    const loads = settings.getByRole("region", { name: "Loads", exact: true });
    await expect(loads.getByRole("button", { name: "Add a pressure" })).toBeVisible();
    await expect(loads.getByRole("button", { name: "Add a temperature change" })).toHaveCount(0);
    await loads.getByRole("button", { name: "Add convection" }).click();
    const convection = page.getByRole("region", { name: "Convection", exact: true });
    await convection.getByLabel("Name", { exact: true }).fill("Cooled end");
    await convection.getByLabel("Convection coefficient", { exact: true }).fill("1000");
    await convection.getByLabel("Convection coefficient unit").selectOption("W/(m²·K)");
    await convection.getByLabel("Ambient temperature", { exact: true }).fill("20");
    await saved(page);
  });

  await test.step("120 °C on the top", async () => {
    await selection.getByRole("button", { name: "Clear" }).click();
    await clickFace(page, top);
    await expect(selection).toContainText(`1 face selected: ${top}`);
    await treeRow(page, "Loads").click();
    await page.getByRole("button", { name: "Add a fixed temperature" }).click();
    const fixed = page.getByRole("region", { name: "Fixed temperature", exact: true });
    await fixed.getByLabel("Name", { exact: true }).fill("Hot top");
    await fixed.getByLabel("Temperature", { exact: true }).fill("120");
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

  const run = settings.getByRole("region", { name: "Run", exact: true });
  const legend = page.getByRole("region", { name: "Legend", exact: true });

  await test.step("run and see the stresses on the deformed shape", async () => {
    await treeRow(page, "Run").click();
    await expect(run.getByRole("region", { name: "Before running", exact: true })).toHaveCount(0);
    await run.getByRole("button", { name: "Run", exact: true }).click();
    const results = run.getByLabel("Run results");
    await expect(results).toContainText("Largest von Mises stress", { timeout: 180_000 });
    await expect(legend).toContainText("Von Mises stress (MPa)", { timeout: 60_000 });
    await expect(legend).toContainText("Deformed shape, scale ×");
    // No load is applied, so the support's forces balance each other node by node (ADR-067).
    const balance = /Out of balance.*force ([\d.e+-]+) % of [\d.]+ N, moment ([\d.e+-]+) % of [\d.]+ N·mm/;
    await expect(results).toContainText(balance);
    const [, force, moment] = balance.exec((await results.textContent()) ?? "") ?? [];
    expect(Number(force)).toBeLessThan(0.1);
    expect(Number(moment)).toBeLessThan(0.1);
    await page.screenshot({ path: `${OUT}/e04-stress.png` });
  });

  await test.step("the same run's temperatures, heat flows and heat balance", async () => {
    const thermal = run.getByLabel("Thermal results");
    // The fixed temperature is the highest; the result keeps five significant digits.
    await expect(thermal).toContainText(/Highest temperature\s*120 °C/);
    await expect(thermal).toContainText("Lowest temperature");
    // What the top takes in, the cooled end gives off.
    const flows = /Heat flow, Cooled end\s*([\d.]+) W out.*Heat flow, Hot top\s*([\d.]+) W in/;
    await expect(thermal).toContainText(flows);
    const [, out, into] = flows.exec((await thermal.textContent()) ?? "") ?? [];
    expect(Number(out)).toBeGreaterThan(0);
    expect(Math.abs(Number(out) - Number(into)) / Number(into)).toBeLessThan(0.001);
    const balance = /Out of balance\s*([\d.e+-]+) %/;
    await expect(thermal).toContainText(balance);
    expect(Number(balance.exec((await thermal.textContent()) ?? "")?.[1])).toBeLessThan(0.1);
    await thermal.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/e04-thermal.png` });
  });

  await test.step("draw the temperature of the same result", async () => {
    await settings.getByLabel("Quantity").selectOption("temperature");
    await expect(legend).toContainText("Temperature (°C)");
    await expect(legend).toContainText("Deformed shape, scale ×");
    await page.screenshot({ path: `${OUT}/e04-temperature.png` });
    const exports = settings.getByRole("region", { name: "Export", exact: true });
    await expect(exports.getByRole("button", { name: "Reactions and loads (CSV)" })).toBeVisible();
    await expect(exports.getByRole("button", { name: "Heat flows (CSV)" })).toBeVisible();
  });
});
