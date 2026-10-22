// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextDelay, POLL_FIRST_MS, POLL_MAX_MS, type PollOutcome, startPolling, waitChanged } from "../src/jobs/usePolling";

/** A document whose visibility the test sets, with the listeners the poller adds. */
function page() {
  const target = new EventTarget();
  let state: DocumentVisibilityState = "visible";
  const doc = {
    get visibilityState() {
      return state;
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  } as unknown as Document;
  return {
    doc,
    show(next: DocumentVisibilityState) {
      state = next;
      target.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

/** Times (ms since the start) at which `check` ran. */
function recorder(outcome: () => PollOutcome | Promise<PollOutcome> = () => ({ changed: false })) {
  const times: number[] = [];
  const start = Date.now();
  const check = vi.fn(async () => {
    times.push(Date.now() - start);
    return outcome();
  });
  return { times, check };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("polling back-off (M11.2, ADR-112)", () => {
  it("doubles from 2 s to 30 s while nothing changes, and starts again from 2 s on a change", () => {
    expect(nextDelay(POLL_FIRST_MS, { changed: false })).toBe(4000);
    expect(nextDelay(16_000, { changed: false })).toBe(POLL_MAX_MS);
    expect(nextDelay(POLL_MAX_MS, { changed: false })).toBe(POLL_MAX_MS);
    expect(nextDelay(16_000, { changed: true })).toBe(POLL_FIRST_MS);
  });

  it("never asks sooner than the API's hint, nor later than 30 s", () => {
    expect(nextDelay(POLL_FIRST_MS, { changed: true, retryAfter: 15 })).toBe(15_000);
    expect(nextDelay(POLL_FIRST_MS, { changed: false, retryAfter: 2 })).toBe(4000);
    expect(nextDelay(POLL_FIRST_MS, { changed: false, retryAfter: 600 })).toBe(POLL_MAX_MS);
  });

  it("checks at 2, 6, 14, 30, 60 and 90 s while nothing changes", async () => {
    const { doc } = page();
    const { times, check } = recorder();
    const stop = startPolling(check, doc);
    await vi.advanceTimersByTimeAsync(95_000);
    stop();
    expect(times).toEqual([2000, 6000, 14_000, 30_000, 60_000, 90_000]);
  });

  it("goes back to 2 s after a change", async () => {
    const { doc } = page();
    let n = 0;
    const { times, check } = recorder(() => ({ changed: ++n === 3 }));
    const stop = startPolling(check, doc);
    await vi.advanceTimersByTimeAsync(20_000);
    stop();
    expect(times).toEqual([2000, 6000, 14_000, 16_000, 20_000]);
  });

  it("stops checking once stopped", async () => {
    const { doc } = page();
    const { check } = recorder();
    const stop = startPolling(check, doc);
    await vi.advanceTimersByTimeAsync(2000);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("does not check while the tab is hidden, and checks at once when it is shown again", async () => {
    const { doc, show } = page();
    const { times, check } = recorder();
    const stop = startPolling(check, doc);
    show("hidden");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(check).not.toHaveBeenCalled();
    show("visible");
    await vi.advanceTimersByTimeAsync(4000);
    stop();
    expect(times).toEqual([120_000, 124_000]);
  });

  it("keeps one check in flight at a time", async () => {
    const { doc, show } = page();
    let finish: (outcome: PollOutcome) => void = () => {};
    const check = vi.fn(() => new Promise<PollOutcome>((resolve) => (finish = resolve)));
    const stop = startPolling(check, doc);
    await vi.advanceTimersByTimeAsync(2000);
    show("hidden");
    show("visible");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(check).toHaveBeenCalledTimes(1);
    finish({ changed: false });
    await vi.advanceTimersByTimeAsync(4000);
    stop();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("backs off after a check that failed", async () => {
    const { doc } = page();
    const { times, check } = recorder(() => Promise.reject(new Error("offline")));
    const stop = startPolling(check, doc);
    await vi.advanceTimersByTimeAsync(15_000);
    stop();
    expect(times).toEqual([2000, 6000, 14_000]);
  });

  it("counts a new queue place or machine start as a change", () => {
    const wait = { status: "queued", queuePosition: 2, machineStarting: false, retryAfter: 10 } as const;
    expect(waitChanged(wait, { ...wait, retryAfter: 5 })).toBe(false);
    expect(waitChanged(wait, { ...wait, queuePosition: 1 })).toBe(true);
    expect(waitChanged(wait, { ...wait, machineStarting: true })).toBe(true);
    expect(waitChanged(wait, null)).toBe(true);
    expect(waitChanged(null, null)).toBe(false);
  });
});

describe("a 20-minute solve from one tab (M11 exit)", () => {
  /** The run's stage at `t` seconds: queued, the worker's stages, 20 minutes solving, the results. */
  const STAGES: [number, string][] = [
    [0, "queued"],
    [5, "downloading"],
    [8, "writing input"],
    [10, "solving"],
    [1210, "uploading"],
    [1215, "reading results"],
    [1225, "writing result files"],
    [1230, "uploading results"],
    [1235, "finished"],
  ];
  const stageAt = (t: number) => STAGES.filter(([from]) => from <= t).at(-1)?.[1] ?? "queued";

  it("asks for the run's status about 60 times, and for its log once per status check", async () => {
    vi.setSystemTime(0);
    const { doc } = page();
    let seen = "queued";
    let stop = () => {};
    const { times, check } = recorder(() => {
      const stage = stageAt(Date.now() / 1000);
      const changed = stage !== seen;
      seen = stage;
      if (stage === "finished") stop();
      return { changed, retryAfter: stage === "queued" ? 5 : 2 };
    });
    stop = startPolling(check, doc);
    await vi.advanceTimersByTimeAsync(1300_000);
    stop();
    // 54 checks: 2 s steps through each change of stage, 30 s apart while it solves, the last
    // 2 s after it finished. Each is one GET of the run and, with the log's `more`, one of its log.
    expect(times).toHaveLength(54);
    expect(times.filter((t) => t > 41_000 && t < 1211_000).every((t) => (t - 41_000) % 30_000 === 0)).toBe(true);
    expect(times.at(-1)).toBe(1237_000);
  });
});
