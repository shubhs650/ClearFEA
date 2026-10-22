-- SPDX-License-Identifier: AGPL-3.0-or-later
-- The solver host's check-ins (M12.4, ADR-120). With MACHINES=vps the compute manager on the
-- always-on VPS checks in every 30 s; while no host has checked in for 120 s, new jobs are
-- refused and the admin page says the host is offline. One row per host name.
CREATE TABLE hosts (
  name TEXT PRIMARY KEY,
  -- When the current run of check-ins began: the first ever, or the first after a silence.
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  manager_version TEXT
);
