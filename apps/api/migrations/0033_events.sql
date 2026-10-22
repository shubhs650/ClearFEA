-- SPDX-License-Identifier: AGPL-3.0-or-later
-- The event log of the admin dashboard (M13.1, ADR-113, ADR-125): sign-ins and refusals, jobs
-- that failed or were queued again, the solver host coming online or going silent and its
-- manager restarting, and every admin action as an audit trail. Read by the admin only; kept.
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  kind TEXT NOT NULL CHECK (kind IN (
    'sign_in', 'sign_in_refused',
    'job_failed', 'job_retried',
    'host_online', 'host_offline', 'manager_started',
    'admin_action'
  )),
  level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error')),
  -- The user the event is about: who signed in, whose job it was, the admin who acted.
  user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  job_id TEXT REFERENCES jobs (id) ON DELETE SET NULL,
  host TEXT,
  -- One line for the admin, in plain words; never a project's name, model or results.
  message TEXT NOT NULL,
  -- The particulars as a JSON object, or NULL.
  detail TEXT
);

CREATE INDEX events_at ON events (at);
CREATE INDEX events_kind_at ON events (kind, at);
CREATE INDEX events_user_at ON events (user_id, at);

-- When the host's compute manager started, as it says in each check-in, so a restart of the
-- manager while the host stays up is an event of its own.
ALTER TABLE hosts ADD COLUMN manager_started_at TEXT;
