// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import fixture from "../fixtures/simulation-v1.json";
import { emptySimulationSpec, preRunProblems, type SimulationSpec, validateSimulationSpec } from "../src";

const topology = {
  bodies: [{ tag: 1 }],
  faces: [{ tag: 1 }, { tag: 2 }, { tag: 3 }],
};

function spec(): SimulationSpec {
  const checked = validateSimulationSpec(JSON.parse(JSON.stringify(fixture)));
  if (!checked.ok) throw new Error(checked.errors.join(" "));
  return checked.value;
}

function messages(s: SimulationSpec): string[] {
  return preRunProblems(s, topology).map((p) => p.message);
}

describe("pre-run validation", () => {
  it("finds nothing to fix in the complete shared fixture", () => {
    expect(preRunProblems(spec(), topology)).toEqual([]);
  });

  it("lists everything an empty setup still needs, in the order of the setup tree", () => {
    expect(preRunProblems(emptySimulationSpec("g1", topology), topology)).toEqual([
      { item: "materials", message: "There is no material. Add a material under Materials." },
      {
        item: "supports",
        message: "There is no support, so the part is free to move. Add a support under Supports.",
      },
      {
        item: "loads",
        message:
          "There is no load, so every result would be zero. Add a pressure under Loads, or give a prescribed displacement a value other than zero.",
      },
      { item: "mesh", message: "There is no global mesh size. Enter one under Mesh." },
    ]);
  });

  it("names bodies without a material", () => {
    const one = { ...spec(), bodies: [{ tag: 1, material: null }] };
    expect(preRunProblems(one, topology)).toEqual([
      { item: "bodies", message: "Body 1 has no material. Assign one under Materials." },
    ]);
    const two = { ...spec(), bodies: [{ tag: 1, material: null }, { tag: 2, material: null }] };
    const twoBodies = { ...topology, bodies: [{ tag: 1 }, { tag: 2 }] };
    expect(preRunProblems(two, twoBodies).map((p) => p.message)).toEqual([
      "Bodies 1, 2 have no material. Assign one under Materials.",
    ]);
  });

  it("names the material, support or load that misses a value or faces", () => {
    const s = spec();
    const material = { ...s.materials[0], youngsModulus: null, poissonsRatio: null } as SimulationSpec["materials"][0];
    const support = { ...s.supports[0], faces: [] } as SimulationSpec["supports"][0];
    const load = { ...s.loads[0], faces: [], magnitude: null } as SimulationSpec["loads"][0];
    expect(preRunProblems({ ...s, materials: [material], supports: [support], loads: [load] }, topology)).toEqual([
      { item: "steel", message: `Material "Structural steel" has no Young's modulus. Enter it.` },
      { item: "steel", message: `Material "Structural steel" has no Poisson's ratio. Enter it.` },
      {
        item: "fixed-1",
        message: `Support "Fixed support 1" has no faces. Select the faces to fix and add them to it.`,
      },
      {
        item: "pressure-1",
        message: `Load "Pressure 1" has no faces. Select the faces it acts on and add them to it.`,
      },
      { item: "pressure-1", message: `Load "Pressure 1" has no pressure value. Enter it.` },
    ]);
  });

  it("puts what makes the spec wrong first, with the item it belongs to", () => {
    const s = spec();
    const support = { ...s.supports[0], faces: [9] } as SimulationSpec["supports"][0];
    const problems = preRunProblems({ ...s, supports: [support], mesh: { size: null } }, topology);
    expect(problems[0]).toEqual({
      item: "fixed-1",
      message: `Support "Fixed support 1" uses face 9, which the geometry does not have.`,
    });
    expect(problems.map((p) => p.item)).toEqual(["fixed-1", "mesh"]);
  });

  it("checks face tags only when the topology is given", () => {
    const s = spec();
    const support = { ...s.supports[0], faces: [9] } as SimulationSpec["supports"][0];
    expect(preRunProblems({ ...s, supports: [support] })).toEqual([]);
  });

  it("never states a verdict, only what to do", () => {
    for (const message of messages(emptySimulationSpec("g1", topology))) {
      expect(message).not.toMatch(/pass|fail|complian/i);
    }
  });

  it("asks a prescribed displacement for every component and at least one value", () => {
    const s = spec();
    const move = {
      id: "move-1",
      type: "displacement",
      name: "Pull",
      faces: [2],
      x: null,
      y: "free",
      z: "free",
    } as SimulationSpec["supports"][0];
    expect(messages({ ...s, supports: [...s.supports, move] })).toEqual([
      `Support "Pull" has no value for its x component. Enter one or set it free.`,
    ]);
    const loose = { ...move, x: "free" } as SimulationSpec["supports"][0];
    expect(messages({ ...s, supports: [...s.supports, loose] })).toEqual([
      `Support "Pull" leaves every component free, so it holds nothing. Give at least one component a value (0 holds the faces in that direction).`,
    ]);
    const noFaces = { ...move, faces: [], x: { value: 0, unit: "mm" } } as SimulationSpec["supports"][0];
    expect(messages({ ...s, supports: [noFaces] })).toEqual([
      `Support "Pull" has no faces. Select the faces to move and add them to it.`,
    ]);
  });

  it("needs no load when a prescribed displacement moves the part", () => {
    const s = spec();
    const move = (value: number) =>
      ({
        id: "move-1",
        type: "displacement",
        name: "Pull",
        faces: [2],
        x: { value, unit: "mm" },
        y: "free",
        z: "free",
      }) as SimulationSpec["supports"][0];
    expect(messages({ ...s, supports: [...s.supports, move(0.1)], loads: [] })).toEqual([]);
    expect(messages({ ...s, supports: [...s.supports, move(0)], loads: [] })).toEqual([
      "There is no load, so every result would be zero. Add a pressure under Loads, or give a prescribed displacement a value other than zero.",
    ]);
  });

  it("asks a frictionless support for faces", () => {
    const s = spec();
    const plane = { id: "f-1", type: "frictionless", name: "Symmetry", faces: [] } as SimulationSpec["supports"][0];
    expect(messages({ ...s, supports: [...s.supports, plane] })).toEqual([
      `Support "Symmetry" has no faces. Select the faces it holds and add them to it.`,
    ]);
  });
});
