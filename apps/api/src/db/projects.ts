// SPDX-License-Identifier: AGPL-3.0-or-later
// Projects (docs/ARCHITECTURE.md section 4, ADR-038). In Phase 0 each user has one project, made
// the first time it is asked for; it holds the default unit system. Every function takes the
// acting user's id and filters on owner_id.

export interface Project {
  id: string;
  name: string;
  /** Unit system id from packages/spec/units.json, or null for the table's default. */
  unitSystem: string | null;
}

interface ProjectRow {
  id: string;
  name: string;
  default_unit_system: string | null;
}

const DEFAULT_NAME = "My project";

/**
 * The user's project, created if they have none. The insert runs only when no project of the
 * user exists, in the same statement, so two first requests cannot make two projects.
 */
export async function userProject(db: D1Database, userId: string): Promise<Project> {
  await db
    .prepare(
      `INSERT INTO projects (id, owner_id, name)
       SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM projects WHERE owner_id = ?)`,
    )
    .bind(crypto.randomUUID(), userId, DEFAULT_NAME, userId)
    .run();
  const row = await db
    .prepare(
      `SELECT id, name, default_unit_system FROM projects
        WHERE owner_id = ? ORDER BY created_at, id LIMIT 1`,
    )
    .bind(userId)
    .first<ProjectRow>();
  if (row === null) throw new Error("The project was not created.");
  return { id: row.id, name: row.name, unitSystem: row.default_unit_system };
}

/** Sets the default unit system of the user's project. The caller checks the id against units.json. */
export async function setProjectUnitSystem(db: D1Database, userId: string, unitSystem: string): Promise<Project> {
  const project = await userProject(db, userId);
  await db
    .prepare(
      `UPDATE projects SET default_unit_system = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND owner_id = ?`,
    )
    .bind(unitSystem, project.id, userId)
    .run();
  return { ...project, unitSystem };
}
