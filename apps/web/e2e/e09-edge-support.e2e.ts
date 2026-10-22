// SPDX-License-Identifier: AGPL-3.0-or-later
// E-09 (docs/VERIFICATION.md): a support on edges (ADR-105), through the UI. The model is E-01's
// 40 × 20 × 10 mm block (e2e/block.py). A fixed support holds two edges of its x = 40 mm end, the
// bottom edge (z = 0) and the upright edge at y = 0: two lines through one corner hold every
// rigid-body motion. The top face, z = 10 mm, is pressed. The edges are picked in the viewer the way
// a user does, with the support's "Edges" choice, and drawn wide; the run's reactions on the edges
// balance the pressure. The edges and the top face look towards the viewer's starting camera.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { newProject } from "./home";

const MODEL = process.env.CLEARFEA_E2E_MODEL ?? "";
const OUT = process.env.CLEARFEA_E2E_OUT ?? "e2e-results";

type Tagged = { tag: number; bbox: number[] };

/** The tag of the one face or edge of the newest geometry whose box is the given one, in metres. */
async function withBox(page: Page, kind: "faces" | "edges", lo: number[], hi: number[]): Promise<number> {
  const list = await page.request.get("/api/geometries");
  expect(list.ok()).toBe(true);
  const { geometries } = (await list.json()) as { geometries: { id: string }[] };
  const newest = geometries[0];
  if (!newest) throw new Error("The API lists no geometry.");
  const reply = await page.request.get(`/api/geometries/${newest.id}/topology`);
  expect(reply.ok()).toBe(true);
  const items = ((await reply.json()) as Record<string, Tagged[]>)[kind] ?? [];
  const close = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 1e-6;
  const matches = items.filter((item) => lo.every((v, i) => close(item.bbox[i], v)) && hi.every((v, i) => close(item.bbox[3 + i], v)));
  expect(matches, `one of the ${kind} with box ${lo} to ${hi}`).toHaveLength(1);
  return (matches[0] as Tagged).tag;
}

/**
 * Clicks a face or edge in the viewer, the way a user does: moves the pointer over the model until
 * the viewer names it under the pointer, then clicks there. Edges are thin, so the grid is finer.
 */
async function clickItem(page: Page, what: "Face" | "Edge", tag: number): Promise<void> {
  const canvas = page.locator(".viewer-canvas canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("The viewer has no canvas.");
  const hover = page.locator(".viewer-hover");
  const steps = what === "Edge" ? 64 : 24;
  for (let i = 1; i < steps; i++) {
    for (let j = 1; j < steps; j++) {
      const x = box.x + (box.width * i) / steps;
      const y = box.y + (box.height * j) / steps;
      await page.mouse.move(x, y);
      if ((await hover.textContent())?.startsWith(`${what} ${tag},`)) {
        await page.mouse.click(x, y);
        return;
      }
    }
  }
  throw new Error(`${what} ${tag} was not found under the pointer anywhere on the viewer.`);
}

function treeRow(page: Page, label: string): Locator {
  return page.getByRole("navigation", { name: "Simulation tree" }).getByRole("button", { name: new RegExp(`^${label},`) });
}

async function saved(page: Page): Promise<void> {
  await expect(page.getByText("All changes saved.")).toBeVisible();
}

test("E-09: a fixed support on edges picked in the viewer", async ({ page }) => {
  expect(MODEL, "CLEARFEA_E2E_MODEL names the STEP file; run the test with `make e2e`").not.toBe("");

  await test.step("sign in, upload the block and start the setup", async () => {
    await page.goto("/app");
    await page.getByLabel("Login").fill("alice");
    await page.getByLabel("Password").fill("alice-local");
    await page.getByRole("button", { name: "Sign in" }).click();
    await newProject(page, "E-09 edge support");
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
    await expect(treeRow(page, "Materials")).toBeVisible();
  });

  await test.step("material", async () => {
    await treeRow(page, "Materials").click();
    await page.getByRole("button", { name: "Add an empty material" }).click();
    const material = page.getByRole("region", { name: "Material", exact: true });
    await material.getByLabel("Young's modulus", { exact: true }).fill("200");
    await material.getByLabel("Young's modulus unit").selectOption("GPa");
    await material.getByLabel("Poisson's ratio").fill("0.3");
    await saved(page);
  });

  const bottom = await withBox(page, "edges", [0.04, 0, 0], [0.04, 0.02, 0]);
  const upright = await withBox(page, "edges", [0.04, 0, 0], [0.04, 0, 0.01]);
  const top = await withBox(page, "faces", [0, 0, 0.01], [0.04, 0.02, 0.01]);

  await test.step("fixed support on two edges, picked in edge mode", async () => {
    await treeRow(page, "Supports").click();
    await page.getByRole("button", { name: "Add a fixed support" }).click();
    const support = page.getByRole("region", { name: "Fixed support", exact: true });
    await expect(support.getByText(/Pick the faces or edges to fix/)).toBeVisible();
    await support.getByLabel("Edges", { exact: true }).check();
    await expect(page.getByText(/Click an edge to select it/)).toBeVisible();
    await clickItem(page, "Edge", upright);
    const selection = page.getByRole("region", { name: "Selected edges", exact: true });
    await expect(selection).toContainText(`1 edge selected: ${upright}`);
    await clickItem(page, "Edge", bottom);
    await expect(selection).toContainText("2 edges selected");
    // The pointer stays on the bottom edge, which is drawn hovered; the other is selected.
    await page.screenshot({ path: `${OUT}/e09-edges-picked.png` });
    await support.getByRole("button", { name: "Use the 2 selected edges" }).click();
    await expect(support.getByText([bottom, upright].sort((a, b) => a - b).join(", "), { exact: true })).toBeVisible();
    await saved(page);
    await expect(treeRow(page, "Fixed support 1")).toHaveAccessibleName(/complete/);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${OUT}/e09-edge-support.png` });
  });

  await test.step("pressure on the top face", async () => {
    await treeRow(page, "Loads").click();
    await page.getByRole("button", { name: "Add a pressure" }).click();
    await clickItem(page, "Face", top);
    const pressure = page.getByRole("region", { name: "Pressure", exact: true });
    await pressure.getByRole("button", { name: "Use the selected face" }).click();
    await pressure.getByLabel("Magnitude", { exact: true }).fill("1");
    await pressure.getByLabel("Magnitude unit").selectOption("MPa");
    await saved(page);
  });

  await test.step("mesh and run; the edges' reaction balances the pressure", async () => {
    await treeRow(page, "Mesh").click();
    const mesh = page.getByRole("region", { name: "Mesh", exact: true });
    await mesh.getByLabel("Global size", { exact: true }).fill("5");
    await mesh.getByLabel("Global size unit").selectOption("mm");
    await saved(page);
    await mesh.getByRole("button", { name: "Generate mesh" }).click();
    await expect(page.getByText(/^Mesh: [\d,]+ elements, [\d,]+ nodes$/)).toBeVisible({ timeout: 120_000 });
    await treeRow(page, "Run").click();
    const settings = page.getByRole("complementary", { name: "Settings" });
    const run = settings.getByRole("region", { name: "Run", exact: true });
    await expect(run.getByRole("button", { name: "Run", exact: true })).toBeEnabled({ timeout: 10_000 });
    await run.getByRole("button", { name: "Run", exact: true }).click();
    const results = run.getByLabel("Run results");
    await expect(results).toContainText("Largest von Mises stress", { timeout: 180_000 });
    // 1 MPa on 40 × 20 mm is 800 N down; the edges push back up.
    await expect(results).toContainText(/Reaction, Fixed support 1\s*\(.*, .*, 800(\.0+)?\) N/);
    await expect(results).toContainText("about the edges' centre");
    await expect(results).toContainText(/Out of balance.*force [\d.e-]+ % of/);
    await page.screenshot({ path: `${OUT}/e09-results.png` });
  });
});
