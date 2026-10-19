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
  /**
   * How people sign in (M10.3, ADR-097): "local" (the default) for the seeded password logins of
   * `make dev`, `make verify` and `make e2e`; "google" on the live site, where the password login is refused.
   */
  AUTH_MODE?: string;
  /** Signs Better Auth's sessions and OAuth state in "google" mode. Changing it signs everyone out. */
  BETTER_AUTH_SECRET?: string;
  /** The site's own address in "google" mode, from which Google's redirect address is formed. */
  BETTER_AUTH_URL?: string;
  /** The Google OAuth client (docs/DEPLOYMENT.md section 2.3). */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** The admin's email address: always allowed to sign in, and the only one to see the admin page. */
  ADMIN_EMAIL?: string;
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
