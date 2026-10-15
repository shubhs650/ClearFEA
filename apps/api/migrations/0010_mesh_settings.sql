-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Local mesh sizes and the quality summary of a mesh (M2.8, ADR-045).

-- The local sizes the mesh was made with, as a JSON array of { scope, tags, size } (size as
-- entered); meshes made before M2.8 had none.
ALTER TABLE meshes ADD COLUMN local_sizes TEXT NOT NULL DEFAULT '[]';
-- The quality summary of a ready mesh (MeshQuality in simulation.schema.json); null while
-- meshing, after a failure and for meshes made before M2.8.
ALTER TABLE meshes ADD COLUMN quality TEXT;
