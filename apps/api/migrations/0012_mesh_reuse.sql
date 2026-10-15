-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Mesh reuse across runs by settings hash (M2.10, ADR-047).

-- SHA-256, in hex, of meshSettingsText in packages/spec: the geometry, its scaling and the mesh
-- settings. A request whose hash matches a ready or still-meshing mesh of the same owner reuses
-- it instead of queueing a new job. Meshes made before M2.10 have none and are never reused.
ALTER TABLE meshes ADD COLUMN settings_hash TEXT;

CREATE INDEX meshes_settings_hash ON meshes (owner_id, settings_hash);
