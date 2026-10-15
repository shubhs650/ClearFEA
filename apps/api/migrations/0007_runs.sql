-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Runs of a simulation and the log text of jobs (docs/ARCHITECTURE.md section 4, ADR-030).
-- A run freezes the spec and the mesh it is solved with; nothing changes them afterwards.
-- Files live in R2 under owners/<owner>/runs/<id>/: deck.inp, solver.log, results.frd and
-- results.dat. Versions, machine size and cost columns come with M1.10 and M1.11.

CREATE TABLE runs (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  simulation_id TEXT NOT NULL REFERENCES simulations (id) ON DELETE RESTRICT,
  mesh_id TEXT NOT NULL REFERENCES meshes (id) ON DELETE RESTRICT,
  -- The SimulationSpec as it was when the run was started, as JSON.
  spec TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'solving' CHECK (status IN ('solving', 'succeeded', 'failed')),
  -- Why the run failed, in plain language.
  problem TEXT,
  -- The solve job's SolveResult, as JSON.
  result TEXT,
  job_id TEXT NOT NULL REFERENCES jobs (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at TEXT
);

CREATE INDEX runs_owner_id ON runs (owner_id, created_at);
CREATE INDEX runs_simulation_id ON runs (simulation_id, created_at);

-- Log text a job sent with its heartbeats, one row per heartbeat, in order.
CREATE TABLE job_logs (
  job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (job_id, seq)
);
