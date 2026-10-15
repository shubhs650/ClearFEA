// SPDX-License-Identifier: AGPL-3.0-or-later
// Browser end-to-end tests (docs/VERIFICATION.md). Run them with `make e2e`, which starts a fresh
// API, worker and dev server and sets CLEARFEA_E2E_URL, CLEARFEA_E2E_MODEL and CLEARFEA_E2E_OUT.
import { defineConfig } from "@playwright/test";

const out = process.env.CLEARFEA_E2E_OUT ?? "e2e-results";

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  outputDir: `${out}/artifacts`,
  // One stack, one user: the tests share its data, so they run one at a time.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  // Meshing and solving a tiny model takes seconds; the first job may wait for the worker to poll.
  timeout: 5 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: `${out}/report`, open: "never" }]],
  use: {
    baseURL: process.env.CLEARFEA_E2E_URL,
    browserName: "chromium",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // WebGL without a GPU, as on a headless CI machine.
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  },
});
