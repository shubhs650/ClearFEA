// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import fixture from "../fixtures/simulation-v1.json";
import {
  checkSimulationSpec,
  emptySimulationSpec,
  type SimulationSpec,
  validateCreateSimulationRequest,
  validateSimulationSpec,
} from "../src";


/** The first item of a list, which the fixture always has. */
function first<T>(items: T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error("The fixture has no such item.");
  return item;
}

const topology = {
  bodies: [{ tag: 1 }],
  faces: [{ tag: 1 }, { tag: 2 }, { tag: 3 }],
};

function spec(): SimulationSpec {
  const checked = validateSimulationSpec(JSON.parse(JSON.stringify(fixture)));
  if (!checked.ok) throw new Error(checked.errors.join(" "));
  return checked.value;
}

describe("SimulationSpec schema", () => {
  it("accepts the shared fixture", () => {
    expect(validateSimulationSpec(fixture).ok).toBe(true);
  });

  it("accepts an empty spec, so a setup can be saved while it is built", () => {
    const empty = emptySimulationSpec("g1", topology);
    expect(empty.bodies).toEqual([{ tag: 1, material: null }]);
    expect(validateSimulationSpec(empty).ok).toBe(true);
    expect(checkSimulationSpec(empty, topology)).toEqual([]);
  });

  it("refuses an unknown version, field or item type", () => {
    expect(validateSimulationSpec({ ...spec(), version: 2 }).ok).toBe(false);
    expect(validateSimulationSpec({ ...spec(), solver: "pastix" }).ok).toBe(false);
    const load = { ...spec().loads[0], type: "force" };
    expect(validateSimulationSpec({ ...spec(), loads: [load] }).ok).toBe(false);
  });

  it("refuses a Poisson's ratio outside (-1, 0.5)", () => {
    for (const nu of [0.5, -1, 0.7]) {
      const material = { ...spec().materials[0], poissonsRatio: nu };
      expect(validateSimulationSpec({ ...spec(), materials: [material] }).ok).toBe(false);
    }
  });

  it("refuses a face listed twice in one item", () => {
    const support = { ...spec().supports[0], faces: [1, 1] };
    expect(validateSimulationSpec({ ...spec(), supports: [support] }).ok).toBe(false);
  });

  it("lets a create request leave the spec out", () => {
    expect(validateCreateSimulationRequest({ geometryId: "g1", name: "Static 1" }).ok).toBe(true);
  });
});

describe("checkSimulationSpec", () => {
  it("passes the shared fixture against its topology", () => {
    expect(checkSimulationSpec(spec(), topology)).toEqual([]);
  });

  it("refuses a unit of the wrong kind and names the allowed ones", () => {
    const s = spec();
    s.loads[0] = { ...first(s.loads), magnitude: { value: 10, unit: "mm" } };
    const [problem] = checkSimulationSpec(s);
    expect(problem).toMatch(/"mm", which is not a pressure unit/);
    expect(problem).toMatch(/MPa/);
  });

  it("refuses units it does not know and is case-sensitive", () => {
    const s = spec();
    s.mesh.size = { value: 5, unit: "MM" };
    expect(checkSimulationSpec(s)).toEqual([expect.stringMatching(/not a length unit/)]);
  });

  it("refuses a zero or negative modulus or mesh size, but allows suction", () => {
    const s = spec();
    s.materials[0] = { ...first(s.materials), youngsModulus: { value: 0, unit: "GPa" } };
    s.mesh.size = { value: -1, unit: "mm" };
    s.loads[0] = { ...first(s.loads), magnitude: { value: -0.5, unit: "bar" } };
    expect(checkSimulationSpec(s)).toEqual([
      expect.stringMatching(/Young's modulus .* greater than zero/),
      expect.stringMatching(/mesh size must be greater than zero/),
    ]);
  });

  it("refuses duplicate ids and a missing material", () => {
    const s = spec();
    s.loads[0] = { ...first(s.loads), id: "steel" };
    s.bodies[0] = { tag: 1, material: "aluminium" };
    expect(checkSimulationSpec(s)).toEqual([
      expect.stringMatching(/id "steel" .* unique/),
      expect.stringMatching(/material "aluminium", which is not in/),
    ]);
  });

  it("checks bodies and faces against the geometry", () => {
    const s = spec();
    s.bodies = [{ tag: 1, material: null }, { tag: 1, material: null }, { tag: 7, material: null }];
    s.supports[0] = { ...first(s.supports), faces: [1, 99] };
    expect(checkSimulationSpec(s, topology)).toEqual([
      "Body 1 is listed more than once.",
      "The geometry has no body 7.",
      'Support "Fixed support 1" uses face 99, which the geometry does not have.',
    ]);
    s.bodies = [];
    expect(checkSimulationSpec(s, topology)).toContain("Body 1 of the geometry is not listed in bodies.");
  });
});
