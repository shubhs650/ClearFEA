// SPDX-License-Identifier: AGPL-3.0-or-later
// Users' own materials (M2.9, ADR-046). Every function takes the acting user's id and filters on
// owner_id. Materials are checked by the caller before they get here.

import type { IsotropicMaterial } from "@clearfea/spec";

interface MaterialRow {
  id: string;
  material: string;
}

function toMaterial(row: MaterialRow): IsotropicMaterial {
  return { ...(JSON.parse(row.material) as IsotropicMaterial), id: row.id };
}

/** The user's materials, by name. */
export async function listMaterials(db: D1Database, userId: string): Promise<IsotropicMaterial[]> {
  const { results } = await db
    .prepare("SELECT id, material FROM materials WHERE owner_id = ? ORDER BY name COLLATE NOCASE, id")
    .bind(userId)
    .all<MaterialRow>();
  return results.map(toMaterial);
}

/**
 * Saves a material for the user under a new id. Returns null when the user already has a
 * material of that name; the unique index decides, so two saves at once cannot both succeed.
 */
export async function saveMaterial(
  db: D1Database,
  userId: string,
  material: IsotropicMaterial,
): Promise<IsotropicMaterial | null> {
  const saved = { ...material, id: crypto.randomUUID() };
  const result = await db
    .prepare("INSERT OR IGNORE INTO materials (id, owner_id, name, material) VALUES (?, ?, ?, ?)")
    .bind(saved.id, userId, saved.name, JSON.stringify(saved))
    .run();
  return result.meta.changes === 1 ? saved : null;
}

/** Deletes one of the user's materials; false when they have none with that id. */
export async function deleteMaterial(db: D1Database, userId: string, id: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM materials WHERE id = ? AND owner_id = ?").bind(id, userId).run();
  return result.meta.changes === 1;
}
