// SPDX-License-Identifier: AGPL-3.0-or-later
// The units table's own checks (ADR-018, ADR-038); worker/tests/test_units.py makes the same.
import { describe, expect, it } from "vitest";
import { checkUnitsTable, isUnitSystem, systemUnit, unitsTable } from "../src/units";

function table(changes: Record<string, unknown> = {}): unknown {
  return {
    version: 2,
    kinds: { length: { si: "m", units: { m: { factor: 1, definition: "SI" } } } },
    systems: { si: { name: "SI", units: { length: "m" } } },
    defaultSystem: "si",
    ...changes,
  };
}

describe("the units table", () => {
  it("names a unit of the right kind for every kind in every system", () => {
    expect(unitsTable.systems[unitsTable.defaultSystem]).toBeDefined();
    for (const system of Object.values(unitsTable.systems)) {
      expect(Object.keys(system.units).sort()).toEqual(Object.keys(unitsTable.kinds).sort());
      for (const [kind, unit] of Object.entries(system.units)) {
        expect(unitsTable.kinds[kind]?.units[unit]).toBeDefined();
      }
    }
  });

  it("keeps temperatures and temperature differences apart", () => {
    expect(unitsTable.kinds.temperature?.units["°C"]?.offset).toBe(273.15);
    expect(unitsTable.kinds.temperatureDifference?.units["°C"]?.offset).toBeUndefined();
  });

  it("refuses a table without systems", () => {
    const { systems: _, ...withoutSystems } = table() as Record<string, unknown>;
    expect(() => checkUnitsTable(withoutSystems)).toThrow(/does not match its schema/);
  });

  it("accepts a minimal table", () => {
    expect(checkUnitsTable(table()).defaultSystem).toBe("si");
  });

  it.each([
    ["an SI unit with a factor", { kinds: { length: { si: "m", units: { m: { factor: 2, definition: "x" } } } } }, /factor 1/],
    ["a system without a kind", { systems: { si: { name: "SI", units: {} } } }, /must name a length unit/],
    ["a system unit of another kind", { systems: { si: { name: "SI", units: { length: "Pa" } } } }, /must name a length unit/],
    [
      "a system naming an unknown kind",
      { systems: { si: { name: "SI", units: { length: "m", stress: "Pa" } } } },
      /not a quantity kind/,
    ],
    ["an unknown default system", { defaultSystem: "us" }, /default unit system/],
  ])("refuses %s", (_, changes, message) => {
    expect(() => checkUnitsTable(table(changes))).toThrow(message);
  });
});

describe("unit systems", () => {
  it("gives the unit a system uses for a kind", () => {
    expect(systemUnit("metric-mm", "pressure")).toBe("MPa");
    expect(systemUnit("si", "length")).toBe("m");
    expect(systemUnit("us-in", "force")).toBe("lbf");
  });

  it("falls back to the default system for an unknown id, and refuses an unknown kind", () => {
    expect(isUnitSystem("retired")).toBe(false);
    expect(systemUnit("retired", "length")).toBe(systemUnit(unitsTable.defaultSystem, "length"));
    expect(() => systemUnit("si", "stress")).toThrow(/not a known quantity kind/);
  });
});
