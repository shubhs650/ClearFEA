// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { productionConfig } from "../scripts/productionConfig.mjs";

const BASE = {
  $schema: "./node_modules/wrangler/config-schema.json",
  name: "clearfea-api",
  main: "src/index.ts",
  compatibility_date: "2026-10-01",
  compatibility_flags: ["nodejs_als"],
  dev: { port: 8787 },
  d1_databases: [
    {
      binding: "DB",
      database_name: "clearfea",
      database_id: "00000000-0000-0000-0000-000000000000",
      migrations_dir: "migrations",
    },
  ],
  triggers: { crons: ["0 3 * * *"] },
  r2_buckets: [{ binding: "FILES", bucket_name: "clearfea-files" }],
};
const ID = "1a2b3c4d-1a2b-1a2b-1a2b-1a2b3c4d5e6f";
const ACCOUNT = "0123456789abcdef0123456789abcdef";

describe("productionConfig", () => {
  const config = productionConfig(BASE, { databaseId: ID, accountId: ACCOUNT, commit: "abc1234" });

  it("serves the site and the API from one Worker on the custom domain only", () => {
    expect(config.name).toBe("clearfea");
    expect(config.routes).toEqual([{ pattern: "clearfea.triyalabs.com", custom_domain: true }]);
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
    expect(config.assets).toEqual({
      directory: "../web/dist",
      not_found_handling: "single-page-application",
      run_worker_first: ["/api/*", "/internal/*"],
    });
  });

  it("keeps the code, compatibility date, bindings and cron triggers the tests run against", () => {
    expect(config.main).toBe(BASE.main);
    expect(config.compatibility_date).toBe(BASE.compatibility_date);
    expect(config.compatibility_flags).toEqual(BASE.compatibility_flags);
    expect(config.triggers).toEqual(BASE.triggers);
    expect(config.r2_buckets).toEqual(BASE.r2_buckets);
    expect(config.d1_databases).toEqual([{ ...BASE.d1_databases[0], database_id: ID }]);
    expect(config).not.toHaveProperty("dev");
    expect(config).not.toHaveProperty("$schema");
  });

  it("reports the deployed commit, signs in with Google only and names the account and bucket presigned URLs use", () => {
    expect(config.vars).toEqual({
      CLEARFEA_COMMIT: "abc1234",
      AUTH_MODE: "google",
      BETTER_AUTH_URL: "https://clearfea.triyalabs.com",
      R2_ACCOUNT_ID: ACCOUNT,
      R2_BUCKET: "clearfea-files",
    });
  });

  it("refuses a missing or malformed account id", () => {
    for (const accountId of [undefined, "", "my-account"]) {
      expect(() => productionConfig(BASE, { databaseId: ID, accountId, commit: "abc1234" })).toThrow(/section 1\.5/);
    }
  });

  it("refuses a missing or malformed database id", () => {
    expect(() => productionConfig(BASE, { databaseId: undefined, accountId: ACCOUNT, commit: "abc1234" })).toThrow(
      /CLOUDFLARE_D1_DATABASE_ID/,
    );
    expect(() => productionConfig(BASE, { databaseId: "clearfea", accountId: ACCOUNT, commit: "abc1234" })).toThrow(/section 1\.4/);
  });

  it("refuses to deploy without a commit", () => {
    expect(() => productionConfig(BASE, { databaseId: ID, accountId: ACCOUNT, commit: " " })).toThrow(/CLEARFEA_COMMIT/);
  });
});
