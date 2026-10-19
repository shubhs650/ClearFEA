// SPDX-License-Identifier: AGPL-3.0-or-later
// While a job waits on the live site, says when it is waiting for a solver machine to start
// (M10.10, ADR-103): after a break the first job waits 1 to 3 minutes, which with no word on
// screen looks like a fault.

import { useEffect, useState } from "react";
import { getMachineWait } from "../api/jobs";

/** How often the API is asked while a job waits. */
export const MACHINE_POLL_MS = 5000;

/** The note, shown while `waiting` and the API says a machine is starting for the user's work. */
export function MachineStartNote({ waiting }: { waiting: boolean }) {
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    if (!waiting) {
      setStarting(false);
      return;
    }
    let current = true;
    const check = async () => {
      const result = await getMachineWait();
      if (current && result.kind === "ok") setStarting(result.value);
    };
    void check();
    const timer = setInterval(check, MACHINE_POLL_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [waiting]);
  if (!waiting || !starting) return null;
  return (
    <p className="machine-start-note" role="status" aria-label="Solver machine">
      <strong>Starting a solver machine.</strong> After a break this takes 1 to 3 minutes, and the job then starts
      by itself. You can leave this page and come back.
    </p>
  );
}
