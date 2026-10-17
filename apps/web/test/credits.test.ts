// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { bytes } from "../src/billing/bytes";
import { credits } from "../src/billing/credits";
import { duration, memory } from "../src/billing/estimate";

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

describe("estimate figures", () => {
  it("write memory in MiB below a GiB and GiB above, to two significant figures", () => {
    expect(memory(95 * 2 ** 20)).toBe("95 MiB");
    expect(memory(1000)).toBe("1 MiB");
    expect(memory(9.49 * 2 ** 30)).toBe("9.5 GiB");
    expect(memory(2 ** 30)).toBe("1 GiB");
  });

  it("write time in seconds, minutes or hours", () => {
    expect(duration(0)).toBe("1 s");
    expect(duration(42)).toBe("42 s");
    expect(duration(89)).toBe("89 s");
    expect(duration(574)).toBe("9.6 min");
    expect(duration(1273)).toBe("21 min");
    expect(duration(3 * 3600 + 600)).toBe("3.2 h");
  });
});

describe("stored sizes (M8.6)", () => {
  it("write bytes below a KiB and binary units to three significant figures above", () => {
    expect(bytes(0)).toBe("0 bytes");
    expect(bytes(1)).toBe("1 byte");
    expect(bytes(1023)).toBe("1,023 bytes");
    expect(bytes(2048)).toBe("2 KiB");
    expect(bytes(1_500_000)).toBe("1.43 MiB");
    expect(bytes(5 * 2 ** 30)).toBe("5 GiB");
    expect(bytes(3 * 2 ** 40)).toBe("3 TiB");
  });
});
