// SPDX-License-Identifier: AGPL-3.0-or-later
// Types for the test runtime: the main module's exports and the migrations
// and seed bindings and the migration test database added in vitest.config.ts.
import type { D1Migration } from "cloudflare:test";
import type { Env } from "../src/env";

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof import("../src/index");
    }
    interface Env extends ProjectEnv {
      TEST_MIGRATIONS: D1Migration[];
      TEST_SEED: D1Migration[];
      MIGRATION_DB: D1Database;
    }
  }
}

type ProjectEnv = Env;
