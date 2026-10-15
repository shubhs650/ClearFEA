-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Metering and the ledger (M1.11, ADR-033; docs/ARCHITECTURE.md sections 4 and 6).
-- Money is stored as whole micro-credits (1,000,000 is one credit), so sums are exact.

-- Machine sizes and their hourly rates. Configuration, not user data: change a rate with
-- `wrangler d1 execute`. A job keeps the rate it was queued at, so a change applies to new jobs.
CREATE TABLE machine_sizes (
  name TEXT PRIMARY KEY NOT NULL,
  -- Micro-credits per hour of billable time.
  rate_per_hour INTEGER NOT NULL CHECK (rate_per_hour >= 0),
  -- The size new metered jobs use until users choose one (M2.12). Exactly one row has 1.
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1))
);

CREATE UNIQUE INDEX machine_sizes_one_default ON machine_sizes (is_default) WHERE is_default = 1;

-- Phase 0 has one machine, the local worker. Its rate is a placeholder until beta cost data
-- sets real rates (DECISIONS.md, open items).
INSERT INTO machine_sizes (name, rate_per_hour, is_default) VALUES ('local', 1000000, 1);

-- Metered jobs (mesh, solve) record the machine size and rate when queued, then what the
-- worker measured and what it cost when they end. Null on jobs that are not metered.
ALTER TABLE jobs ADD COLUMN machine_size TEXT;
ALTER TABLE jobs ADD COLUMN rate_per_hour INTEGER;
-- Wall-clock milliseconds the worker measured (Metering.billableMs), on every finished job.
ALTER TABLE jobs ADD COLUMN billable_ms INTEGER;
-- billable_ms rounded up to whole seconds, and the cost in micro-credits (0 when not charged).
ALTER TABLE jobs ADD COLUMN billed_seconds INTEGER;
ALTER TABLE jobs ADD COLUMN cost INTEGER;

-- The ledger: append-only; the API inserts entries and never updates or deletes them
-- (apps/api/src/billing/ledger.ts). A charge is a negative amount; balance is the owner's balance after
-- the entry. A job is charged at most once.
CREATE TABLE ledger_entries (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL REFERENCES users (id),
  amount INTEGER NOT NULL,
  balance INTEGER NOT NULL,
  -- What the entry is for: the job type for a charge.
  reason TEXT NOT NULL,
  job_id TEXT UNIQUE REFERENCES jobs (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX ledger_entries_owner ON ledger_entries (owner_id, seq);
