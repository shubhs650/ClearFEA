// SPDX-License-Identifier: AGPL-3.0-or-later
// E-03 (docs/VERIFICATION.md): a model of two bodies from upload to results, through the UI. The
// bodies are listed by their part names (M4.1), each gets its own material, the bond the import
// found between them is reviewed (M4.2), a body held only through a removed bond stops the run
// (M4.4), the bond ties the bodies in the solve so the reactions balance the load (M4.3), and the
// results carry the note on stresses near bonded faces (M4.5). Since M5.6 the same setup is then
// run as a thermal stress analysis, Lug's top hot and Base's end cooled by convection, so all the
// heat crosses the bond (ADR-069).
//
// The model (e2e/assembly.py) is "Base", a 40 × 20 × 10 mm block, and "Lug", a 30 × 20 × 10 mm
// block touching its x = 0 end. Base is fixed at its x = 40 mm end and Lug is pressed on its top
// face, z = 10 mm, so the load reaches the support only through the bond. Both faces look towards
// the viewer's starting camera, as in E-01. The test signs in as the second seeded user, so E-01's
// geometries and simulations are not in its lists.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";

const MODEL = process.env.CLEARFEA_E2E_ASSEMBLY ?? "";
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
 * viewer names that face under it, then clicks there. Returns the hover line, which in a model of
 * more than one body ends with the body's name.
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

test("E-03: a model of two bonded bodies from upload to results", async ({ page }) => {
  expect(MODEL, "CLEARFEA_E2E_ASSEMBLY names the STEP file; run the test with `make e2e`").not.toBe("");

  await test.step("sign in", async () => {
    await page.goto("/");
    await page.getByLabel("Login").fill("bob");
    await page.getByLabel("Password").fill("bob-local");
    await page.getByRole("button", { name: "Sign in" }).click();
  });

  const geometry = page.getByRole("region", { name: "Geometry", exact: true });
  await test.step("upload the assembly and confirm its unit", async () => {
    await geometry.locator('input[type="file"]').setInputFiles({
      name: basename(MODEL),
      mimeType: "application/step",
      buffer: readFileSync(MODEL),
    });
    await expect(geometry.getByText("The file says its length unit is")).toBeVisible({ timeout: 120_000 });
    await expect(geometry.getByLabel("Length unit of the file")).toHaveValue("mm");
    await geometry.getByRole("button", { name: "Confirm unit" }).click();
    await expect(geometry.getByText("70 × 20 × 10 mm")).toBeVisible();
  });

  await test.step("start the setup", async () => {
    await page.getByRole("button", { name: "Start setup" }).click();
    await expect(treeRow(page, "Bodies")).toBeVisible();
    await expect(treeRow(page, "Bonds")).toBeVisible();
  });

  const settings = page.getByRole("complementary", { name: "Settings" });
  const bodies = settings.getByRole("region", { name: "Bodies", exact: true });

  await test.step("the bodies are listed by their part names (M4.1)", async () => {
    await treeRow(page, "Bodies").click();
    await expect(bodies.getByRole("rowheader")).toHaveText(["Base", "Lug"]);
  });

  await test.step("a material for each body", async () => {
    await treeRow(page, "Materials").click();
    const material = page.getByRole("region", { name: "Material", exact: true });

    // The first material is given to every body that has none.
    await page.getByRole("button", { name: "Add an empty material" }).click();
    await material.getByLabel("Name", { exact: true }).fill("Steel");
    await material.getByLabel("Young's modulus", { exact: true }).fill("200");
    await material.getByLabel("Young's modulus unit").selectOption("GPa");
    await material.getByLabel("Poisson's ratio").fill("0.3");
    await expect(material.getByRole("checkbox", { name: "Base" })).toBeChecked();
    await expect(material.getByRole("checkbox", { name: "Lug" })).toBeChecked();
    await saved(page);

    await treeRow(page, "Materials").click();
    await page.getByRole("button", { name: "Add an empty material" }).click();
    await material.getByLabel("Name", { exact: true }).fill("Aluminium");
    await material.getByLabel("Young's modulus", { exact: true }).fill("70");
    await material.getByLabel("Young's modulus unit").selectOption("GPa");
    await material.getByLabel("Poisson's ratio").fill("0.33");
    await saved(page);

    // The Lug is made of the second material, picked in the Bodies group.
    await treeRow(page, "Bodies").click();
    await bodies.getByLabel("Material of Lug").selectOption({ label: "Aluminium" });
    await expect(bodies.getByLabel("Material of Base").locator("option:checked")).toHaveText("Steel");
    await saved(page);
    await page.screenshot({ path: `${OUT}/e03-bodies.png` });
  });

  const bonds = settings.getByRole("region", { name: "Bonds", exact: true });
  const selection = page.getByRole("region", { name: "Selected faces", exact: true });

  await test.step("review the bond the import found (M4.2)", async () => {
    await treeRow(page, "Bonds").click();
    const found = bonds.getByRole("list", { name: "Bonds found" }).getByRole("listitem");
    await expect(found).toHaveCount(1);
    await expect(found).toHaveAccessibleName(/^(Base to Lug|Lug to Base)$/);
    await expect(found).toContainText("200 mm²");
    await expect(found).toContainText("Detected, tied.");
    // Showing the bond selects its two faces, one of each body.
    await found.getByRole("button", { name: /^Show the bond / }).click();
    await expect(selection).toContainText("2 faces selected");
    await expect(found).toHaveAttribute("aria-current", "true");
    await page.screenshot({ path: `${OUT}/e03-bond.png` });
    await found.getByRole("button", { name: /^Accept the bond / }).click();
    await expect(found).toContainText("Accepted, tied.");
    await saved(page);
  });

  const end = await faceWithBox(page, [0.04, 0, 0], [0.04, 0.02, 0.01]);
  const lugTop = await faceWithBox(page, [-0.03, 0, 0.01], [0, 0.02, 0.01]);

  await test.step("fixed support on the end of Base", async () => {
    await selection.getByRole("button", { name: "Clear" }).click();
    // In an assembly the hover line names the body the face belongs to (M4.1).
    expect(await clickFace(page, end)).toMatch(/, Base$/);
    await expect(selection).toContainText(`1 face selected: ${end}`);
    await treeRow(page, "Supports").click();
    await page.getByRole("button", { name: "Add a fixed support" }).click();
    const support = page.getByRole("region", { name: "Fixed support", exact: true });
    await expect(support.getByText(String(end), { exact: true })).toBeVisible();
    await saved(page);
  });

  await test.step("pressure on the top of Lug", async () => {
    await selection.getByRole("button", { name: "Clear" }).click();
    expect(await clickFace(page, lugTop)).toMatch(/, Lug$/);
    await expect(selection).toContainText(`1 face selected: ${lugTop}`);
    await treeRow(page, "Loads").click();
    await page.getByRole("button", { name: "Add a pressure" }).click();
    const pressure = page.getByRole("region", { name: "Pressure", exact: true });
    await expect(pressure.getByText(String(lugTop), { exact: true })).toBeVisible();
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

  const run = settings.getByRole("region", { name: "Run", exact: true });
  const blockers = run.getByRole("region", { name: "Before running", exact: true });

  await test.step("without its bond, Lug is free and the run is refused (M4.4)", async () => {
    await treeRow(page, "Bonds").click();
    const found = bonds.getByRole("list", { name: "Bonds found" }).getByRole("listitem");
    await found.getByRole("button", { name: /^Remove the bond / }).click();
    await expect(found).toContainText("Removed, not tied.");
    await saved(page);
    await treeRow(page, "Run").click();
    await expect(blockers).toContainText(
      'Body "Lug" is not bonded to a held body and no support holds it, so it is free to move. Add a support on one of its faces, or restore a removed bond under Bonds that joins it to a held body.',
    );
    await expect(run.getByRole("button", { name: "Run", exact: true })).toBeDisabled();
    await page.screenshot({ path: `${OUT}/e03-unheld.png` });

    await treeRow(page, "Bonds").click();
    await found.getByRole("button", { name: /^Restore the bond / }).click();
    await expect(found).toContainText("Accepted, tied.");
    await saved(page);
  });

  await test.step("run and see the von Mises contour across both bodies (M4.3)", async () => {
    await treeRow(page, "Run").click();
    await expect(blockers).toHaveCount(0);
    await run.getByRole("button", { name: "Run", exact: true }).click();
    const results = run.getByLabel("Run results");
    await expect(results).toContainText("Largest von Mises stress", { timeout: 180_000 });

    const legend = page.getByRole("region", { name: "Legend", exact: true });
    await expect(legend).toContainText("Von Mises stress (MPa)", { timeout: 60_000 });
    await expect(legend.getByRole("listitem")).toHaveCount(9);
    await page.screenshot({ path: `${OUT}/e03-contour.png` });
  });

  await test.step("the load reaches the support through the bond (M4.3)", async () => {
    const results = run.getByLabel("Run results");
    // 1 MPa on Lug's 30 × 20 mm top is 600 N down; Base's support carries all of it.
    await expect(results).toContainText(/Reaction, [^\n]*\([^)]*, 600\) N/);
    const balance = /Out of balance.*force ([\d.e+-]+) % of [\d.]+ N, moment ([\d.e+-]+) % of [\d.]+ N·mm/;
    await expect(results).toContainText(balance);
    const [, force, moment] = balance.exec((await results.textContent()) ?? "") ?? [];
    expect(Number(force)).toBeLessThan(0.1);
    expect(Number(moment)).toBeLessThan(0.1);
  });

  await test.step("the results carry the note on stresses near bonded faces (M4.5)", async () => {
    const note = run.getByRole("note", { name: "Stresses near bonded faces" });
    await expect(note).toContainText("less accurate than elsewhere in the model");
    await note.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/e03-note.png` });
  });

  await test.step("hide one body in the result view (M3.6)", async () => {
    const viewer = page.getByRole("main", { name: "3D viewer" });
    await viewer.getByRole("button", { name: /^Bodies/ }).click();
    const list = viewer.getByRole("region", { name: "Bodies", exact: true });
    await list.getByRole("checkbox", { name: "Lug" }).uncheck();
    await expect(viewer.getByRole("button", { name: "Bodies (1 of 2)" })).toBeVisible();
    // The last body shown cannot be hidden.
    await expect(list.getByRole("checkbox", { name: "Base" })).toBeDisabled();
    await expect(page.getByRole("region", { name: "Legend", exact: true })).toContainText("Von Mises stress (MPa)");
    await page.screenshot({ path: `${OUT}/e03-base-only.png` });
    await list.getByRole("button", { name: "Show all" }).click();
    await expect(viewer.getByRole("button", { name: "Bodies", exact: true })).toBeVisible();
  });

  await test.step("heat crosses the bond in a thermal stress analysis (M5.6)", async () => {
    await treeRow(page, "Analysis").click();
    const analysis = settings.getByRole("region", { name: "Analysis", exact: true });
    await analysis.getByRole("radio", { name: "Thermal stress" }).check();
    await analysis.getByLabel("Stress-free temperature", { exact: true }).fill("20");
    await saved(page);

    const material = page.getByRole("region", { name: "Material", exact: true });
    for (const [name, alpha, k] of [
      ["Steel", "12", "45"],
      ["Aluminium", "23", "160"],
    ] as const) {
      await treeRow(page, name).click();
      await material.getByLabel("Thermal expansion", { exact: true }).fill(alpha);
      await material.getByLabel("Thermal expansion unit").selectOption("µm/(m·K)");
      await material.getByLabel("Thermal conductivity", { exact: true }).fill(k);
      await material.getByLabel("Thermal conductivity unit").selectOption("W/(m·K)");
      await saved(page);
    }

    // Lug is heated on its top, Base cooled at its end: neither body's temperature needs the
    // bond to be set, but every watt the top takes in reaches the end only through it.
    await selection.getByRole("button", { name: "Clear" }).click();
    await clickFace(page, lugTop);
    await treeRow(page, "Loads").click();
    await page.getByRole("button", { name: "Add a fixed temperature" }).click();
    const fixed = page.getByRole("region", { name: "Fixed temperature", exact: true });
    await fixed.getByLabel("Name", { exact: true }).fill("Hot top");
    await fixed.getByLabel("Temperature", { exact: true }).fill("120");
    await saved(page);
    await selection.getByRole("button", { name: "Clear" }).click();
    await clickFace(page, end);
    await treeRow(page, "Loads").click();
    await page.getByRole("button", { name: "Add convection" }).click();
    const convection = page.getByRole("region", { name: "Convection", exact: true });
    await convection.getByLabel("Name", { exact: true }).fill("Cooled end");
    await convection.getByLabel("Convection coefficient", { exact: true }).fill("1000");
    await convection.getByLabel("Convection coefficient unit").selectOption("W/(m²·K)");
    await convection.getByLabel("Ambient temperature", { exact: true }).fill("20");
    await saved(page);

    await treeRow(page, "Run").click();
    await expect(blockers).toHaveCount(0);
    await run.getByRole("button", { name: "Run", exact: true }).click();
    const thermal = run.getByLabel("Thermal results");
    await expect(thermal).toContainText(/Highest temperature\s*120 °C/, { timeout: 180_000 });
    const flows = /Heat flow, Hot top\s*([\d.]+) W in.*Heat flow, Cooled end\s*([\d.]+) W out/;
    await expect(thermal).toContainText(flows);
    const [, into, out] = flows.exec((await thermal.textContent()) ?? "") ?? [];
    expect(Number(into)).toBeGreaterThan(0);
    expect(Math.abs(Number(out) - Number(into)) / Number(into)).toBeLessThan(0.001);
    const balance = /Out of balance\s*([\d.e+-]+) %/;
    await expect(thermal).toContainText(balance);
    expect(Number(balance.exec((await thermal.textContent()) ?? "")?.[1])).toBeLessThan(0.1);
    await thermal.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/e03-heat-flows.png` });

    await settings.getByLabel("Quantity").selectOption("temperature");
    const legend = page.getByRole("region", { name: "Legend", exact: true });
    await expect(legend).toContainText("Temperature (°C)");
    await page.screenshot({ path: `${OUT}/e03-temperature.png` });
  });
});
