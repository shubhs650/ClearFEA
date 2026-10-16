-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Saved views of a simulation (M3.6, ADR-055): camera, hidden bodies and, for views saved on
-- results, what the result view shows. The report (M7) lets the user pick them. A view belongs
-- to the simulation, not to a run, so it still applies after the simulation is run again.

CREATE TABLE views (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  simulation_id TEXT NOT NULL REFERENCES simulations (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- ViewSettings (packages/spec/schemas/view.schema.json) as JSON.
  settings TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (simulation_id, name)
);
