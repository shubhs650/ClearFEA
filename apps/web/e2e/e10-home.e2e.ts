// SPDX-License-Identifier: AGPL-3.0-or-later
// E-10 (docs/VERIFICATION.md): the projects home and its trash (M14.4, ADR-114, ADR-124, ADR-126).
// Bob makes a folder and a project in it, imports E-01's block so the project gets its thumbnail,
// and finds the project under Recent and in the folder. He renames it, duplicates it, moves the
// copy to the top, searches, and reads both in the list. He puts the folder in the trash, which
// takes the project along: the project's address no longer opens it, and the trash shows the
// folder with the day it is removed for good. He restores the folder and opens the project again.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { newProject } from "./home";

const MODEL = process.env.CLEARFEA_E2E_MODEL ?? "";
const OUT = process.env.CLEARFEA_E2E_OUT ?? "e2e-results";

const FOLDER = "E-10 brackets";
const PROJECT = "E-10 bracket";
const RENAMED = "E-10 bracket rev B";
const COPY = `${RENAMED} (copy)`;

async function signIn(page: Page, login: string, password: string): Promise<void> {
  await page.goto("/app");
  await page.getByLabel("Login").fill(login);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** The card of a folder or project in the home's grid, by its exact name. */
function card(page: Page, name: string): Locator {
  return page
    .getByRole("main")
    .locator(".home-card")
    .filter({ has: page.locator(".home-card-name").getByText(name, { exact: true }) });
}

function details(page: Page): Locator {
  return page.getByRole("complementary", { name: "Details" });
}

function sections(page: Page): Locator {
  return page.getByRole("navigation", { name: "Home sections" });
}

/** A folder in the side bar's tree. */
function folderInTree(page: Page, name: string): Locator {
  return sections(page).getByRole("list", { name: "Folders" }).getByRole("button", { name, exact: true });
}

/** A detail of the chosen item, such as its location, read from the info panel's list. */
function fact(page: Page, term: string): Locator {
  return details(page).locator(`dt:text-is("${term}") + dd`);
}

test("E-10: the projects home, folders and the trash", async ({ page }) => {
  expect(MODEL, "CLEARFEA_E2E_MODEL names the STEP file; run the test with `make e2e`").not.toBe("");
  const main = page.getByRole("main");

  await test.step("sign in as bob and make a folder", async () => {
    await signIn(page, "bob", "bob-local");
    await expect(page).toHaveURL(/\/app$/);
    await sections(page).getByRole("button", { name: "My projects", exact: true }).click();
    await main.getByRole("button", { name: "New folder" }).click();
    await main.getByLabel("Folder name").fill(FOLDER);
    await main.getByRole("button", { name: "Create", exact: true }).click();
    await expect(folderInTree(page, FOLDER)).toBeVisible();
    await expect(card(page, FOLDER)).toHaveAttribute("aria-pressed", "true");
    await expect(fact(page, "Holds")).toHaveText("0 projects");
  });

  let projectId = "";
  await test.step("start a project in the folder and import the block", async () => {
    await folderInTree(page, FOLDER).click();
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(FOLDER);
    await expect(main.getByText("This folder is empty.")).toBeVisible();
    await main.getByRole("button", { name: "New project" }).click();
    await expect(main.getByText(`In ${FOLDER}`)).toBeVisible();
    await main.getByRole("button", { name: "Cancel" }).click();
    await newProject(page, PROJECT);
    projectId = decodeURIComponent(new URL(page.url()).pathname.split("/").pop() ?? "");

    // The workbench draws the thumbnail once the geometry is ready and stores it on the project.
    const thumbnail = page.waitForResponse(
      (r) => r.request().method() === "PUT" && new URL(r.url()).pathname === `/api/projects/${projectId}/thumbnail`,
      { timeout: 120_000 },
    );
    const geometry = page.getByRole("region", { name: "Geometry", exact: true });
    await geometry.locator('input[type="file"]').setInputFiles({
      name: basename(MODEL),
      mimeType: "application/step",
      buffer: readFileSync(MODEL),
    });
    await expect(geometry.getByText("The file says its length unit is")).toBeVisible({ timeout: 120_000 });
    await geometry.getByRole("button", { name: "Confirm unit" }).click();
    await expect(geometry.getByText("40 × 20 × 10 mm")).toBeVisible();
    expect((await thumbnail).ok(), "the thumbnail is stored").toBe(true);
  });

  await test.step("find the project under Recent with its thumbnail, and in the folder", async () => {
    await page.getByRole("banner").getByRole("button", { name: "Projects", exact: true }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(main.getByRole("heading", { level: 1 })).toHaveText("Recent");
    const recent = main.locator(".home-card").first();
    await expect(recent.locator(".home-card-name")).toHaveText(PROJECT);
    await expect(recent).toContainText("Opened");
    const picture = recent.locator("img.home-card-picture");
    await expect(picture).toBeVisible();
    await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
    await page.screenshot({ path: `${OUT}/e10-recent.png` });

    await sections(page).getByRole("button", { name: "My projects", exact: true }).click();
    await expect(card(page, FOLDER)).toContainText("1 project");
    await card(page, FOLDER).dblclick();
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(FOLDER);
    await card(page, PROJECT).click();
    await expect(details(page).getByRole("heading", { name: "Project" })).toBeVisible();
    await expect(fact(page, "Location")).toHaveText(FOLDER);
    await expect(details(page).locator("img.home-card-picture")).toBeVisible();
  });

  await test.step("rename the project, duplicate it and move the copy to the top", async () => {
    await details(page).getByRole("button", { name: "Rename" }).click();
    await details(page).getByLabel("Name").fill(RENAMED);
    await details(page).getByRole("button", { name: "Save name" }).click();
    await expect(card(page, RENAMED)).toBeVisible();
    await expect(card(page, PROJECT)).toHaveCount(0);

    await details(page).getByRole("button", { name: "Duplicate" }).click();
    await expect(card(page, COPY)).toHaveAttribute("aria-pressed", "true");
    // The copy holds the geometry, so it carries the thumbnail along.
    await expect(card(page, COPY).locator("img.home-card-picture")).toBeVisible();
    await details(page).getByLabel("Move to").selectOption({ label: "My projects (top)" });
    await details(page).getByRole("button", { name: "Move", exact: true }).click();
    await expect(card(page, COPY)).toHaveCount(0);
    await expect(card(page, RENAMED)).toBeVisible();
  });

  await test.step("search, and read both projects in the list", async () => {
    await sections(page).getByRole("button", { name: "My projects", exact: true }).click();
    await expect(card(page, COPY)).toBeVisible();
    await main.getByLabel("Search projects and folders").fill("rev b");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText("Search");
    await expect(main.locator(".home-card")).toHaveCount(2);
    await main.getByRole("button", { name: "List", exact: true }).click();
    const list = main.getByRole("table", { name: "Search, as a list" });
    await expect(list.getByRole("row", { name: new RegExp(`^${RENAMED} ${FOLDER}`) })).toBeVisible();
    await expect(list.getByRole("row", { name: new RegExp(`^${COPY.replace(/[()]/g, "\\$&")} My projects`) })).toBeVisible();
    await page.screenshot({ path: `${OUT}/e10-search-list.png` });
    await main.getByLabel("Search projects and folders").fill("no such bracket");
    await expect(main.getByText("No project or folder has that name.")).toBeVisible();
    await main.getByLabel("Search projects and folders").fill("");
    await main.getByRole("button", { name: "Grid", exact: true }).click();
  });

  await test.step("put the folder in the trash, which takes the project along", async () => {
    await card(page, FOLDER).click();
    await details(page).getByRole("button", { name: "Move to trash" }).click();
    await expect(card(page, FOLDER)).toHaveCount(0);
    await expect(folderInTree(page, FOLDER)).toHaveCount(0);
    // A search finds the copy at the top, but not the project that went to the trash with its folder.
    await main.getByLabel("Search projects and folders").fill(RENAMED);
    await expect(card(page, COPY)).toBeVisible();
    await expect(card(page, RENAMED)).toHaveCount(0);

    await sections(page).getByRole("button", { name: "Trash" }).click();
    await expect(main.getByRole("heading", { level: 1 })).toHaveText("Trash");
    await expect(main.getByText("Items in the trash are removed for good 30 days after")).toBeVisible();
    // The trash lists what was put there, not what went along with it.
    await expect(card(page, FOLDER)).toBeVisible();
    await expect(card(page, RENAMED)).toHaveCount(0);
    await card(page, FOLDER).click();
    await expect(fact(page, "Holds")).toHaveText("1 project");

    // The day it is removed for good is the trash time plus the retention, in the browser's own words.
    const listing = await page.request.get("/api/projects");
    expect(listing.ok()).toBe(true);
    const { folders } = (await listing.json()) as { folders: { name: string; deletedAt: string | null }[] };
    const trashedAt = folders.find((f) => f.name === FOLDER)?.deletedAt;
    expect(trashedAt, "the folder has a trash time").toBeTruthy();
    const purgeDay = await page.evaluate(
      (at) => new Date(new Date(at).getTime() + 30 * 86_400_000).toLocaleDateString(undefined, { dateStyle: "medium" }),
      trashedAt as string,
    );
    await expect(fact(page, "Removed for good")).toHaveText(purgeDay);
    await expect(card(page, FOLDER)).toContainText(`Removed for good on ${purgeDay}`);
    await expect(details(page).getByRole("button", { name: "Open folder" })).toHaveCount(0);
    await page.screenshot({ path: `${OUT}/e10-trash.png` });
  });

  await test.step("the project in the trash cannot be opened by its address", async () => {
    await page.goto(`/app/p/${encodeURIComponent(projectId)}`);
    const unavailable = page.getByRole("main", { name: "Project not available" });
    await expect(unavailable.getByRole("heading", { name: "This project cannot be opened" })).toBeVisible();
    await expect(unavailable.getByRole("alert")).toHaveText(
      `The project ${RENAMED} is in the trash. Restore it from the trash on your home page to work in it.`,
    );
    await unavailable.getByRole("button", { name: "Go to your projects" }).click();
    await expect(page).toHaveURL(/\/app$/);
  });

  await test.step("restore the folder and open the project again", async () => {
    await sections(page).getByRole("button", { name: "Trash" }).click();
    await card(page, FOLDER).click();
    await details(page).getByRole("button", { name: "Restore" }).click();
    await expect(card(page, FOLDER)).toHaveCount(0);
    await expect(folderInTree(page, FOLDER)).toBeVisible();

    await folderInTree(page, FOLDER).click();
    await card(page, RENAMED).dblclick();
    await expect(page).toHaveURL(new RegExp(`/app/p/${projectId}$`));
    await expect(page.getByRole("banner").getByText(RENAMED)).toBeVisible();
    await expect(page.getByRole("region", { name: "Geometry", exact: true }).getByText("40 × 20 × 10 mm")).toBeVisible();
  });
});
