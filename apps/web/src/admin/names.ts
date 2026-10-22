// SPDX-License-Identifier: AGPL-3.0-or-later
// Names of job types and statuses on the admin dashboard (M13.2).

import type { AdminJob } from "@clearfea/spec";

export const JOB_TYPE_NAMES: Record<AdminJob["type"], string> = {
  noop: "No-op",
  import: "Import",
  mesh: "Mesh",
  solve: "Solve",
  report: "Report",
};

export const STATUS_NAMES: Record<AdminJob["status"], string> = {
  queued: "Queued",
  claimed: "Starting",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
  stopped_at_limit: "Stopped at its limit",
};
