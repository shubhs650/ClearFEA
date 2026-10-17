-- SPDX-License-Identifier: AGPL-3.0-or-later
-- The stop limit of a run (M8.3, ADR-086): its solve job is stopped once it has had the machine
-- for stop_after_seconds, the estimated time times stop_multiplier. Null for jobs from before
-- M8.3 and for jobs that are not runs, which have no limit.
ALTER TABLE jobs ADD COLUMN stop_multiplier REAL;
ALTER TABLE jobs ADD COLUMN stop_after_seconds INTEGER CHECK (stop_after_seconds > 0);
