// SPDX-License-Identifier: AGPL-3.0-or-later
// The way into a workbench since the projects home (M14.3): /app opens the home after sign-in,
// and each test starts its own project there, so tests that share a user do not share a project.
import { expect, type Page } from "@playwright/test";

/** Starts a new project from the projects home and waits until its workbench has loaded it. */
export async function newProject(page: Page, name: string): Promise<void> {
  const home = page.getByRole("main");
  await home.getByRole("button", { name: "New project" }).click();
  await home.getByLabel("Project name").fill(name);
  // The project's unit system loads with it; a choice made before that would be drawn over.
  const loaded = page.waitForResponse(
    (r) => r.request().method() === "GET" && /^\/api\/projects\/[^/]+$/.test(new URL(r.url()).pathname) && r.ok(),
  );
  await home.getByRole("button", { name: "Create and open" }).click();
  await loaded;
  await expect(page).toHaveURL(/\/app\/p\/[^/]+$/);
  await expect(page.getByRole("banner").getByText(name)).toBeVisible();
}
