// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import fixture from "../fixtures/simulation-v1.json";
import { emptySimulationSpec, preRunProblems, type SimulationSpec, unheldBodies, validateSimulationSpec } from "../src";

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

describe("bodies no support holds (M4.4)", () => {
  // Three bodies: a shell (faces 1-2), a nozzle (3-4) bonded to it, and a pad (5-6) bonded to the
  // nozzle; body 4 (face 7) touches nothing.
  const assembly = {
    bodies: [{ tag: 1, name: "Shell" }, { tag: 2, name: "Nozzle" }, { tag: 3, name: "Pad" }, { tag: 4 }],
    faces: [
      { tag: 1, bodies: [1] },
      { tag: 2, bodies: [1] },
      { tag: 3, bodies: [2] },
      { tag: 4, bodies: [2] },
      { tag: 5, bodies: [3] },
      { tag: 6, bodies: [3] },
      { tag: 7, bodies: [4] },
    ],
    bonds: [
      { faces: [2, 3] as [number, number], bodies: [1, 2] as [number, number] },
      { faces: [4, 5] as [number, number], bodies: [2, 3] as [number, number] },
    ],
  };

  type Status = "accepted" | "removed";

  function assemblySpec(bonds: [Status, Status], supportFaces: number[] = [1]): SimulationSpec {
    const s = spec();
    const [material] = s.materials;
    const [support] = s.supports;
    const [load] = s.loads;
    if (!material || !support || !load) throw new Error("incomplete fixture");
    return {
      ...s,
      bodies: [1, 2, 3, 4].map((tag) => ({ tag, material: material.id })),
      supports: [{ ...support, faces: supportFaces }],
      loads: [{ ...load, faces: [6] }] as SimulationSpec["loads"],
      bonds: [
        { faces: [2, 3], status: bonds[0] },
        { faces: [4, 5], status: bonds[1] },
      ],
    };
  }

  it("names a body that touches nothing and has no support", () => {
    expect(unheldBodies(assemblySpec(["accepted", "accepted"]), assembly)).toEqual([[4]]);
    expect(preRunProblems(assemblySpec(["accepted", "accepted"]), assembly)).toEqual([
      {
        item: "bodies",
        message: "Body 4 is not bonded to a held body and no support holds it, so it is free to move. Add a support on one of its faces.",
      },
    ]);
    expect(preRunProblems(assemblySpec(["accepted", "accepted"], [1, 7]), assembly)).toEqual([]);
  });

  it("follows bonds through bodies that hold each other, and stops at removed ones", () => {
    expect(unheldBodies(assemblySpec(["accepted", "removed"], [1, 7]), assembly)).toEqual([[3]]);
    expect(assemblyMessages(assemblySpec(["accepted", "removed"], [1, 7]))).toEqual([
      'Body "Pad" is not bonded to a held body and no support holds it, so it is free to move. Add a support on one of its faces, or restore a removed bond under Bonds that joins it to a held body.',
    ]);
    expect(unheldBodies(assemblySpec(["removed", "accepted"], [1, 7]), assembly)).toEqual([[2, 3]]);
    expect(assemblyMessages(assemblySpec(["removed", "accepted"], [1, 7]))).toEqual([
      'Bodies "Nozzle" and "Pad" are bonded only to each other and no support holds them, so they are free to move. Add a support on a face of one of them, or restore a removed bond under Bonds that joins them to a held body.',
    ]);
    // A support on the pad holds the nozzle through their bond.
    expect(unheldBodies(assemblySpec(["removed", "accepted"], [1, 5, 7]), assembly)).toEqual([]);
  });

  it("counts a bond still to be reviewed as tied", () => {
    const { bonds: _, ...older } = assemblySpec(["accepted", "accepted"], [1, 7]);
    expect(unheldBodies(older, assembly)).toEqual([]);
  });

  it("says nothing for one body, before any support has faces, or without each face's body", () => {
    expect(unheldBodies(spec(), topology)).toEqual([]);
    expect(unheldBodies(assemblySpec(["removed", "removed"], []), assembly)).toEqual([]);
    const older = { ...assembly, faces: assembly.faces.map(({ tag }) => ({ tag })) };
    expect(unheldBodies(assemblySpec(["removed", "removed"]), older)).toEqual([]);
  });

  function assemblyMessages(s: SimulationSpec): string[] {
    return preRunProblems(s, assembly).map((p) => p.message);
  }
});

describe("pre-run validation of a steady-state thermal analysis (M5.1)", () => {
  function thermal(): SimulationSpec {
    const s = spec();
    const [steel] = s.materials;
    if (!steel) throw new Error("no material");
    return {
      ...s,
      analysis: "steady_thermal",
      supports: [],
      materials: [{ ...steel, thermalConductivity: { value: 45, unit: "W/(m·K)" } }],
      loads: [
        { id: "hot", type: "fixed_temperature", name: "Hot", faces: [1], temperature: { value: 100, unit: "°C" } },
      ],
    };
  }

  it("finds nothing to fix in a complete thermal setup, which needs no support or elastic values", () => {
    const s = thermal();
    const [steel] = s.materials;
    if (!steel) throw new Error("no material");
    expect(preRunProblems({ ...s, materials: [{ ...steel, youngsModulus: null, poissonsRatio: null }] }, topology)).toEqual([]);
  });

  it("asks for a conductivity, a fixed temperature and its faces and value", () => {
    const s = thermal();
    const [steel] = s.materials;
    if (!steel) throw new Error("no material");
    expect(preRunProblems({ ...s, materials: [{ ...steel, thermalConductivity: null }], loads: [] }, topology)).toEqual([
      {
        item: "steel",
        message: 'Material "Structural steel" has no thermal conductivity, which a thermal analysis needs. Enter it.',
      },
      {
        item: "loads",
        message:
          "There is no fixed temperature, convection or radiation, so the temperatures are not set anywhere. Add one under Loads.",
      },
    ]);
    expect(
      messages({
        ...s,
        loads: [{ id: "hot", type: "fixed_temperature", name: "Hot", faces: [], temperature: null }],
      }),
    ).toEqual([
      'Load "Hot" has no faces. Select the faces it holds and add them to it.',
      'Load "Hot" has no temperature. Enter it.',
    ]);
  });

  it("flags supports and structural loads in a thermal analysis, and a fixed temperature in a static one", () => {
    const s = thermal();
    const fixture = spec();
    expect(preRunProblems({ ...s, supports: fixture.supports, loads: [...s.loads, ...fixture.loads] }, topology)).toEqual([
      {
        item: "fixed-1",
        message:
          'Fixed support "Fixed support 1" has no effect in a steady-state thermal analysis. Delete it, or set the analysis type to linear static.',
      },
      {
        item: "pressure-1",
        message:
          'Pressure "Pressure 1" has no effect in a steady-state thermal analysis. Delete it, or set the analysis type to linear static.',
      },
    ]);
    expect(preRunProblems({ ...fixture, loads: [...fixture.loads, ...s.loads] }, topology)).toEqual([
      {
        item: "hot",
        message: 'Fixed temperature "Hot" has no effect in a linear static analysis. Delete it, or set the analysis type to steady-state thermal.',
      },
    ]);
  });

  it("refuses bonded bodies and asks for a fixed temperature on every body", () => {
    const assembly = {
      bodies: [{ tag: 1, name: "Base" }, { tag: 2, name: "Lug" }],
      faces: [
        { tag: 1, bodies: [1] },
        { tag: 2, bodies: [1] },
        { tag: 3, bodies: [2] },
      ],
      bonds: [{ faces: [2, 3] as [number, number], bodies: [1, 2] as [number, number] }],
    };
    const s = { ...thermal(), bodies: [{ tag: 1, material: "steel" }, { tag: 2, material: "steel" }] };
    expect(preRunProblems(s, assembly).map((p) => p.message)).toEqual([
      "Bonds do not carry heat in a steady-state thermal analysis yet, so bonded bodies cannot be run. Remove the bonds under Bonds to run each body on its own.",
      'Body "Lug" has no fixed temperature, convection or radiation, so its temperature is not set. Add one on one of its faces.',
    ]);
    const apart = { ...s, bonds: [{ faces: [2, 3] as [number, number], status: "removed" as const }] };
    const both = { ...apart, loads: [...apart.loads, { ...(apart.loads[0] as SimulationSpec["loads"][0]), id: "lug", faces: [3] }] };
    expect(preRunProblems(both, assembly)).toEqual([]);
  });

  it("asks each M5.2 load for its values, faces and bodies (M5.2)", () => {
    const s = thermal();
    expect(
      messages({
        ...s,
        loads: [
          ...s.loads,
          { id: "q", type: "heat_flux", name: "Q", faces: [], flux: null },
          { id: "h", type: "convection", name: "H", faces: [2], coefficient: null, ambientTemperature: null },
          { id: "r", type: "radiation", name: "R", faces: [3], emissivity: null, ambientTemperature: null },
          { id: "g", type: "heat_generation", name: "G", bodies: [], power: null },
        ],
      }),
    ).toEqual([
      'Load "Q" has no faces. Select the faces it acts on and add them to it.',
      'Load "Q" has no heat flux. Enter it.',
      'Load "H" has no convection coefficient. Enter it.',
      'Load "H" has no ambient temperature. Enter it.',
      'Load "R" has no emissivity. Enter it.',
      'Load "R" has no ambient temperature. Enter it.',
      'Load "G" has no bodies. Pick the bodies that produce the heat.',
      'Load "G" has no heat generation. Enter it.',
    ]);
  });

  it("lets convection or radiation set the temperature without a fixed temperature (M5.2)", () => {
    const s = thermal();
    const air = { value: 20, unit: "°C" };
    const loads: SimulationSpec["loads"] = [
      { id: "q", type: "heat_flux", name: "Q", faces: [1], flux: { value: 2, unit: "kW/m²" } },
      { id: "h", type: "convection", name: "H", faces: [2], coefficient: { value: 10, unit: "W/(m²·K)" }, ambientTemperature: air },
    ];
    expect(preRunProblems({ ...s, loads }, topology)).toEqual([]);
    expect(preRunProblems({ ...s, loads: loads.slice(0, 1) }, topology).map((p) => p.item)).toEqual(["loads"]);
  });

  it("refuses a heat load on a fixed face and a second convection or radiation on a face (M5.2)", () => {
    const s = thermal();
    const air = { value: 20, unit: "°C" };
    const h = { type: "convection" as const, faces: [1, 2], coefficient: { value: 10, unit: "W/(m²·K)" }, ambientTemperature: air };
    const r = { type: "radiation" as const, faces: [2], emissivity: 0.5, ambientTemperature: air };
    expect(
      preRunProblems(
        {
          ...s,
          loads: [
            ...s.loads,
            { id: "h1", name: "Air", ...h },
            { id: "h2", name: "Wind", ...h, faces: [2] },
            { id: "r1", name: "Sky", ...r },
            { id: "r2", name: "Sun", ...r },
            { id: "q", type: "heat_flux", name: "Q", faces: [2], flux: { value: 1, unit: "W/m²" } },
            { id: "q2", type: "heat_flux", name: "Q2", faces: [2], flux: { value: 1, unit: "W/m²" } },
          ],
        },
        topology,
      ),
    ).toEqual([
      {
        item: "h1",
        message: 'Convection "Air" acts on face 1, which fixed temperature "Hot" holds, so it would have no effect. Remove the face from one of them.',
      },
      {
        item: "h2",
        message: 'Convection "Air" and "Wind" both act on face 2. Give each face one convection; combine them into one if both are meant.',
      },
      {
        item: "r2",
        message: 'Radiation "Sky" and "Sun" both act on face 2. Give each face one radiation; combine them into one if both are meant.',
      },
    ]);
  });

  it("checks the units and the bodies of the M5.2 loads (M5.2)", () => {
    const s = thermal();
    const air = { value: 20, unit: "°C" };
    expect(
      messages({
        ...s,
        loads: [
          ...s.loads,
          { id: "q", type: "heat_flux", name: "Q", faces: [2], flux: { value: 1, unit: "W/(m²·K)" } },
          { id: "h", type: "convection", name: "H", faces: [2], coefficient: { value: 0, unit: "W/(m²·K)" }, ambientTemperature: air },
          { id: "g", type: "heat_generation", name: "G", bodies: [1, 9], power: { value: 1, unit: "W/m³" } },
        ],
      }),
    ).toEqual([
      'The heat flux of load "Q" is given in "W/(m²·K)", which is not a heat flux unit. Use one of: W/m², kW/m², W/mm², BTU/(h·ft²).',
      'The coefficient of load "H" must be greater than zero; it is 0 W/(m²·K).',
      'Load "G" uses body 9, which the geometry does not have.',
    ]);
  });
});
