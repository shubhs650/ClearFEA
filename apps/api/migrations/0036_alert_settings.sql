-- SPDX-License-Identifier: AGPL-3.0-or-later
-- The dashboard's alerts (M13.5, ADR-113, ADR-130), shown to the admin on the Overview only
-- (Shubham, 2026-10-22), with their thresholds changed on the Settings tab.
INSERT INTO settings (name, value) VALUES
  -- Free bytes on the solver host's disk below which "disk low" is raised: 30 GiB, 10 GiB before
  -- the compute manager's lanes stop claiming at CLEARFEA_SCRATCH_MIN_FREE (20g, ADR-121).
  ('alert_disk_free_bytes', 32212254720),
  -- Hours back that tries out of memory and platform faults are counted over.
  ('alert_window_hours', 24),
  -- Tries ended by a fault of the platform in that window that raise "repeated platform failures".
  ('alert_platform_failures', 3);
