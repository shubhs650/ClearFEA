// SPDX-License-Identifier: AGPL-3.0-or-later
// Simulations (docs/ARCHITECTURE.md section 4, ADR-026). Every function takes the acting
// user's id and filters on owner_id. Specs are checked by the caller before they get here.

import type { SimulationSpec } from "@clearfea/spec";

export interface Simulation {
  id: string;
  ownerId: string;
  geometryId: string;
  name: string;
  spec: SimulationSpec;
  createdAt: string;
  updatedAt: string;
}

interface SimulationRow {
  id: string;
  owner_id: string;
  geometry_id: string;
  name: string;
  spec: string;
  created_at: string;
  updated_at: string;
}

function toSimulation(row: SimulationRow): Simulation {
  return {
    id: row.id,
    ownerId: row.owner_id,
    geometryId: row.geometry_id,
    name: row.name,
    spec: JSON.parse(row.spec),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/**
 * Creates a simulation on one of the user's geometries. The insert happens only while the
 * geometry is ready, in the same statement, so a unit change cannot slip in between the
 * check and the insert; returns null if the geometry is not (or no longer) ready.
 */
export async function createSimulation(
  db: D1Database,
  userId: string,
  simulation: { id: string; name: string; spec: SimulationSpec },
): Promise<Simulation | null> {
  const { spec } = simulation;
  const result = await db
    .prepare(
      `INSERT INTO simulations (id, owner_id, geometry_id, name, analysis_type, spec_version, spec)
       SELECT ?, ?, id, ?, ?, ?, ? FROM geometries
        WHERE id = ? AND owner_id = ? AND status = 'ready'`,
    )
    .bind(
      simulation.id,
      userId,
      simulation.name,
      spec.analysis,
      spec.version,
      JSON.stringify(spec),
      spec.geometryId,
      userId,
    )
    .run();
  if (result.meta.changes !== 1) return null;
  return getSimulation(db, userId, simulation.id);
}

export async function getSimulation(
  db: D1Database,
  userId: string,
  simulationId: string,
): Promise<Simulation | null> {
  const row = await db
    .prepare("SELECT * FROM simulations WHERE id = ? AND owner_id = ?")
    .bind(simulationId, userId)
    .first<SimulationRow>();
  return row === null ? null : toSimulation(row);
}

/** The user's most recent simulations, newest first, optionally only those on one geometry. */
export async function listSimulations(
  db: D1Database,
  userId: string,
  options: { geometryId?: string; limit?: number } = {},
): Promise<Simulation[]> {
  const limit = options.limit ?? 50;
  const statement =
    options.geometryId === undefined
      ? db
          .prepare(
            "SELECT * FROM simulations WHERE owner_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
          )
          .bind(userId, limit)
      : db
          .prepare(
            `SELECT * FROM simulations WHERE owner_id = ? AND geometry_id = ?
              ORDER BY created_at DESC, id DESC LIMIT ?`,
          )
          .bind(userId, options.geometryId, limit);
  const { results } = await statement.all<SimulationRow>();
  return results.map(toSimulation);
}

/** Replaces a simulation's spec. Returns the updated simulation, or null if it is not the user's. */
export async function saveSpec(
  db: D1Database,
  userId: string,
  simulationId: string,
  spec: SimulationSpec,
): Promise<Simulation | null> {
  const result = await db
    .prepare(
      `UPDATE simulations SET spec = ?, analysis_type = ?, spec_version = ?, updated_at = ${NOW}
        WHERE id = ? AND owner_id = ?`,
    )
    .bind(JSON.stringify(spec), spec.analysis, spec.version, simulationId, userId)
    .run();
  if (result.meta.changes !== 1) return null;
  return getSimulation(db, userId, simulationId);
}
