// SPDX-License-Identifier: AGPL-3.0-or-later
// While a job waits on the live site, says when it is waiting for a solver machine to start
// (M10.10, ADR-103): after a break the first job waits 1 to 3 minutes, which with no word on
// screen looks like a fault. Since M11.2 (ADR-112) the screen's own poll brings the job's wait,
// so the note asks the API nothing itself.

import type { JobWait } from "@clearfea/spec";

/** The note, shown while the wait of the screen's job says a machine is starting for it. */
export function MachineStartNote({ wait }: { wait: JobWait | null }) {
  if (wait?.machineStarting !== true) return null;
  return (
    <p className="machine-start-note" role="status" aria-label="Solver machine">
      <strong>Starting a solver machine.</strong> After a break this takes 1 to 3 minutes, and the job then starts
      by itself. You can leave this page and come back.
    </p>
  );
}
