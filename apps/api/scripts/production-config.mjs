// SPDX-License-Identifier: AGPL-3.0-or-later
// Writes wrangler.production.json, the configuration `wrangler deploy` uses for the live site
// (M10.1, ADR-095). Run from apps/api after building the web app:
//   CLOUDFLARE_D1_DATABASE_ID=<id> [CLEARFEA_COMMIT=<sha>] node scripts/production-config.mjs
// The commit defaults to the checked-out one. The file is not committed: it holds the account's
// database id, which lives in the GitHub variable of the same name (docs/DEPLOYMENT.md).

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { experimental_readRawConfig } from "wrangler";
import { productionConfig } from "./productionConfig.mjs";

const OUTPUT = "wrangler.production.json";

try {
  if (!existsSync("../web/dist/index.html")) {
    throw new Error("The web app is not built. Run `pnpm --filter @clearfea/web build` first.");
  }
  const { rawConfig } = experimental_readRawConfig({ config: "wrangler.jsonc" });
  const commit =
    process.env.CLEARFEA_COMMIT || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const config = productionConfig(rawConfig, { databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID, commit });
  writeFileSync(OUTPUT, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Wrote ${OUTPUT} for commit ${commit}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
