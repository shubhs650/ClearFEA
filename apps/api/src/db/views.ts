// SPDX-License-Identifier: AGPL-3.0-or-later
// Saved views of a simulation (M3.6, ADR-055). Every function takes the acting user's id and
// filters on owner_id. Settings are checked by the caller before they get here.

import type { SavedView, ViewSettings } from "@clearfea/spec";

interface ViewRow {
  id: string;
  name: string;
  settings: string;
  updated_at: string;
}

function toView(row: ViewRow): SavedView {
  return { id: row.id, name: row.name, settings: JSON.parse(row.settings) as ViewSettings, updatedAt: row.updated_at };
}

/** The views of one of the user's simulations, by name. */
export async function listViews(db: D1Database, userId: string, simulationId: string): Promise<SavedView[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, settings, updated_at FROM views WHERE owner_id = ? AND simulation_id = ?
        ORDER BY name COLLATE NOCASE, id`,
    )
    .bind(userId, simulationId)
    .all<ViewRow>();
  return results.map(toView);
}

/**
 * Saves a view of one of the user's simulations, replacing the simulation's view of the same
 * name (which keeps its id). Returns null when the simulation is not the user's; the insert
 * checks that in the same statement.
 */
export async function saveView(
  db: D1Database,
  userId: string,
  simulationId: string,
  name: string,
  settings: ViewSettings,
): Promise<{ view: SavedView; created: boolean } | null> {
  const id = crypto.randomUUID();
  const result = await db
    .prepare(
      `INSERT INTO views (id, owner_id, simulation_id, name, settings)
        SELECT ?, ?, id, ?, ? FROM simulations WHERE id = ? AND owner_id = ?
        ON CONFLICT (simulation_id, name) DO UPDATE
          SET settings = excluded.settings, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        RETURNING id, name, settings, updated_at`,
    )
    .bind(id, userId, name, JSON.stringify(settings), simulationId, userId)
    .first<ViewRow>();
  return result === null ? null : { view: toView(result), created: result.id === id };
}

/** Deletes a view of one of the user's simulations; false when there is none with that id. */
export async function deleteView(db: D1Database, userId: string, simulationId: string, id: string): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM views WHERE id = ? AND simulation_id = ? AND owner_id = ?")
    .bind(id, simulationId, userId)
    .run();
  return result.meta.changes === 1;
}
