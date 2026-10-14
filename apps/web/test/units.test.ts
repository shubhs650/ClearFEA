// SPDX-License-Identifier: AGPL-3.0-or-later
// Checks the unit module against the shared fixture that the Python worker also runs.
import fixture from "@clearfea/spec/fixtures/unit-conversions.json";
import { describe, expect, it } from "vitest";
import { fromSi, toSi, UnitError } from "../src/units/convert";

const tolerance = fixture.relativeTolerance;

function expectClose(got: number, want: number) {
  expect(Math.abs(got - want)).toBeLessThanOrEqual(tolerance * Math.max(Math.abs(got), Math.abs(want)));
}

describe("unit conversion against the shared fixture", () => {
  it.each(fixture.conversions)("$value $unit ($kind) to SI", ({ kind, value, unit, si }) => {
    expectClose(toSi(value, unit, kind), si);
  });

  it.each(fixture.conversions)("$value $unit ($kind) from SI", ({ kind, value, unit, si }) => {
    expectClose(fromSi(si, unit, kind), value);
  });

  it.each(fixture.errors)("refuses: $reason", ({ kind, unit }) => {
    expect(() => toSi(1, unit, kind)).toThrow(UnitError);
  });
});
