// SPDX-License-Identifier: AGPL-3.0-or-later
// The production Worker's configuration (M10.1, ADR-095 item 1), derived from wrangler.jsonc so
// the code, compatibility date, bindings and cron triggers are the ones every test runs against.
// Kept free of I/O so the API tests can check it; scripts/production-config.mjs writes it out.

/** The site's address: a custom domain of the Worker, which Cloudflare gives its DNS record and certificate. */
export const PRODUCTION_DOMAIN = "clearfea.triyalabs.com";

/** The Worker's name in the Cloudflare account (DEPLOYMENT.md section 7.6). */
export const PRODUCTION_WORKER = "clearfea";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The production configuration: the base configuration with its development-only keys removed,
 * the production D1 database, the built web app served as static assets on the same origin, and
 * the deployed commit for /api/health.
 *
 * @param {Record<string, unknown>} base wrangler.jsonc as written
 * @param {{ databaseId: string | undefined, commit: string | undefined }} production
 * @returns {Record<string, unknown>}
 */
export function productionConfig(base, { databaseId, commit }) {
  const id = databaseId?.trim().toLowerCase() ?? "";
  if (!ID.test(id)) {
    throw new Error(
      "CLOUDFLARE_D1_DATABASE_ID must be the production database's id, like 1a2b3c4d-1a2b-1a2b-1a2b-1a2b3c4d5e6f. " +
        "Copy it from Cloudflare, D1, clearfea (docs/DEPLOYMENT.md section 1.4).",
    );
  }
  if (!commit?.trim()) {
    throw new Error("No commit to deploy: set CLEARFEA_COMMIT to the git commit being deployed.");
  }
  const databases = /** @type {Record<string, unknown>[]} */ (base.d1_databases ?? []);
  if (databases.length !== 1) {
    throw new Error(`wrangler.jsonc should bind one D1 database, not ${databases.length}.`);
  }

  // $schema points into node_modules relative to wrangler.jsonc; dev only applies to wrangler dev.
  const { $schema, dev, ...shared } = base;
  return {
    ...shared,
    name: PRODUCTION_WORKER,
    // The site is reached at its domain only, not at *.workers.dev or preview addresses.
    workers_dev: false,
    preview_urls: false,
    routes: [{ pattern: PRODUCTION_DOMAIN, custom_domain: true }],
    // The built web app (pnpm --filter @clearfea/web build). Paths the API answers reach the
    // Worker first; every other path that is not a file gets index.html, which picks the page.
    assets: {
      directory: "../web/dist",
      not_found_handling: "single-page-application",
      run_worker_first: ["/api/*", "/internal/*"],
    },
    d1_databases: [{ ...databases[0], database_id: id }],
    // Variables in this file replace the Worker's variables at each deploy; secrets are kept.
    // The live site signs in with Google only (M10.3, ADR-097); Google returns to this address.
    // Jobs run on AWS machines, so runs are offered only the cloud sizes switched on (M10.6).
    vars: {
      CLEARFEA_COMMIT: commit.trim(),
      AUTH_MODE: "google",
      BETTER_AUTH_URL: `https://${PRODUCTION_DOMAIN}`,
      MACHINES: "cloud",
    },
    observability: { enabled: true },
  };
}
