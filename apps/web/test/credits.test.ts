// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { credits } from "../src/billing/credits";

describe("credits", () => {
  it("writes micro-credits exactly, without trailing zeros", () => {
    expect(credits(833)).toBe("0.000833 credits");
    expect(credits(0)).toBe("0 credits");
    expect(credits(1_000_000)).toBe("1 credit");
    expect(credits(1_000_278)).toBe("1.000278 credits");
    expect(credits(2_500_000)).toBe("2.5 credits");
    expect(credits(1_234_000_000)).toBe("1,234 credits");
    expect(credits(-833)).toBe("-0.000833 credits");
  });

  it("refuses an amount that is not whole micro-credits", () => {
    expect(() => credits(0.5)).toThrow(RangeError);
  });
});
