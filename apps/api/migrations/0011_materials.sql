-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Users' own materials (M2.9, ADR-046). The generic library is a reviewed file in the repository
-- (packages/spec/library/materials.json), not rows here. A simulation copies a material into its
-- spec, so deleting or changing one never touches a simulation or a run.

CREATE TABLE materials (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- The material as an IsotropicMaterial (packages/spec/schemas/simulation.schema.json), with
  -- its values as entered and its source note; its id is this row's id.
  material TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (owner_id, name)
);
