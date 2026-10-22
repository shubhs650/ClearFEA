// SPDX-License-Identifier: AGPL-3.0-or-later
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
          // The seed folder is read like a migrations folder: one entry per file, split into statements.
          TEST_SEED: await readD1Migrations("./seed"),
          WORKER_TOKEN: "test-worker-token",
          SESSION_SECRET: "test-session-secret",
          // The seeded alice is the admin (M10.3); the sign-in mode stays local.
          ADMIN_EMAIL: "alice@clearfea.test",
        },
      },
    })),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
