// SPDX-License-Identifier: AGPL-3.0-or-later
// E-05 (docs/VERIFICATION.md): a report made and downloaded through the UI (M7.3, M7.4). A block is
// set up and solved as in E-01, a result view is saved, the title block is filled in, and "Make the
// report" draws the figures, has the worker make the report and offers its Word file and PDF for
// download. The DOCX is opened as the zip of WordprocessingML it is and checked for its cover, its
// sections in order, its tables and figures, and the absence of any verdict; the PDF, printed from
// it by the worker's LibreOffice, is checked for its pages, its title and the same sections in its
// bookmarks. The test signs in as the second seeded user, so other tests' geometries are not in its
// lists.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
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

/** The text of a DOCX's body, one line per paragraph, read with unzip as Word's own XML. */
function docxText(path: string): string {
  const xml = execFileSync("unzip", ["-p", path, "word/document.xml"], { encoding: "utf-8" });
  return xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** A PDF's bookmark and document titles, which LibreOffice writes as UTF-16 in hex strings. */
function pdfTitles(pdf: Buffer): string[] {
  const titles = pdf.toString("latin1").match(/\/Title<FEFF[0-9A-F]*>/g) ?? [];
  return titles.map((t) => Buffer.from(t.slice(11, -1), "hex").swap16().toString("utf16le"));
}

test("E-05: make the report of a solved run and download its Word file and PDF", async ({ page }) => {
  expect(MODEL, "CLEARFEA_E2E_MODEL names the STEP file; run the test with `make e2e`").not.toBe("");

  await test.step("sign in", async () => {
    await page.goto("/app");
    await page.getByLabel("Login").fill("bob");
    await page.getByLabel("Password").fill("bob-local");
    await page.getByRole("button", { name: "Sign in" }).click();
    await newProject(page, "E-05 report block");
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

  await test.step("run and save a view of the stress", async () => {
    await treeRow(page, "Run").click();
    const run = settings.getByRole("region", { name: "Run", exact: true });
    await expect(run.getByRole("button", { name: "Run", exact: true })).toBeEnabled({ timeout: 10_000 });
    await run.getByRole("button", { name: "Run", exact: true }).click();
    await expect(run.getByLabel("Run results")).toContainText("Largest von Mises stress", { timeout: 180_000 });
    const legend = page.getByRole("region", { name: "Legend", exact: true });
    await expect(legend).toContainText("Von Mises stress (MPa)", { timeout: 60_000 });
    await page.getByRole("button", { name: "Views", exact: true }).click();
    const views = page.getByRole("region", { name: "Saved views", exact: true });
    await views.getByLabel("View name").fill("Overall");
    await views.getByRole("button", { name: "Save view" }).click();
    await expect(views).toContainText('Saved the view "Overall".');
  });

  const report = settings.getByRole("region", { name: "Report", exact: true });
  await test.step("fill in the title block and pick the view", async () => {
    await treeRow(page, "Report").click();
    await report.getByLabel("Report title", { exact: true }).fill("Block under pressure");
    await report.getByLabel("Document number", { exact: true }).fill("CF-E05-001");
    await report.getByLabel("Revision", { exact: true }).fill("B");
    await report.getByLabel("Prepared by", { exact: true }).fill("Bob");
    await report.getByRole("checkbox", { name: "Overall" }).check();
    await report.getByRole("button", { name: "Save report options" }).click();
    await expect(report.getByText("Report options saved.")).toBeVisible();
  });

  const headings = [
    "1  About this report",
    "2  Project and revision",
    "3  Geometry and units",
    "4  Materials",
    "5  Mesh statistics",
    "6  Loads and supports",
    "7  Solver settings and versions",
    "8  Result plots",
    "9  Reaction and balance check",
    "10  Minimum and maximum tables",
    "11  Run warnings",
    "12  Software and verification",
  ];
  const word = report.getByRole("group", { name: "Word and PDF report" });

  await test.step("make the report and download the Word file", async () => {
    await word.getByRole("button", { name: "Make the report" }).click();
    // The figures are drawn first: the support, the pressure and the view.
    await expect(report.getByRole("group", { name: "Figures" }).getByText("Drew 3 figures.")).toBeVisible({
      timeout: 60_000,
    });
    const link = word.getByRole("link", { name: "Download the Word report" });
    await expect(link).toBeVisible({ timeout: 120_000 });
    await word.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/e05-report-panel.png` });
    const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
    expect(download.suggestedFilename()).toBe("CF-E05-001 Block under pressure rev B.docx");
    const path = `${OUT}/e05-report.docx`;
    await download.saveAs(path);

    const text = docxText(path);
    const lines = text.split("\n");
    expect(lines).toContain("Block under pressure");
    expect(lines).toContain("Finite element analysis report");
    expect(lines.filter((line) => /^\d+ {2}\S/.test(line))).toEqual(headings);
    expect(text).toContain("Figure 1. Fixed support 1");
    expect(text).toContain("Figure 2. Pressure 1");
    expect(text).toContain('Figure 3. Von Mises stress, view "Overall"');
    expect(text).toContain("CF-E05-001");
    expect(lines).toContain("1 MPa");
    expect(text).not.toMatch(/\b(PASS|FAIL)\b|compliant/i);
    const media = execFileSync("unzip", ["-l", path], { encoding: "utf-8" });
    expect(media.match(/word\/media\/\S+\.png/g) ?? []).toHaveLength(3);
  });

  await test.step("download the PDF printed from it", async () => {
    const link = word.getByRole("link", { name: "Download the PDF report" });
    await expect(link).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
    expect(download.suggestedFilename()).toBe("CF-E05-001 Block under pressure rev B.pdf");
    const path = `${OUT}/e05-report.pdf`;
    await download.saveAs(path);
    const pdf = readFileSync(path);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const pages = pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pages.length).toBeGreaterThanOrEqual(5);
    const titles = pdfTitles(pdf);
    expect(titles).toContain("Block under pressure");
    // The bookmarks follow the Word headings, with their two spaces written as one.
    const sections = titles.filter((t) => /^\d+ \S/.test(t));
    expect(sections).toEqual(headings.map((h) => h.replace("  ", " ")));
  });
});
