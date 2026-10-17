-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Cancelling a running job (M8.2, ADR-084; docs/ARCHITECTURE.md section 6). The API cannot stop
-- the worker itself: it records what was asked, the next heartbeat tells the worker, and the
-- worker reports the time it used, which the owner pays (DECISIONS "Failed runs"). The job
-- then ends with this status. M8.3's stop limit asks with 'stopped_at_limit'.
ALTER TABLE jobs ADD COLUMN stop_requested TEXT CHECK (stop_requested IN ('cancelled', 'stopped_at_limit'));
ALTER TABLE jobs ADD COLUMN stop_requested_at TEXT;
