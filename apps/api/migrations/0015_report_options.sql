-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Report options (M7.1, ADR-074). What a simulation's report prints belongs to the simulation,
-- like its saved views, so it still applies after the simulation is run again. The company name
-- and logo belong to the user, so every report of theirs carries them without setting them again.

CREATE TABLE report_options (
  simulation_id TEXT PRIMARY KEY NOT NULL REFERENCES simulations (id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- ReportOptions (packages/spec/schemas/report.schema.json) as JSON.
  options TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE report_branding (
  owner_id TEXT PRIMARY KEY NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  company_name TEXT NOT NULL DEFAULT '',
  -- The logo is stored under owners/<owner_id>/report/logo; these describe it, or are all null.
  logo_type TEXT,
  logo_bytes INTEGER,
  logo_width INTEGER,
  logo_height INTEGER,
  logo_updated_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
