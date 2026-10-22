-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Statistics for support (M12.3, ADR-109, ADR-123). Read by the admin only.
--
-- job_stats: one row per try of a job. The claim starts it; heartbeats move it from stage to
-- stage; the job's completion (or the sweep of a lost worker) ends it, before a re-queue (M12.2)
-- can start the next try of the same job; the compute manager adds what the container used.
CREATE TABLE job_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  worker_id TEXT NOT NULL,
  -- When this try began to wait: the job's creation, or the end of its previous try.
  queued_at TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  -- The stage the try is in since stage_started_at, and milliseconds per stage left behind, as a
  -- JSON object. 'starting' runs from the claim to the first heartbeat.
  stage TEXT NOT NULL DEFAULT 'starting',
  stage_started_at TEXT NOT NULL,
  stage_ms TEXT NOT NULL DEFAULT '{}',
  ended_at TEXT,
  status TEXT CHECK (status IN ('succeeded', 'failed', 'cancelled', 'stopped_at_limit')),
  failure_category TEXT CHECK (failure_category IN ('user_fault', 'platform_fault')),
  failure_cause TEXT,
  nodes INTEGER,
  elements INTEGER,
  dofs INTEGER,
  solver TEXT,
  analysis TEXT,
  -- From the compute manager, once the container has ended (stats_at).
  stats_at TEXT,
  host TEXT,
  lane TEXT,
  image TEXT,
  exit_code INTEGER,
  out_of_memory INTEGER CHECK (out_of_memory IN (0, 1)),
  run_ms INTEGER,
  samples INTEGER,
  peak_memory_bytes INTEGER,
  cpu_seconds REAL,
  cpu_peak REAL,
  disk_written_bytes INTEGER,
  UNIQUE (job_id, attempt)
);

CREATE INDEX job_stats_claimed_at ON job_stats (claimed_at);
CREATE INDEX job_stats_open ON job_stats (job_id, worker_id) WHERE ended_at IS NULL OR stats_at IS NULL;

-- host_stats: the solver host's load at each check-in (every 30 s), kept 14 days.
CREATE TABLE host_stats (
  host TEXT NOT NULL,
  at TEXT NOT NULL,
  cpu REAL,
  steal REAL,
  load1 REAL NOT NULL,
  load5 REAL NOT NULL,
  load15 REAL NOT NULL,
  memory_total_bytes INTEGER NOT NULL,
  memory_available_bytes INTEGER NOT NULL,
  disk_total_bytes INTEGER NOT NULL,
  disk_free_bytes INTEGER NOT NULL,
  containers INTEGER NOT NULL,
  PRIMARY KEY (host, at)
);

CREATE INDEX host_stats_at ON host_stats (at);
