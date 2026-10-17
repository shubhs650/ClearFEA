-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Storage per user (M8.6, ADR-085; docs/ARCHITECTURE.md section 4): a free allowance, retention
-- of raw solver output, pinning, and a daily charge for what is stored above the allowance.

-- Configuration values, not user data: change one with `wrangler d1 execute`. The values below
-- are placeholders until beta data sets them (DECISIONS.md, open items).
CREATE TABLE settings (
  name TEXT PRIMARY KEY NOT NULL,
  value INTEGER NOT NULL CHECK (value >= 0)
);

INSERT INTO settings (name, value) VALUES
  -- Bytes each user stores free of charge: 5 GiB.
  ('storage_free_bytes', 5368709120),
  -- Days a run's raw solver output (results.frd, results.dat) is kept after the run ends,
  -- unless the run is pinned.
  ('raw_output_retention_days', 30),
  -- Micro-credits per GiB per day stored above the free allowance: 0.01 credits.
  ('storage_rate_per_gib_day', 10000);

-- A pinned run keeps its raw solver output past the retention period. The pin is the owner's
-- choice about storage, not one of the run's inputs, so it may change after the run is made.
ALTER TABLE runs ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1));
-- When the daily sweep removed the run's raw solver output; null while it is kept. The file list
-- (runs.files) still names what the job stored.
ALTER TABLE runs ADD COLUMN raw_removed_at TEXT;
-- The run whose frozen spec and mesh this run solved again to regenerate its raw output.
ALTER TABLE runs ADD COLUMN rerun_of TEXT REFERENCES runs (id);

-- One row per user per UTC day the sweep charged for storage above the allowance, with what it
-- measured. The primary key makes a day's charge happen at most once.
CREATE TABLE storage_charges (
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- YYYY-MM-DD, UTC.
  day TEXT NOT NULL,
  used_bytes INTEGER NOT NULL CHECK (used_bytes >= 0),
  free_bytes INTEGER NOT NULL CHECK (free_bytes >= 0),
  rate_per_gib_day INTEGER NOT NULL CHECK (rate_per_gib_day >= 0),
  -- The charge in micro-credits, positive; the ledger entry holds it negated.
  amount INTEGER NOT NULL CHECK (amount > 0),
  ledger_seq INTEGER NOT NULL UNIQUE REFERENCES ledger_entries (seq),
  PRIMARY KEY (owner_id, day)
);
