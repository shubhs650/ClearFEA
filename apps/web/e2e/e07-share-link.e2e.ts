// SPDX-License-Identifier: AGPL-3.0-or-later
// E-07 (docs/VERIFICATION.md): a second user cannot open the first user's project, and a revoked
// share link opens nothing (M8.7, ADR-083). Alice sets up and solves a block as in E-01 and makes a
// read-only link to the run. A browser that is not signed in opens the link and sees the results,
// and nothing to change. Bob, signed in, finds none of alice's geometry, simulation or run through
// the API. Alice revokes the link, and the same browser is told it does not work. The exhaustive
// route-by-route isolation tests are M8.8's.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { newProject } from "./home";

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

async function signIn(page: Page, login: string, password: string): Promise<void> {
  await page.goto("/app");
  await page.getByLabel("Login").fill(login);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** A page in a browser context of its own: its own cookies, so its own sign-in or none. */
async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  return context.newPage();
}

test("E-07: a second user cannot open the first user's project, and a revoked share link opens nothing", async ({
  page,
  browser,
}) => {
  expect(MODEL, "CLEARFEA_E2E_MODEL names the STEP file; run the test with `make e2e`").not.toBe("");

  await test.step("sign in as alice", async () => {
    await signIn(page, "alice", "alice-local");
    await newProject(page, "E-07 shared block");
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
    await expect(treeRow(page, "Materials")).toBeVisible();
  });

  const settings = page.getByRole("complementary", { name: "Settings" });
  await test.step("material, support, pressure and mesh", async () => {
    await treeRow(page, "Materials").click();
    await page.getByRole("button", { name: "Add an empty material" }).click();
    const material = page.getByRole("region", { name: "Material", exact: true });
    await material.getByLabel("Name", { exact: true }).fill("Steel");
    await material.getByLabel("Young's modulus", { exact: true }).fill("200");
    await material.getByLabel("Young's modulus unit").selectOption("GPa");
    await material.getByLabel("Poisson's ratio").fill("0.3");
    await saved(page);

    const end = await faceWithBox(page, [0.04, 0, 0], [0.04, 0.02, 0.01]);
    const top = await faceWithBox(page, [0, 0, 0.01], [0.04, 0.02, 0.01]);
    const selection = page.getByRole("region", { name: "Selected faces", exact: true });
    await clickFace(page, end);
    await expect(selection).toContainText(`1 face selected: ${end}`);
    await treeRow(page, "Supports").click();
    await page.getByRole("button", { name: "Add a fixed support" }).click();
    await saved(page);
    await selection.getByRole("button", { name: "Clear" }).click();
    await clickFace(page, top);
    await expect(selection).toContainText(`1 face selected: ${top}`);
    await treeRow(page, "Loads").click();
    await page.getByRole("button", { name: "Add a pressure" }).click();
    const pressure = page.getByRole("region", { name: "Pressure", exact: true });
    await pressure.getByLabel("Magnitude", { exact: true }).fill("1");
    await pressure.getByLabel("Magnitude unit").selectOption("MPa");
    await saved(page);

    await treeRow(page, "Mesh").click();
    const mesh = page.getByRole("region", { name: "Mesh", exact: true });
    await mesh.getByLabel("Global size", { exact: true }).fill("5");
    await mesh.getByLabel("Global size unit").selectOption("mm");
    await saved(page);
    await mesh.getByRole("button", { name: "Generate mesh" }).click();
    await expect(page.getByText(/^Mesh: [\d,]+ elements, [\d,]+ nodes$/)).toBeVisible({ timeout: 120_000 });
  });

  const run = settings.getByRole("region", { name: "Run", exact: true });
  await test.step("run", async () => {
    await treeRow(page, "Run").click();
    await expect(run.getByRole("button", { name: "Run", exact: true })).toBeEnabled({ timeout: 10_000 });
    await run.getByRole("button", { name: "Run", exact: true }).click();
    await expect(run.getByLabel("Run results")).toContainText("Largest von Mises stress", { timeout: 180_000 });
  });

  // Alice's records, by id, for bob to ask for.
  const ids = await test.step("note alice's geometry, simulation and run", async () => {
    const { geometries } = (await (await page.request.get("/api/geometries")).json()) as { geometries: { id: string }[] };
    const geometryId = geometries[0]?.id ?? "";
    const { simulations } = (await (await page.request.get(`/api/simulations?geometryId=${geometryId}`)).json()) as {
      simulations: { id: string }[];
    };
    const simulationId = simulations[0]?.id ?? "";
    const { runs } = (await (await page.request.get(`/api/simulations/${simulationId}/runs`)).json()) as {
      runs: { id: string }[];
    };
    const runId = runs[0]?.id ?? "";
    expect([geometryId, simulationId, runId].every((id) => id !== "")).toBe(true);
    return { geometryId, simulationId, runId };
  });

  const share = run.getByRole("region", { name: "Share", exact: true });
  const link = await test.step("make a read-only link", async () => {
    await share.getByRole("button", { name: "Make a read-only link" }).click();
    const field = share.getByLabel("Read-only link");
    await expect(field).toHaveValue(/\/share\/[A-Za-z0-9_-]{43}$/);
    await share.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/e07-share.png` });
    return field.inputValue();
  });

  const visitor = await freshPage(browser);
  await test.step("open the link without signing in", async () => {
    await visitor.goto(link);
    const record = visitor.getByRole("navigation", { name: "Shared run" });
    await expect(record).toContainText("Read-only");
    const results = visitor.getByRole("complementary", { name: "Results" });
    await expect(results.getByLabel("Run results")).toContainText("Largest von Mises stress");
    await expect(visitor.getByRole("region", { name: "Legend", exact: true })).toContainText("Von Mises stress (MPa)", {
      timeout: 60_000,
    });
    // Nothing to change: no sign-in, no setup, no run button, no share controls.
    await expect(visitor.getByRole("button", { name: "Sign in" })).toHaveCount(0);
    await expect(visitor.getByRole("navigation", { name: "Simulation tree" })).toHaveCount(0);
    await expect(visitor.getByRole("button", { name: /^Run/ })).toHaveCount(0);
    await expect(visitor.getByRole("region", { name: "Share" })).toHaveCount(0);
    // The link opens the run's results, not the owner's routes.
    expect((await visitor.request.get(`/api/runs/${ids.runId}`)).status()).toBe(401);
    await visitor.screenshot({ path: `${OUT}/e07-shared.png` });
  });

  await test.step("bob cannot open alice's project", async () => {
    const bob = await freshPage(browser);
    await signIn(bob, "bob", "bob-local");
    await expect(bob.getByText("Signed in as")).toBeVisible();
    const { geometries } = (await (await bob.request.get("/api/geometries")).json()) as { geometries: { id: string }[] };
    expect(geometries.map((g) => g.id)).not.toContain(ids.geometryId);
    for (const path of [
      `/api/geometries/${ids.geometryId}`,
      `/api/geometries/${ids.geometryId}/topology`,
      `/api/simulations/${ids.simulationId}`,
      `/api/runs/${ids.runId}`,
      `/api/runs/${ids.runId}/surface`,
      `/api/runs/${ids.runId}/share`,
    ]) {
      expect((await bob.request.get(path)).status(), path).toBe(404);
    }
    expect((await bob.request.delete(`/api/runs/${ids.runId}/share`)).status()).toBe(404);
    await bob.context().close();
  });

  await test.step("revoke the link; it opens nothing", async () => {
    await share.getByRole("button", { name: "Revoke the link" }).click();
    await expect(share.getByRole("button", { name: "Make a read-only link" })).toBeVisible();
    await visitor.reload();
    await expect(visitor.getByRole("alert")).toContainText("This share link does not work");
    await expect(visitor.getByRole("navigation", { name: "Shared run" })).toHaveCount(0);
    const token = link.split("/share/")[1] ?? "";
    expect((await visitor.request.get(`/api/shared/${token}`)).status()).toBe(404);
    expect((await visitor.request.get(`/api/shared/${token}/surface`)).status()).toBe(404);
    await visitor.screenshot({ path: `${OUT}/e07-revoked.png` });
    await visitor.context().close();
  });
});
