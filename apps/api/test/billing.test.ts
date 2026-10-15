// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { billedSeconds, chargeFor, costOf, isMetered } from "../src/billing/cost";

describe("billed seconds", () => {
  it("rounds the measured milliseconds up to whole seconds", () => {
    expect([0, 1, 999, 1000, 1001, 59_999].map(billedSeconds)).toEqual([0, 1, 1, 1, 2, 60]);
  });

  it("refuses times that are not whole, non-negative milliseconds", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => billedSeconds(bad)).toThrow(RangeError);
    }
  });
});

describe("cost", () => {
  it("is seconds times the hourly rate over 3600, rounded to the nearest micro-credit", () => {
    expect(costOf(3600, 1_000_000)).toBe(1_000_000);
    expect(costOf(1, 1_000_000)).toBe(278); // 277.78
    expect(costOf(1, 1_800)).toBe(1); // 0.5 rounds up
    expect(costOf(1, 1_799)).toBe(0); // 0.4997 rounds down
    expect(costOf(0, 1_000_000)).toBe(0);
    expect(costOf(86_400, 0)).toBe(0);
  });

  it("is exact for a month of time at a large rate", () => {
    const seconds = 30 * 86_400;
    expect(costOf(seconds, 360_000_000)).toBe(seconds * 100_000);
  });

  it("refuses a product too large to compute exactly", () => {
    expect(() => costOf(2_592_000, 4_000_000_000)).toThrow(RangeError);
  });
});

describe("who pays", () => {
  it("charges a success and a failure in the user's setup, not a fault in ClearFEA", () => {
    expect(chargeFor(2500, 3_600_000, { status: "succeeded" })).toEqual({
      billableMs: 2500,
      billedSeconds: 3,
      cost: 3000,
      charged: true,
    });
    expect(chargeFor(2500, 3_600_000, { status: "failed", failureCategory: "user_fault" })).toMatchObject({
      cost: 3000,
      charged: true,
    });
    expect(chargeFor(2500, 3_600_000, { status: "failed", failureCategory: "platform_fault" })).toEqual({
      billableMs: 2500,
      billedSeconds: 3,
      cost: 0,
      charged: false,
    });
  });

  it("meters meshing and solving only; import is free", () => {
    expect(["noop", "import", "mesh", "solve", "report"].filter((t) => isMetered(t as never))).toEqual([
      "mesh",
      "solve",
    ]);
  });
});
