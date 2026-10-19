// SPDX-License-Identifier: AGPL-3.0-or-later

/** Bindings declared in wrangler.jsonc, and variables from .dev.vars. */
export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  /** Shared secret the job worker sends on /internal routes. Unset means those routes refuse. */
  WORKER_TOKEN?: string;
  /** Key that signs session cookies (ADR-022). Unset means signed-in routes refuse. */
  SESSION_SECRET?: string;
  /** "true" turns on self-hosting mode: the wallet is informational and never refuses (ADR-084). */
  SELF_HOSTED?: string;
  /** The git commit a production deploy was made from, written by scripts/production-config.mjs (ADR-095). */
  CLEARFEA_COMMIT?: string;
  /**
   * The R2 API token that signs job files' transfer URLs (M10.5, ADR-098). With these and the account
   * and bucket below, a claim hands the worker presigned R2 URLs; without them, as under `make dev`,
   * the API's own pass-through routes.
   */
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  /** The Cloudflare account and the FILES bucket's name, written by scripts/productionConfig.mjs. */
  R2_ACCOUNT_ID?: string;
  R2_BUCKET?: string;
}
