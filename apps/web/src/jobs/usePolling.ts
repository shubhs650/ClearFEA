// SPDX-License-Identifier: AGPL-3.0-or-later
// The one polling loop of the web app (M11.2, ADR-112). Every screen that follows a job (an import,
// a mesh, a run, a report) checks on it through this hook: first after 2 s, then twice as long
// each time nothing changed, up to 30 s, and back to 2 s on a change; never sooner than the API's
// `retryAfter` hint; never while the tab is hidden, and at once when it is shown again; one check
// at a time; and not at all once the screen says the job has finished.

import type { JobWait } from "@clearfea/spec";
import { useEffect, useRef } from "react";

/** The wait before the first check, and after a check that found a change. */
export const POLL_FIRST_MS = 2000;
/** The longest wait between two checks. */
export const POLL_MAX_MS = 30_000;

/** What one check found. */
export interface PollOutcome {
  /** Whether what the screen shows changed; a change brings the next check back to POLL_FIRST_MS. */
  changed: boolean;
  /** The API's hint, in seconds, of when asking again is worth it. */
  retryAfter?: number | null;
}

/** The wait after a check that came `previous` ms after the one before. */
export function nextDelay(previous: number, outcome: PollOutcome): number {
  const backedOff = outcome.changed ? POLL_FIRST_MS : previous * 2;
  return Math.min(POLL_MAX_MS, Math.max(backedOff, (outcome.retryAfter ?? 0) * 1000));
}

/**
 * Runs `check` on the schedule above until the returned function is called. A check that throws
 * counts as one that found no change. Exported apart from the hook so it can be tested with
 * fake timers and its own document.
 */
export function startPolling(check: () => Promise<PollOutcome>, doc: Document = document): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delay = POLL_FIRST_MS;
  let checking = false;

  async function fire() {
    timer = undefined;
    if (stopped) return;
    // Hidden: wait for the tab to be shown again, which checks at once.
    if (doc.visibilityState === "hidden") return;
    checking = true;
    let outcome: PollOutcome = { changed: false };
    try {
      outcome = await check();
    } catch {
      // A failed check is tried again later, backing off like one that found nothing new.
    }
    checking = false;
    if (stopped) return;
    delay = nextDelay(delay, outcome);
    timer = setTimeout(fire, delay);
  }

  function shown() {
    if (stopped || checking || doc.visibilityState === "hidden") return;
    clearTimeout(timer);
    delay = POLL_FIRST_MS;
    void fire();
  }

  doc.addEventListener("visibilitychange", shown);
  timer = setTimeout(fire, POLL_FIRST_MS);
  return () => {
    stopped = true;
    clearTimeout(timer);
    doc.removeEventListener("visibilitychange", shown);
  };
}

/**
 * Polls while `target` is not null, starting again for each new target; null stops it, which a
 * screen does once the job it follows has finished. `check` is told whether its answer is still
 * wanted: after the target changed, a late answer must not reach the screen.
 */
export function usePolling(target: string | null, check: (current: () => boolean) => Promise<PollOutcome>): void {
  const latest = useRef(check);
  latest.current = check;
  useEffect(() => {
    if (target === null) return;
    let current = true;
    const stop = startPolling(() => latest.current(() => current));
    return () => {
      current = false;
      stop();
    };
  }, [target]);
}

/** Whether the wait changed in a way the screen shows or the schedule should follow. */
export function waitChanged(before: JobWait | null, after: JobWait | null): boolean {
  return (
    before?.status !== after?.status ||
    before?.queuePosition !== after?.queuePosition ||
    before?.machineStarting !== after?.machineStarting
  );
}
