-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Pause and resume from the admin dashboard (M13.2, ADR-113, ADR-127): while queue_paused is 1 no
-- worker claims a job, so nothing new starts; jobs already running finish, and new jobs still
-- queue and wait. Set from the dashboard's Overview, each change recorded as an admin action.
INSERT INTO settings (name, value) VALUES ('queue_paused', 0);
