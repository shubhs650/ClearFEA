-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Analysis meshes of a geometry (docs/ARCHITECTURE.md section 4, ADR-028).
-- Files live in R2 under owners/<owner>/meshes/<id>/: mesh.bin and display.bin.
-- Reuse across runs by a settings hash comes with M2.10; until then every request is a new mesh.

CREATE TABLE meshes (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  geometry_id TEXT NOT NULL REFERENCES geometries (id) ON DELETE RESTRICT,
  -- The global size as the user entered it: a JSON { value, unit } length quantity.
  size TEXT NOT NULL,
  element_order INTEGER NOT NULL CHECK (element_order IN (1, 2)),
  status TEXT NOT NULL DEFAULT 'meshing' CHECK (status IN ('meshing', 'ready', 'failed')),
  -- Why meshing failed, in plain language.
  problem TEXT,
  node_count INTEGER,
  element_count INTEGER,
  job_id TEXT REFERENCES jobs (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX meshes_owner_id ON meshes (owner_id, created_at);
CREATE INDEX meshes_geometry_id ON meshes (geometry_id);

-- The simulation's latest mesh, which the setup shows and the first run will use.
ALTER TABLE simulations ADD COLUMN mesh_id TEXT REFERENCES meshes (id);
