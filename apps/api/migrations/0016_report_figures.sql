-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Report figures (M7.2, ADR-011): PNGs drawn in the browser by the viewer, one per support
-- and load of a run's setup and one per saved view the report draws. They belong to the run the
-- report is made from, since a support's picture shows the run's frozen setup and a result plot
-- the run's results. The images live in R2 under owners/<owner_id>/runs/<run_id>/figures/.

CREATE TABLE report_figures (
  run_id TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('support', 'load', 'view')),
  -- The support's or load's id in the run's spec, or the saved view's id.
  item TEXT NOT NULL,
  caption TEXT NOT NULL,
  position INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (run_id, kind, item)
);
