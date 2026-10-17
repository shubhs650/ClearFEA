// SPDX-License-Identifier: AGPL-3.0-or-later
// Report options per simulation and the company name and logo per user (M7.1, ADR-074), and the
// figures captured in the browser for a run's report (M7.2, ADR-011). Every function takes the
// acting user's id and filters on owner_id. Options and figures are checked by the caller.

import type { ReportBranding, ReportFigure, ReportFigureKind, ReportLogo, ReportOptions } from "@clearfea/spec";

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

/** Where a run's figure is stored (M7.2). */
export function figureKey(ownerId: string, runId: string, kind: ReportFigureKind, item: string): string {
  return `owners/${ownerId}/runs/${runId}/figures/${kind}-${item}.png`;
}

interface FigureRow {
  kind: ReportFigureKind;
  item: string;
  caption: string;
  position: number;
  width: number;
  height: number;
  size_bytes: number;
  created_at: string;
}

function toFigure(row: FigureRow): ReportFigure {
  return {
    kind: row.kind,
    item: row.item,
    caption: row.caption,
    position: row.position,
    width: row.width,
    height: row.height,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

/** The figures of one of the user's runs, in order of position. */
export async function listFigures(db: D1Database, userId: string, runId: string): Promise<ReportFigure[]> {
  const { results } = await db
    .prepare(
      `SELECT kind, item, caption, position, width, height, size_bytes, created_at FROM report_figures
        WHERE run_id = ? AND owner_id = ? ORDER BY position, kind, item`,
    )
    .bind(runId, userId)
    .all<FigureRow>();
  return results.map(toFigure);
}

/**
 * Records a figure stored under figureKey for one of the user's runs, replacing one of the same
 * kind and item. Returns null when the run is not the user's; the insert checks that itself.
 */
export async function saveFigure(
  db: D1Database,
  userId: string,
  runId: string,
  figure: Omit<ReportFigure, "createdAt">,
): Promise<ReportFigure | null> {
  const row = await db
    .prepare(
      `INSERT INTO report_figures (run_id, owner_id, kind, item, caption, position, width, height, size_bytes)
        SELECT id, owner_id, ?, ?, ?, ?, ?, ?, ? FROM runs WHERE id = ? AND owner_id = ?
        ON CONFLICT (run_id, kind, item) DO UPDATE
          SET caption = excluded.caption, position = excluded.position, width = excluded.width,
              height = excluded.height, size_bytes = excluded.size_bytes, created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        RETURNING kind, item, caption, position, width, height, size_bytes, created_at`,
    )
    .bind(
      figure.kind,
      figure.item,
      figure.caption,
      figure.position,
      figure.width,
      figure.height,
      figure.sizeBytes,
      runId,
      userId,
    )
    .first<FigureRow>();
  return row === null ? null : toFigure(row);
}

/** Forgets every figure of one of the user's runs; the caller removes the images. */
export async function deleteFigures(db: D1Database, userId: string, runId: string): Promise<void> {
  await db.prepare("DELETE FROM report_figures WHERE run_id = ? AND owner_id = ?").bind(runId, userId).run();
}
