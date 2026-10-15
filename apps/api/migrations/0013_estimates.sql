-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Run estimates and machine sizes (M2.12, ADR-049).

-- A machine size's cores and memory, which the estimator compares a run's memory with. On
-- localhost there is one physical machine, so a size is simulated (ARCHITECTURE.md section 6);
-- its thread count and memory limit on the solver come with M8.5.
ALTER TABLE machine_sizes ADD COLUMN cores INTEGER NOT NULL DEFAULT 1 CHECK (cores >= 1);
ALTER TABLE machine_sizes ADD COLUMN memory_bytes INTEGER NOT NULL DEFAULT 0 CHECK (memory_bytes >= 0);

-- The published list replaces the single local size (ADR-033). Rates are placeholders in
-- proportion to memory until beta cost data sets real ones (DECISIONS.md, open items). Jobs
-- already billed keep the size name and rate they were queued with.
DELETE FROM machine_sizes;
INSERT INTO machine_sizes (name, cores, memory_bytes, rate_per_hour, is_default) VALUES
  ('small', 2, 8589934592, 500000, 0),
  ('medium', 4, 17179869184, 1000000, 1),
  ('large', 8, 34359738368, 2000000, 0),
  ('xlarge', 16, 68719476736, 4000000, 0);

-- RunEstimate (simulation.schema.json) as JSON: the estimate made when the run started, frozen
-- with it. Null for runs made before M2.12.
ALTER TABLE runs ADD COLUMN estimate TEXT;
