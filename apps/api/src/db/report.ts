// SPDX-License-Identifier: AGPL-3.0-or-later
// Report options per simulation and the company name and logo per user (M7.1, ADR-074). Every
// function takes the acting user's id and filters on owner_id. Options are checked by the caller.

import type { ReportBranding, ReportLogo, ReportOptions } from "@clearfea/spec";

export function logoKey(ownerId: string): string {
  return `owners/${ownerId}/report/logo`;
}

/** A simulation's saved report options, or null when none are saved (or it is not the user's). */
export async function getReportOptions(
  db: D1Database,
  userId: string,
  simulationId: string,
): Promise<{ options: ReportOptions; updatedAt: string } | null> {
  const row = await db
    .prepare("SELECT options, updated_at FROM report_options WHERE simulation_id = ? AND owner_id = ?")
    .bind(simulationId, userId)
    .first<{ options: string; updated_at: string }>();
  return row === null ? null : { options: JSON.parse(row.options) as ReportOptions, updatedAt: row.updated_at };
}

/**
 * Saves the report options of one of the user's simulations, replacing any saved before. Returns
 * null when the simulation is not the user's; the insert checks that in the same statement.
 */
export async function saveReportOptions(
  db: D1Database,
  userId: string,
  simulationId: string,
  options: ReportOptions,
): Promise<{ updatedAt: string } | null> {
  const row = await db
    .prepare(
      `INSERT INTO report_options (simulation_id, owner_id, options)
        SELECT id, owner_id, ? FROM simulations WHERE id = ? AND owner_id = ?
        ON CONFLICT (simulation_id) DO UPDATE
          SET options = excluded.options, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        RETURNING updated_at`,
    )
    .bind(JSON.stringify(options), simulationId, userId)
    .first<{ updated_at: string }>();
  return row === null ? null : { updatedAt: row.updated_at };
}

interface BrandingRow {
  company_name: string;
  logo_type: ReportLogo["contentType"] | null;
  logo_bytes: number | null;
  logo_width: number | null;
  logo_height: number | null;
  logo_updated_at: string | null;
}

/** The user's company name and logo; empty and none until they set them. */
export async function getBranding(db: D1Database, userId: string): Promise<ReportBranding> {
  const row = await db
    .prepare(
      `SELECT company_name, logo_type, logo_bytes, logo_width, logo_height, logo_updated_at
        FROM report_branding WHERE owner_id = ?`,
    )
    .bind(userId)
    .first<BrandingRow>();
  if (row === null) return { companyName: "", logo: null };
  const logo: ReportLogo | null =
    row.logo_type === null ||
    row.logo_bytes === null ||
    row.logo_width === null ||
    row.logo_height === null ||
    row.logo_updated_at === null
      ? null
      : {
          contentType: row.logo_type,
          sizeBytes: row.logo_bytes,
          width: row.logo_width,
          height: row.logo_height,
          updatedAt: row.logo_updated_at,
        };
  return { companyName: row.company_name, logo };
}

export async function saveCompanyName(db: D1Database, userId: string, companyName: string): Promise<ReportBranding> {
  await db
    .prepare(
      `INSERT INTO report_branding (owner_id, company_name) VALUES (?, ?)
        ON CONFLICT (owner_id) DO UPDATE
          SET company_name = excluded.company_name, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
    .bind(userId, companyName)
    .run();
  return getBranding(db, userId);
}

/** Records the logo stored under logoKey, or with null that there is none. */
export async function saveLogo(
  db: D1Database,
  userId: string,
  logo: Omit<ReportLogo, "updatedAt"> | null,
): Promise<ReportBranding> {
  await db
    .prepare(
      `INSERT INTO report_branding (owner_id, logo_type, logo_bytes, logo_width, logo_height, logo_updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, CASE WHEN ?2 IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now') END)
        ON CONFLICT (owner_id) DO UPDATE
          SET logo_type = excluded.logo_type, logo_bytes = excluded.logo_bytes, logo_width = excluded.logo_width,
              logo_height = excluded.logo_height, logo_updated_at = excluded.logo_updated_at,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
    .bind(userId, logo?.contentType ?? null, logo?.sizeBytes ?? null, logo?.width ?? null, logo?.height ?? null)
    .run();
  return getBranding(db, userId);
}
