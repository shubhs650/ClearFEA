-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Crash handling and retries (M12.2, ADR-108). A job ended by a fault of the machine (its
-- container killed from outside, a manager restart, a VPS reboot, a worker gone silent) is queued
-- again, at most twice and uncharged; `attempt` counts the tries, 1 for the first. The peak
-- memory a solve job's worker measured, or a job container's memory limit when the kernel
-- killed it there, is kept with the job.
ALTER TABLE jobs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1;
ALTER TABLE jobs ADD COLUMN peak_memory_bytes INTEGER;
