-- SPDX-License-Identifier: AGPL-3.0-or-later
-- What one user, and everyone together, may queue (M11.3, ADR-112). Jobs run in two lanes: the
-- solve lane (solve jobs) and the light lane (import, mesh, report and no-op jobs). Starting
-- values, accepted by the maintainer on 2026-10-22; change them with `wrangler d1 execute`.
INSERT INTO settings (name, value) VALUES
  -- Jobs one user may have waiting in each lane; one more is refused until one starts.
  ('queue_waiting_per_user', 2),
  -- Jobs of one user that workers take at once in each lane; the next waits behind other users' jobs.
  ('queue_running_per_user', 1),
  -- Runs one user may start per calendar day (UTC), new runs and runs again alike.
  ('runs_per_user_per_day', 30),
  -- Jobs waiting over all users and lanes; one more is refused until the queue drains.
  ('queue_total_cap', 20);
