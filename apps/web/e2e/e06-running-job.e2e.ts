// SPDX-License-Identifier: AGPL-3.0-or-later
// E-06 (docs/VERIFICATION.md): a running job (M8.2). A run long enough to watch shows its stage,
// elapsed time and cost so far against the estimate and its live log; cancelling it stops the
// solver, the run says it was cancelled and what the time it used cost, and the wallet lists the
// charge. Then (M8.3) the same simulation runs again with its stop limit set to half the
// estimate (never under 30 s): the run is stopped there, says so, and its time is charged.
//
// The model is E-01's 40 × 20 × 10 mm block (e2e/block.py), fixed at its x = 40 mm end and
// pressed on its top face, meshed at 1 mm with ten-node elements (about 56,000 nodes) and solved
// with SPOOLES, which takes CalculiX about two minutes: long enough to cancel well before the
// end. The test signs in as the second seeded user, as E-03 and E-04 do, after them.
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

/**
 * Signs in as bob and sets up the block for a slow run: material, support, pressure, a 1 mm
 * quadratic mesh and SPOOLES. Answers the Run panel, ready to run.
 */
async function slowRun(page: Page): Promise<Locator> {
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
    await expect(treeRow(page, "Materials")).toBeVisible();
  });

  await test.step("material, support and pressure", async () => {
    await treeRow(page, "Materials").click();
    await page.getByRole("button", { name: "Add an empty material" }).click();
    const material = page.getByRole("region", { name: "Material", exact: true });
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
  });

  await test.step("a fine mesh", async () => {
    await treeRow(page, "Mesh").click();
    const mesh = page.getByRole("region", { name: "Mesh", exact: true });
    await mesh.getByLabel("Global size", { exact: true }).fill("1");
    await mesh.getByLabel("Global size unit").selectOption("mm");
    await saved(page);
    await mesh.getByRole("button", { name: "Generate mesh" }).click();
    await expect(page.getByText(/^Mesh: [\d,]+ elements, [\d,]+ nodes$/)).toBeVisible({ timeout: 180_000 });
  });

  return test.step("SPOOLES, the slowest direct solver", async () => {
    await treeRow(page, "Run").click();
    const run = page.getByRole("complementary", { name: "Settings" }).getByRole("region", { name: "Run", exact: true });
    await run.getByLabel("Equation solver").selectOption("spooles");
    await saved(page);
    await expect(run.getByRole("region", { name: "Estimate", exact: true })).toContainText(/about [\d.]+ min/);
    await expect(run.getByRole("button", { name: "Run", exact: true })).toBeEnabled({ timeout: 10_000 });
    return run;
  });
}

test("E-06: a running job shows its progress, can be cancelled, and stops at its limit", async ({ page }) => {
  // Two slow runs after a fine mesh: longer than the default five minutes.
  test.setTimeout(12 * 60_000);
  const run = await slowRun(page);
  const job = run.getByRole("region", { name: "Running job", exact: true });

  await test.step("watch it solve: stage, time and cost against the estimate, live log", async () => {
    await run.getByRole("button", { name: "Run", exact: true }).click();
    await expect(job.getByRole("status", { name: "Run stage" })).toHaveText("Solver: solving…", { timeout: 120_000 });
    await expect(job.getByTestId("run-elapsed")).toHaveText(/^\d+:\d\d of about [\d.]+ min estimated$/);
    await expect(job.getByTestId("run-cost-so-far")).toHaveText(/^[\d.]+ credits of about [\d.]+ credits estimated$/);
    // The clock runs on between the API's answers.
    const first = await job.getByTestId("run-elapsed").textContent();
    await expect(job.getByTestId("run-elapsed")).not.toHaveText(first ?? "", { timeout: 5_000 });
    await expect(run.locator(".run-log pre")).toContainText("CalculiX", { timeout: 60_000 });
    await expect(run.getByRole("button", { name: "Run again" })).toBeDisabled();
    await page.screenshot({ path: `${OUT}/e06-running.png` });
  });

  await test.step("cancel it", async () => {
    await job.getByRole("button", { name: "Cancel the run" }).click();
    await expect(job.getByRole("status", { name: "Run stage" })).toHaveText(/^Cancelling/);
    await expect(job.getByRole("button", { name: "Cancel the run" })).toBeDisabled();
    await page.screenshot({ path: `${OUT}/e06-cancelling.png` });
    // The worker hears at its next heartbeat (every 5 s) and stops the solver.
    await expect(job).toBeHidden({ timeout: 60_000 });
    await expect(treeRow(page, "Run")).toHaveAttribute(
      "title",
      /^You cancelled the run after [\d a-z]+\. The time it used is charged\. Run it again for results\.$/,
    );
    const record = run.getByLabel("Run record");
    await expect(record).toContainText(/Cost\s*[\d.]+ credits for \d+ s/);
    // The deck and the log so far are kept with the cancelled run.
    await expect(record.getByRole("link", { name: "View solver.log" })).toBeVisible();
    await expect(run.getByRole("button", { name: "Run again" })).toBeEnabled();
    await page.screenshot({ path: `${OUT}/e06-cancelled.png` });
  });

  await test.step("the wallet lists the cancelled run's charge", async () => {
    await page.getByRole("contentinfo", { name: "Status" }).getByRole("button", { name: "Wallet" }).click();
    const ledger = page.getByRole("region", { name: "Wallet" }).getByRole("table", { name: "Ledger" });
    await expect(ledger.getByRole("row", { name: /Run of “.*\(cancelled\)/ }).first()).toBeVisible();
    await page.screenshot({ path: `${OUT}/e06-wallet.png` });
    await page.getByRole("region", { name: "Wallet" }).getByRole("button", { name: "Back to the workbench" }).click();
  });

  await test.step("run again with the stop limit at half the estimate", async () => {
    await treeRow(page, "Run").click();
    const estimate = run.getByRole("region", { name: "Estimate", exact: true });
    const limit = estimate.getByRole("spinbutton", { name: "Stop limit (× the estimated time)" });
    await expect(limit).toHaveValue("3");
    await limit.fill("0.5");
    await expect(estimate.getByTestId("stop-limit-hint")).toHaveText(
      /^The run is stopped if it is still solving after (\d+ s|\d+:\d\d), and the time it used is charged\.$/,
    );
    await page.screenshot({ path: `${OUT}/e06-stop-limit.png` });
    await run.getByRole("button", { name: "Run again" }).click();
    await expect(job.getByRole("status", { name: "Run stage" })).toHaveText("Solver: solving…", { timeout: 120_000 });
    await expect(job.getByTestId("run-stop-limit")).toHaveText(/^(\d+ s|\d+:\d\d) \(0\.5 × the estimate\)$/);
    await page.screenshot({ path: `${OUT}/e06-running-limit.png` });
  });

  await test.step("the run is stopped at its limit and charged for its time", async () => {
    // The limit is under a minute of the solver's time; the worker hears at its next heartbeat.
    await expect(job).toBeHidden({ timeout: 180_000 });
    await expect(treeRow(page, "Run")).toHaveAttribute(
      "title",
      /^The run reached its stop limit of [\d a-z]+ \(0\.5 × the estimated time\) and was stopped after [\d a-z]+\. The time it used is charged\. If it needs longer, raise the stop limit and run it again; a coarser mesh or a faster solver also shortens it\.$/,
    );
    const record = run.getByLabel("Run record");
    await expect(record).toContainText(/Stop limit\s*(\d+ s|\d+:\d\d) \(0\.5 × the estimated time\)/);
    await expect(record).toContainText(/Cost\s*[\d.]+ credits for \d+ s/);
    await expect(record.getByRole("link", { name: "View solver.log" })).toBeVisible();
    await page.screenshot({ path: `${OUT}/e06-stopped.png` });
    await page.getByRole("contentinfo", { name: "Status" }).getByRole("button", { name: "Wallet" }).click();
    const ledger = page.getByRole("region", { name: "Wallet" }).getByRole("table", { name: "Ledger" });
    await expect(ledger.getByRole("row", { name: /Run of “.*\(stopped at its limit\)/ }).first()).toBeVisible();
  });
});
