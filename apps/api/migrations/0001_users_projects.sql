-- SPDX-License-Identifier: AGPL-3.0-or-later
-- First schema: users and the projects they own (docs/ARCHITECTURE.md section 4).
-- Ids are UUID strings. Timestamps are ISO 8601 UTC strings.

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  login TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Unit system id from packages/spec/units.json (defined in M0.6 and M2.1).
  default_unit_system TEXT,
  visibility TEXT NOT NULL DEFAULT 'private',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX projects_owner_id ON projects (owner_id);
