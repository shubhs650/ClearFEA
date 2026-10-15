-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Uploaded STEP geometry and its import (docs/ARCHITECTURE.md sections 3 and 4, ADR-023, ADR-024).
-- Lengths are metres. Files live in R2 under owners/<owner>/geometries/<id>/.

CREATE TABLE geometries (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Projects get routes later in M1; until then a geometry belongs to no project.
  project_id TEXT REFERENCES projects (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'importing' CHECK (
    status IN ('importing', 'needs_unit', 'unconfirmed', 'ready', 'failed')
  ),
  -- Why the import failed, in plain language.
  problem TEXT,
  -- The length unit as the file declares it, as a units.json symbol, and why there is none.
  declared_unit TEXT,
  detected_unit TEXT,
  unit_problem TEXT,
  -- Metres per file coordinate as OpenCASCADE reads the file (ADR-024).
  reading_factor REAL,
  -- The unit the user confirmed; null until they do.
  confirmed_unit TEXT,
  -- Geometry.OCCScaling that the current topology.json and display mesh were made with.
  scaling REAL,
  body_count INTEGER,
  face_count INTEGER,
  size REAL,
  -- JSON array: xmin, ymin, zmin, xmax, ymax, zmax.
  bbox TEXT,
  -- The latest import job.
  import_job_id TEXT REFERENCES jobs (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX geometries_owner_id ON geometries (owner_id, created_at);

-- Job parameters (an ImportParams for import jobs) and the worker's plain-language failure text.
ALTER TABLE jobs ADD COLUMN params TEXT;
ALTER TABLE jobs ADD COLUMN failure_message TEXT;
