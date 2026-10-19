-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Solver machines started on demand on AWS (M10.7, ADR-095 items 6 and 8, ADR-100). One row per
-- start the API asked ECS for. The machine's worker is called `aws-<id>`, so its claims and
-- heartbeats mark the row when it first and last made contact: a start is pending until its
-- worker is seen, a worker is alive while it was seen in the last minute, and machine hours are
-- counted from each start to its worker's last contact. Not user data, so not owner-scoped.
CREATE TABLE worker_starts (
  id TEXT PRIMARY KEY NOT NULL,
  -- A machine_sizes name: medium (standard) or large.
  machine_size TEXT NOT NULL REFERENCES machine_sizes (name),
  requested_at TEXT NOT NULL,
  -- The ECS task ARN, once RunTask answered with one.
  task_arn TEXT,
  -- Why the start failed, in AWS's words, when RunTask refused it; null otherwise.
  problem TEXT,
  first_seen_at TEXT,
  last_seen_at TEXT
);

CREATE INDEX worker_starts_requested ON worker_starts (machine_size, requested_at);

-- Placeholders, like the other settings (DECISIONS.md, open items).
INSERT INTO settings (name, value) VALUES
  -- Machine hours per calendar month (UTC) after which no machine is started and new runs and
  -- meshes are refused. 0 pauses the solver (DEPLOYMENT.md section 7.6).
  ('machine_hours_cap', 60),
  -- Seconds a start may take to produce a worker before it counts as failed: Fargate pulls the
  -- whole worker image (a few GB) for every start.
  ('machine_start_wait_seconds', 420),
  -- Machines running or starting at once, over all sizes.
  ('machine_max_running', 3);
