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
          "There is no load, so every result would be zero. Add a load under Loads, or give a prescribed displacement a value other than zero.",
      },
      { item: "mesh", message: "There is no global mesh size. Enter one under Mesh." },
    ]);
  });

  it("names bodies without a material", () => {
    const one = { ...spec(), bodies: [{ tag: 1, material: null }] };
    expect(preRunProblems(one, topology)).toEqual([
      { item: "bodies", message: "Body 1 has no material. Pick one for it under Bodies." },
    ]);
    const two = { ...spec(), bodies: [{ tag: 1, material: null }, { tag: 2, material: null }] };
    const twoBodies = { ...topology, bodies: [{ tag: 1 }, { tag: 2 }] };
    expect(preRunProblems(two, twoBodies).map((p) => p.message)).toEqual([
      "Bodies 1, 2 have no material. Pick one for each under Bodies.",
    ]);
    const named = { ...topology, bodies: [{ tag: 1, name: "Base plate" }, { tag: 2 }] };
    expect(preRunProblems(two, named).map((p) => p.message)).toEqual([
      'Bodies "Base plate", 2 have no material. Pick one for each under Bodies.',
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
      "There is no load, so every result would be zero. Add a load under Loads, or give a prescribed displacement a value other than zero.",
    ]);
  });

  it("asks a frictionless support for faces", () => {
    const s = spec();
    const plane = { id: "f-1", type: "frictionless", name: "Symmetry", faces: [] } as SimulationSpec["supports"][0];
    expect(messages({ ...s, supports: [...s.supports, plane] })).toEqual([
      `Support "Symmetry" has no faces. Select the faces it holds and add them to it.`,
    ]);
  });

  it("asks an elastic support for faces and a foundation stiffness (M2.6)", () => {
    const s = spec();
    const foundation = { id: "e-1", type: "elastic", name: "Soil", faces: [], stiffness: null } as SimulationSpec["supports"][0];
    expect(messages({ ...s, supports: [...s.supports, foundation] })).toEqual([
      `Support "Soil" has no faces. Select the faces it supports and add them to it.`,
      `Support "Soil" has no foundation stiffness. Enter it.`,
    ]);
  });

  it("asks the M2.3 loads for their values and every material for a density", () => {
    const s = spec();
    s.loads = [
      { id: "force-1", type: "force", name: "Push", faces: [], x: null, y: { value: 0, unit: "N" }, z: null },
      { id: "gravity-1", type: "gravity", name: "Weight", x: null, y: null, z: { value: -1, unit: "g" } },
      {
        id: "spin-1",
        type: "centrifugal",
        name: "Spin",
        angularVelocity: null,
        axisPoint: { x: null, y: { value: 0, unit: "mm" }, z: { value: 0, unit: "mm" } },
        axisDirection: { x: 0, y: 0, z: null },
      },
    ];
    expect(preRunProblems(s, topology)).toEqual([
      {
        item: "steel",
        message: 'Material "Structural steel" has no density, which gravity and centrifugal loads need. Enter it.',
      },
      { item: "force-1", message: 'Load "Push" has no faces. Select the faces it acts on and add them to it.' },
      { item: "force-1", message: 'Load "Push" has no value for its x component. Enter one (0 for none).' },
      { item: "force-1", message: 'Load "Push" has no value for its z component. Enter one (0 for none).' },
      { item: "gravity-1", message: 'Load "Weight" has no value for its x component. Enter one (0 for none).' },
      { item: "gravity-1", message: 'Load "Weight" has no value for its y component. Enter one (0 for none).' },
      { item: "spin-1", message: 'Load "Spin" has no angular velocity. Enter it.' },
      { item: "spin-1", message: 'Load "Spin" has no complete point on its axis. Enter x, y and z.' },
      { item: "spin-1", message: 'Load "Spin" has no complete axis direction. Enter x, y and z.' },
    ]);
  });

  it("asks a temperature change for its value and every material for a thermal expansion (M2.7)", () => {
    const s = spec();
    s.loads = [{ id: "heat-1", type: "temperature", name: "Warm-up", change: null }];
    expect(preRunProblems(s, topology)).toEqual([
      {
        item: "steel",
        message: 'Material "Structural steel" has no thermal expansion, which a temperature change needs. Enter it.',
      },
      { item: "heat-1", message: 'Load "Warm-up" has no temperature change. Enter it (negative for cooling).' },
    ]);
    const [steel] = s.materials;
    if (!steel) throw new Error("no material");
    s.materials = [{ ...steel, thermalExpansion: { value: 6.5, unit: "µin/(in·°F)" } }];
    s.loads = [{ id: "heat-1", type: "temperature", name: "Warm-up", change: { value: -40, unit: "°F" } }];
    expect(preRunProblems(s, topology)).toEqual([]);
  });

  it("asks a remote load for faces, a reference point, a force and a moment (M2.4)", () => {
    const s = spec();
    const mm = (value: number) => ({ value, unit: "mm" });
    const remote = {
      id: "remote-1",
      type: "remote",
      name: "Pipe",
      faces: [],
      point: { x: mm(0), y: null, z: mm(0) },
      force: { x: null, y: null, z: null },
      moment: { x: null, y: { value: 0, unit: "N·m" }, z: null },
    } as SimulationSpec["loads"][0];
    expect(preRunProblems({ ...s, loads: [remote] }, topology)).toEqual([
      { item: "remote-1", message: 'Load "Pipe" has no faces. Select the faces it acts on and add them to it.' },
      { item: "remote-1", message: 'Load "Pipe" has no complete reference point. Enter x, y and z.' },
      { item: "remote-1", message: 'Load "Pipe" has no complete force. Enter x, y and z (0 for none).' },
      { item: "remote-1", message: 'Load "Pipe" has no complete moment. Enter x, y and z (0 for none).' },
    ]);
    const n = (value: number) => ({ value, unit: "N" });
    const nm = (value: number) => ({ value, unit: "N·m" });
    const complete = {
      ...remote,
      faces: [2],
      point: { x: mm(0), y: mm(5), z: mm(0) },
      force: { x: n(1), y: n(0), z: n(0) },
      moment: { x: nm(0), y: nm(0), z: nm(2) },
    } as SimulationSpec["loads"][0];
    expect(preRunProblems({ ...s, loads: [complete] }, topology)).toEqual([]);
  });

  it("asks a hydrostatic pressure for faces, a fluid density, gravity and a free-surface point (M2.5)", () => {
    const s = spec();
    const mm = (value: number) => ({ value, unit: "mm" });
    const water = {
      id: "hydrostatic-1",
      type: "hydrostatic",
      name: "Water",
      faces: [],
      fluidDensity: null,
      gravity: { x: null, y: { value: 0, unit: "g" }, z: null },
      freeSurface: { x: mm(0), y: null, z: mm(0) },
    } as SimulationSpec["loads"][0];
    expect(preRunProblems({ ...s, loads: [water] }, topology)).toEqual([
      { item: "hydrostatic-1", message: 'Load "Water" has no faces. Select the faces it acts on and add them to it.' },
      { item: "hydrostatic-1", message: 'Load "Water" has no fluid density. Enter it.' },
      { item: "hydrostatic-1", message: 'Load "Water" has no complete gravity. Enter x, y and z (0 for none).' },
      { item: "hydrostatic-1", message: 'Load "Water" has no complete point on the free surface. Enter x, y and z.' },
    ]);
    const g = (value: number) => ({ value, unit: "g" });
    const complete = {
      ...water,
      faces: [2],
      fluidDensity: { value: 1000, unit: "kg/m³" },
      gravity: { x: g(0), y: g(0), z: g(-1) },
      freeSurface: { x: mm(0), y: mm(0), z: mm(500) },
    } as SimulationSpec["loads"][0];
    // Water presses on the faces only: the material needs no density.
    expect(preRunProblems({ ...s, loads: [complete] }, topology)).toEqual([]);
  });

  it("runs gravity alone once the material has a density", () => {
    const s = spec();
    s.materials[0] = { ...s.materials[0], density: { value: 0.284, unit: "lb/in³" } } as SimulationSpec["materials"][0];
    s.loads = [{ id: "g", type: "gravity", name: "Weight", x: { value: 0, unit: "g" }, y: { value: 0, unit: "g" }, z: { value: -1, unit: "g" } }];
    expect(preRunProblems(s, topology)).toEqual([]);
  });

  it("asks for the tags and size of each local mesh size (M2.8)", () => {
    const s = spec();
    s.mesh.local = [{ id: "local-1", name: "Hole", scope: "faces", tags: [], size: null }];
    expect(preRunProblems(s, topology)).toEqual([
      {
        item: "local-1",
        message: 'Local mesh size "Hole" has no faces. Select the faces to refine and add them to it, or delete it.',
      },
      { item: "local-1", message: 'Local mesh size "Hole" has no size. Enter it.' },
    ]);
  });
});
