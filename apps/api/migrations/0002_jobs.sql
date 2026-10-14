-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Jobs claimed by the worker (docs/ARCHITECTURE.md section 6, ADR-004).
-- `noop` exists so the claim loop can be exercised before any real job type.
-- Metering columns and job_logs arrive with the jobs that need them.

CREATE TABLE jobs (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('noop', 'import', 'mesh', 'solve', 'report')),
  -- Id of the record the job works on (geometry, mesh, run); null for noop.
  target_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN (
      'queued', 'claimed', 'running', 'succeeded', 'failed', 'cancelled', 'stopped_at_limit'
    )
  ),
  stage TEXT,
  claimed_by TEXT,
  heartbeat_at TEXT,
  failure_category TEXT CHECK (failure_category IN ('user_fault', 'platform_fault')),
  failure_cause TEXT,
  -- Result summary posted by the worker, as JSON text.
  result TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  claimed_at TEXT,
  finished_at TEXT
);

CREATE INDEX jobs_owner_id ON jobs (owner_id);
CREATE INDEX jobs_queue ON jobs (status, created_at);
