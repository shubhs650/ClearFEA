// SPDX-License-Identifier: AGPL-3.0-or-later

/** Bindings declared in wrangler.jsonc, and variables from .dev.vars. */
export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  /** Shared secret the job worker sends on /internal routes. Unset means those routes refuse. */
  WORKER_TOKEN?: string;
  /** Key that signs session cookies (ADR-022). Unset means signed-in routes refuse. */
  SESSION_SECRET?: string;
}
