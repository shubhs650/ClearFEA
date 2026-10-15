-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Simulations and their current SimulationSpec (docs/ARCHITECTURE.md section 4, ADR-026).
-- A geometry that a simulation uses has its unit locked; deleting a used geometry is refused.

CREATE TABLE simulations (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Projects get routes later; until then a simulation belongs to no project.
  project_id TEXT REFERENCES projects (id) ON DELETE CASCADE,
  geometry_id TEXT NOT NULL REFERENCES geometries (id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  -- The spec's analysis and version, kept as columns so they can be queried without parsing it.
  analysis_type TEXT NOT NULL,
  spec_version INTEGER NOT NULL,
  -- The current SimulationSpec as JSON (packages/spec/schemas/simulation.schema.json).
  spec TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX simulations_owner_id ON simulations (owner_id, created_at);
CREATE INDEX simulations_geometry_id ON simulations (geometry_id);
