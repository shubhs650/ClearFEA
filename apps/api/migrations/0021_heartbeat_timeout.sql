-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Failure classification (M8.4): a claimed or running job whose worker has sent no heartbeat for
-- this many seconds is failed as a fault in ClearFEA (worker_lost) and not charged. Workers beat
-- every 5 s, so this is 24 missed beats. A placeholder, like the other settings.
INSERT INTO settings (name, value) VALUES ('heartbeat_timeout_seconds', 120);
