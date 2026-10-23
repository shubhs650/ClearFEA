// SPDX-License-Identifier: AGPL-3.0-or-later
// E-08 (docs/VERIFICATION.md): sign-in and the admin page of the live closed beta (M10.3,
// ADR-097). The stack signs in locally; the live site's sign-in screen is shown by answering
// /api/session/options as the live site does, and its refusal by the address Google's callback
// returns to. Alice, the admin here, invites an address on Users, sees it listed and removes it,
// and on Settings (M13.3) switches the large machine size on and off (M10.6) and sets the monthly
// hours limit; on the dashboard (M13.2) she pauses the queue, sees a job wait in the light lane,
// cancels it from Jobs and runs, resumes the queue and reads both and the setting she changed in
// the event log, then reads the month on Costs (M13.3) and downloads the jobs as CSV and every
// table as one Excel workbook on Export (M13.4), then raises the disk alert of a solver host that
// checks in from its setting on Settings and clears it again (M13.5); bob sees no Admin and the admin routes
// answer him as unknown addresses. Real Google sign-in is checked on the live site, with the
// maintainer's OAuth client.
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

const OUT = process.env.CLEARFEA_E2E_OUT ?? "e2e-results";

async function signIn(page: Page, login: string, password: string): Promise<void> {
  await page.goto("/app");
  await page.getByLabel("Login").fill(login);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("E-08: the live sign-in screen, a refused address, and the admin page", async ({ page, browser }) => {
  await test.step("the live site offers only Sign in with Google", async () => {
    await page.route("/api/session/options", (route) => route.fulfill({ json: { signIn: "google" } }));
    await page.goto("/app");
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
    await expect(page.getByLabel("Password")).toHaveCount(0);
    await expect(page.getByText("ClearFEA is in a closed beta.")).toBeVisible();
    await page.screenshot({ path: `${OUT}/e08-google-sign-in.png` });
  });

  await test.step("an address that is not invited is told so, and the code leaves the address bar", async () => {
    await page.goto("/app?error=NOT_INVITED&error_description=x");
    await expect(page.getByRole("alert")).toContainText("not invited to the ClearFEA closed beta");
    await expect(page).toHaveURL(/\/app$/);
    await page.screenshot({ path: `${OUT}/e08-not-invited.png` });
    await page.unroute("/api/session/options");
  });

  await test.step("alice, the admin, invites an address and removes it", async () => {
    await signIn(page, "alice", "alice-local");
    const status = page.getByRole("contentinfo", { name: "Status" });
    await status.getByRole("button", { name: "Admin" }).click();
    const admin = page.getByRole("region", { name: "Admin" });
    await expect(admin.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    await admin.getByRole("tab", { name: "Users" }).click();
    await expect(admin.getByText("alice@clearfea.test")).toHaveCount(2);
    await admin.getByLabel("Email address").fill("  Colleague.One@Example.com ");
    await admin.getByRole("button", { name: "Add" }).click();
    await expect(admin.getByText("colleague.one@example.com")).toBeVisible();
    await admin.getByLabel("Email address").fill("colleague.two@example.com");
    await admin.getByRole("button", { name: "Add" }).click();
    await expect(admin.getByText("colleague.two@example.com")).toBeVisible();
    await expect(admin.getByRole("table", { name: "Users" }).getByText("Bob (test user)")).toBeVisible();
    await expect(admin.getByText("Machine time, jobs and failed jobs count this calendar month (UTC).", { exact: false })).toBeVisible();
    await page.screenshot({ path: `${OUT}/e08-admin.png` });

    // Settings (M13.3): every setting in its group; the machine sizes and solver machines below them.
    await admin.getByRole("tab", { name: "Settings" }).click();
    await expect(admin.getByRole("region", { name: "Storage" }).getByLabel("Free storage per user", { exact: true })).toHaveValue("5");
    await page.screenshot({ path: `${OUT}/e08-dashboard-settings.png` });

    // The cloud size list (M10.6): standard (medium) always on, large switched on and off again.
    const sizes = admin.getByRole("region", { name: "Machine sizes" });
    await expect(sizes.getByRole("checkbox", { name: "medium" })).toBeChecked();
    await expect(sizes.getByRole("checkbox", { name: "medium" })).toBeDisabled();
    await expect(sizes.getByText("Default, always on")).toBeVisible();
    const large = sizes.getByRole("checkbox", { name: "large" });
    await expect(large).not.toBeChecked();
    await large.click(); // the box follows the API's answer, so not check(), which wants it at once
    await expect(large).toBeChecked();
    await sizes.screenshot({ path: `${OUT}/e08-machine-sizes.png` });
    await large.click();
    await expect(large).not.toBeChecked();

    // Solver machines (M10.7): locally nothing is started; the monthly limit is set and restored.
    const machines = admin.getByRole("region", { name: "Solver machines" });
    await expect(machines.getByText("Jobs here run on the local worker")).toBeVisible();
    await expect(machines.getByText("No machine started yet.")).toBeVisible();
    const cloud = admin.getByRole("region", { name: "Cloud machines" });
    const limit = cloud.getByLabel("Monthly limit of machine hours", { exact: true });
    await expect(limit).toHaveValue("60");
    await limit.fill("1000");
    await cloud.getByRole("button", { name: "Save Monthly limit of machine hours" }).click();
    await expect(cloud.getByRole("alert")).toContainText("from 0 h to 744 h. Nothing was changed.");
    await limit.fill("45");
    await cloud.getByRole("button", { name: "Save Monthly limit of machine hours" }).click();
    await expect(machines.getByText("of 45 h used this month")).toBeVisible();
    await expect(cloud.getByRole("alert")).toHaveCount(0);
    await machines.screenshot({ path: `${OUT}/e08-solver-machines.png` });
    await limit.fill("60");
    await cloud.getByRole("button", { name: "Save Monthly limit of machine hours" }).click();
    await expect(machines.getByText("of 60 h used this month")).toBeVisible();

    await admin.getByRole("tab", { name: "Users" }).click();
    await admin.getByRole("button", { name: "Remove colleague.one@example.com" }).click();
    await expect(admin.getByText("colleague.one@example.com")).toHaveCount(0);
    await admin.getByRole("button", { name: "Remove colleague.two@example.com" }).click();
    await expect(admin.getByText("Nobody else is invited yet.")).toBeVisible();
  });

  await test.step("the dashboard: a paused queue, a waiting job cancelled, and the event log (M13.2)", async () => {
    const admin = page.getByRole("region", { name: "Admin" });
    await admin.getByRole("tab", { name: "Overview" }).click();
    const queue = admin.getByRole("region", { name: "Queue" });
    await expect(queue.getByTestId("queue-state")).toContainText("Running");
    await queue.getByRole("button", { name: "Pause the queue" }).click();
    await expect(queue.getByTestId("queue-state")).toContainText("Paused");
    await expect(admin.getByRole("alert").filter({ hasText: "The queue is paused" })).toBeVisible();

    // While paused a new job queues and waits; the Overview checks again by itself.
    const created = await page.request.post("/api/jobs", { data: { type: "noop" } });
    expect(created.status()).toBe(201);
    const jobId = ((await created.json()) as { job: { id: string } }).job.id;
    const light = admin.getByRole("region", { name: "Light lane" });
    const row = light.getByRole("row").filter({ hasText: jobId.slice(0, 8) });
    await expect(row).toContainText("Queued");
    await expect(row).toContainText("in the queue");
    await page.screenshot({ path: `${OUT}/e08-dashboard-overview.png` });

    await admin.getByRole("tab", { name: "Jobs and runs" }).click();
    await admin.getByRole("button", { name: `Details of job ${jobId}` }).click();
    const details = admin.getByRole("region", { name: "Job details" });
    await expect(details.getByTestId("job-status")).toContainText("Queued");
    await expect(details.getByText("No worker has taken it yet.")).toBeVisible();
    await details.getByRole("button", { name: "Cancel job" }).click();
    await details.getByRole("button", { name: "Yes, cancel it" }).click();
    await expect(details.getByTestId("job-status")).toHaveText("Failed");
    await expect(details.getByText("stopped by the ClearFEA administrator")).toBeVisible();
    await page.screenshot({ path: `${OUT}/e08-dashboard-jobs.png` });

    await admin.getByRole("tab", { name: "Overview" }).click();
    await queue.getByRole("button", { name: "Resume the queue" }).click();
    await expect(queue.getByTestId("queue-state")).toContainText("Running");
    await expect(admin.getByRole("alert").filter({ hasText: "The queue is paused" })).toHaveCount(0);

    await admin.getByRole("tab", { name: "Events" }).click();
    const events = admin.getByRole("table", { name: "Events" });
    await expect(events.getByText("Resumed the queue.")).toBeVisible();
    await expect(events.getByText("Cancelled a no-op job (queued, try 1); nothing is charged.")).toBeVisible();
    await expect(events.getByText("Paused the queue: no job starts until it is resumed.")).toBeVisible();
    await admin.getByLabel("Kind").selectOption("admin_action");
    await expect(events.getByText("Invited colleague.one@example.com.")).toBeVisible();
    await expect(events.getByText('Changed "Monthly limit of machine hours" from 60 h to 45 h.')).toBeVisible();
    await page.screenshot({ path: `${OUT}/e08-dashboard-events.png` });

    // Costs (M13.3): this month's use beside the solver host's and Cloudflare's monthly costs; alice's
    // cancelled job counts in it.
    await admin.getByRole("tab", { name: "Costs" }).click();
    await expect(admin.getByTestId("costs-fixed")).toHaveText("$22.00 a month");
    await expect(admin.getByRole("table", { name: "Costs by user" }).getByText("alice@clearfea.test")).toBeVisible();
    await expect(admin.getByRole("table", { name: "Costs by job type" }).getByText("No-op")).toBeVisible();
    await page.screenshot({ path: `${OUT}/e08-dashboard-costs.png` });

    // Export (M13.4): the jobs of this month so far as CSV hold the cancelled job, and every table
    // comes as one Excel workbook.
    await admin.getByRole("tab", { name: "Export" }).click();
    const today = new Date().toISOString().slice(0, 10);
    await expect(admin.getByLabel("To (UTC)")).toHaveValue(today);
    const [csv] = await Promise.all([
      page.waitForEvent("download"),
      admin.getByRole("button", { name: "CSV of Jobs" }).click(),
    ]);
    expect(csv.suggestedFilename()).toBe(`clearfea-jobs-${today.slice(0, 7)}-01-to-${today}.csv`);
    await csv.saveAs(`${OUT}/e08-${csv.suggestedFilename()}`);
    const jobsCsv = await readFile(`${OUT}/e08-${csv.suggestedFilename()}`, "utf8");
    const cancelled = jobsCsv.split("\r\n").find((line) => line.startsWith(`${jobId},`));
    expect(cancelled).toContain(",noop,light,failed,");
    expect(cancelled).toContain("cancelled_by_admin");
    await expect(admin.getByRole("status")).toContainText(`Saved ${csv.suggestedFilename()}.`);
    const [workbook] = await Promise.all([
      page.waitForEvent("download"),
      admin.getByRole("button", { name: "Every table in one Excel workbook" }).click(),
    ]);
    expect(workbook.suggestedFilename()).toBe(`clearfea-all-${today.slice(0, 7)}-01-to-${today}.xlsx`);
    await workbook.saveAs(`${OUT}/e08-${workbook.suggestedFilename()}`);
    const xlsx = await readFile(`${OUT}/e08-${workbook.suggestedFilename()}`);
    expect(xlsx.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(xlsx.includes("xl/worksheets/sheet9.xml")).toBe(true);
    // A range that ends before it starts is refused with what to do.
    await admin.getByLabel("From (UTC)").fill("2026-12-31");
    await admin.getByLabel("To (UTC)").fill("2026-01-01");
    await admin.getByRole("button", { name: "Excel of Events" }).click();
    await expect(admin.getByRole("alert")).toHaveText("The range ends before it starts. Choose a later end day.");
    await admin.getByLabel("From (UTC)").fill(`${today.slice(0, 7)}-01`);
    await admin.getByLabel("To (UTC)").fill(today);
    await expect(admin.getByRole("alert")).toHaveCount(0);
    await page.screenshot({ path: `${OUT}/e08-dashboard-export.png` });
  });

  await test.step("an alert on the Overview, raised and cleared from its setting (M13.5)", async () => {
    // A solver host checks in with its disk, as the compute manager does every 30 s, with the
    // worker token infra/stack.sh gives the worker; the API is the one infra/e2e.sh starts.
    const devVars = readFileSync(new URL("../../api/.dev.vars", import.meta.url), "utf8");
    const token = devVars.match(/^WORKER_TOKEN=(.*)$/m)?.[1] ?? "";
    const checkIn = await page.request.post(`http://127.0.0.1:${process.env.E2E_API_PORT ?? "8789"}/internal/hosts/check-in`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        host: "e2e-vps",
        load: {
          load1: 0.5,
          load5: 0.5,
          load15: 0.5,
          memoryTotalBytes: 24 * 2 ** 30,
          memoryAvailableBytes: 20 * 2 ** 30,
          diskTotalBytes: 300 * 2 ** 30,
          diskFreeBytes: 250 * 2 ** 30,
          containers: 0,
        },
      },
    });
    expect(checkIn.status()).toBe(200);

    const admin = page.getByRole("region", { name: "Admin" });
    await admin.getByRole("tab", { name: "Settings" }).click();
    const alerts = admin.getByRole("region", { name: "Alerts" });
    const disk = alerts.getByLabel("Disk low below", { exact: true });
    await expect(disk).toHaveValue("30");
    await expect(alerts.getByLabel("Platform failures that alert", { exact: true })).toHaveValue("3");
    await disk.fill("10240");
    await alerts.getByRole("button", { name: "Save Disk low below" }).click();
    await expect(alerts.getByRole("alert")).toHaveCount(0);
    await expect(disk).toHaveValue("10240");

    await admin.getByRole("tab", { name: "Overview" }).click();
    const low = admin.getByRole("alert").filter({ hasText: "on its scratch disk, below the 10240.0 GiB alert" });
    await expect(low).toBeVisible();
    await page.screenshot({ path: `${OUT}/e08-dashboard-alerts.png` });

    await admin.getByRole("tab", { name: "Settings" }).click();
    await disk.fill("30");
    await alerts.getByRole("button", { name: "Save Disk low below" }).click();
    await expect(disk).toHaveValue("30");
    await admin.getByRole("tab", { name: "Overview" }).click();
    await expect(admin.getByRole("alert").filter({ hasText: "on its scratch disk" })).toHaveCount(0);

    await admin.getByRole("button", { name: "Close" }).click();
    await expect(admin).toHaveCount(0);
  });

  await test.step("bob sees no Admin, and the admin routes do not exist for him", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const bob = await context.newPage();
    await signIn(bob, "bob", "bob-local");
    const status = bob.getByRole("contentinfo", { name: "Status" });
    await expect(status.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(status.getByRole("button", { name: "Admin" })).toHaveCount(0);
    expect((await bob.request.get("/api/admin")).status()).toBe(404);
    const add = await bob.request.post("/api/admin/allowed", { data: { email: "bob.friend@example.com" } });
    expect(add.status()).toBe(404);
    const size = await bob.request.put("/api/admin/machine-sizes/large", { data: { enabled: true } });
    expect(size.status()).toBe(404);
    const cap = await bob.request.put("/api/admin/machine-hours-cap", { data: { hours: 0 } });
    expect(cap.status()).toBe(404);
    expect((await bob.request.get("/api/admin/overview")).status()).toBe(404);
    expect((await bob.request.put("/api/admin/queue-paused", { data: { paused: true } })).status()).toBe(404);
    expect((await bob.request.get("/api/admin/jobs")).status()).toBe(404);
    expect((await bob.request.get("/api/admin/settings")).status()).toBe(404);
    expect((await bob.request.put("/api/admin/settings/machine_hours_cap", { data: { value: 0 } })).status()).toBe(404);
    expect((await bob.request.get("/api/admin/costs")).status()).toBe(404);
    expect((await bob.request.get("/api/admin/export/jobs.csv")).status()).toBe(404);
    expect((await bob.request.get("/api/admin/export/all.xlsx")).status()).toBe(404);
    await context.close();
  });
});
