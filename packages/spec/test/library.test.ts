// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { checkMaterialLibrary, materialLibrary, type Quantity, unitsTable } from "../src";

/** The SI value of a quantity, from the units table's factor (none of these kinds has an offset). */
function si(quantity: Quantity, kind: string): number {
  const factor = unitsTable.kinds[kind]?.units[quantity.unit]?.factor;
  if (factor === undefined) throw new Error(`${quantity.unit} is not a ${kind} unit`);
  return quantity.value * factor;
}

describe("the material library", () => {
  it("holds 20 to 30 materials, as DECISIONS.md asks", () => {
    expect(materialLibrary.materials.length).toBeGreaterThanOrEqual(20);
    expect(materialLibrary.materials.length).toBeLessThanOrEqual(30);
  });

  it("gives every material a table of a cited reference", () => {
    const references = materialLibrary.references.map((reference) => reference.id);
    for (const material of materialLibrary.materials) {
      expect(references.some((id) => material.source?.startsWith(id)), material.name).toBe(true);
      expect(material.source, material.name).toMatch(/Table [0-9.]+\(\w+\)/);
    }
  });

  // A unit or decimal slip in the file shows up as a value outside the range of engineering metals.
  it("has values within the range of engineering metals once converted to SI", () => {
    for (const material of materialLibrary.materials) {
      const name = material.name;
      expect(material.youngsModulus && si(material.youngsModulus, "pressure"), name).toBeGreaterThan(40e9);
      expect(material.youngsModulus && si(material.youngsModulus, "pressure"), name).toBeLessThan(250e9);
      expect(material.poissonsRatio, name).toBeGreaterThanOrEqual(0.25);
      expect(material.poissonsRatio, name).toBeLessThanOrEqual(0.36);
      expect(material.density && si(material.density, "density"), name).toBeGreaterThan(1500);
      expect(material.density && si(material.density, "density"), name).toBeLessThan(9000);
      if (material.thermalExpansion) {
        expect(si(material.thermalExpansion, "thermalExpansion"), name).toBeGreaterThan(5e-6);
        expect(si(material.thermalExpansion, "thermalExpansion"), name).toBeLessThan(30e-6);
      }
    }
  });

  it("keeps the source's printed values and units", () => {
    const al6061 = materialLibrary.materials.find((m) => m.id === "lib-al-6061");
    expect(al6061).toMatchObject({
      youngsModulus: { value: 9900, unit: "ksi" },
      poissonsRatio: 0.33,
      density: { value: 0.098, unit: "lb/in³" },
      thermalExpansion: null,
    });
    expect(si(al6061?.youngsModulus ?? { value: 0, unit: "ksi" }, "pressure")).toBeCloseTo(68.258e9, -6);
    const al7050 = materialLibrary.materials.find((m) => m.id === "lib-al-7050");
    expect(al7050?.thermalExpansion).toEqual({ value: 12.8, unit: "µin/(in·°F)" });
  });

  it("refuses a library material without a source or with a unit of the wrong kind", () => {
    const [first] = materialLibrary.materials;
    if (first === undefined) throw new Error("empty library");
    const { source: _source, ...unsourced } = first;
    const raw = { ...materialLibrary, materials: [unsourced, { ...first, id: "lib-x", name: "X", density: { value: 1, unit: "ksi" } }] };
    expect(() => checkMaterialLibrary(raw, "test")).toThrow(
      `test: "${first.name}" needs a source; The density of material "X" is given in "ksi", which is not a density unit.`,
    );
  });
});
