// SPDX-License-Identifier: AGPL-3.0-or-later
// The stop limit a multiplier gives (M8.3, ADR-087).
import { describe, expect, it } from "vitest";
import { atStopCeiling, MAX_STOP_SECONDS, MIN_STOP_SECONDS, stopLimitSeconds } from "../src";

describe("stopLimitSeconds", () => {
  it("is the estimate times the multiplier, rounded up to whole seconds", () => {
    expect(stopLimitSeconds(112, 3)).toBe(336);
    expect(stopLimitSeconds(101, 0.5)).toBe(51);
  });

  it("never stops a run sooner than the minimum", () => {
    expect(stopLimitSeconds(2, 3)).toBe(MIN_STOP_SECONDS);
    expect(stopLimitSeconds(0, 20)).toBe(MIN_STOP_SECONDS);
  });

  it("never lets a run go on longer than 12 hours (M11.3, ADR-112)", () => {
    expect(MAX_STOP_SECONDS).toBe(43_200);
    expect(stopLimitSeconds(5 * 3600, 3)).toBe(MAX_STOP_SECONDS);
    expect(stopLimitSeconds(4 * 3600, 3)).toBe(MAX_STOP_SECONDS);
    expect(stopLimitSeconds(4 * 3600 - 1, 3)).toBe(43_197);
    expect(atStopCeiling(stopLimitSeconds(5 * 3600, 3))).toBe(true);
    expect(atStopCeiling(43_197)).toBe(false);
  });
});
