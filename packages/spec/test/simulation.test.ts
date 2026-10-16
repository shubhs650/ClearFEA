// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import fixture from "../fixtures/simulation-v1.json";
import {
  checkSimulationSpec,
  elementOrder,
  emptySimulationSpec,
  type LocalMeshSize,
  localSizeParams,
  meshSettingsText,
  sameMeshSettings,
  type PressureLoad,
  type SimulationSpec,
  simulationSpecProblems,
  validateCreateSimulationRequest,
  validateSimulationSpec,
} from "../src";


/** The first item of a list, which the fixture always has. */
function first<T>(items: T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error("The fixture has no such item.");
  return item;
}

/** The fixture's first load, a pressure. */
function pressure(s: SimulationSpec): PressureLoad {
  const load = first(s.loads);
  if (load.type !== "pressure") throw new Error("The fixture's first load is not a pressure.");
  return load;
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
    expect(validateSimulationSpec({ ...spec(), solver: "pardiso" }).ok).toBe(false);
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
    s.loads[0] = { ...pressure(s), magnitude: { value: 10, unit: "mm" } };
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
    s.loads[0] = { ...pressure(s), magnitude: { value: -0.5, unit: "bar" } };
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

  it("names the item each problem belongs to", () => {
    const s = spec();
    s.materials[0] = { ...first(s.materials), youngsModulus: { value: 200, unit: "mm" } };
    s.supports[0] = { ...first(s.supports), faces: [99] };
    s.mesh.size = { value: 0, unit: "mm" };
    s.bodies.push({ tag: 7, material: null });
    expect(simulationSpecProblems(s, topology).map((p) => p.item)).toEqual([
      "steel",
      "mesh",
      "bodies",
      "fixed-1",
    ]);
  });

  it("accepts the M2.2 supports and refuses a component that is not a length", () => {
    const s = spec();
    s.supports.push(
      { id: "move-1", type: "displacement", name: "Pull", faces: [2], x: { value: 0.1, unit: "mm" }, y: "free", z: null },
      { id: "plane-1", type: "frictionless", name: "Symmetry", faces: [3] },
    );
    expect(validateSimulationSpec(s).ok).toBe(true);
    expect(checkSimulationSpec(s, topology)).toEqual([]);
    expect(validateSimulationSpec({ ...s, supports: [{ ...s.supports[1], y: "fixed" }] }).ok).toBe(false);
    s.supports[1] = { ...s.supports[1], y: { value: 1, unit: "MPa" } } as SimulationSpec["supports"][0];
    expect(checkSimulationSpec(s, topology)[0]).toMatch(/^The y component of support "Pull" is given in "MPa", which is not a length unit/);
  });

  it("accepts a temperature change and checks its units, one per setup (M2.7)", () => {
    const s = spec();
    const [steel] = s.materials;
    if (!steel) throw new Error("no material");
    s.materials = [{ ...steel, thermalExpansion: { value: 12, unit: "µm/(m·K)" } }];
    s.loads.push({ id: "heat-1", type: "temperature", name: "Warm-up", change: { value: 50, unit: "°C" } });
    expect(validateSimulationSpec(s).ok).toBe(true);
    expect(checkSimulationSpec(s, topology)).toEqual([]);
    s.materials = [{ ...steel, thermalExpansion: { value: 12, unit: "°C" } }];
    s.loads[1] = { id: "heat-1", type: "temperature", name: "Warm-up", change: { value: 50, unit: "1/°C" } };
    expect(checkSimulationSpec(s, topology)).toEqual([
      `The thermal expansion of material "${steel.name}" is given in "°C", which is not a thermal expansion unit. Use one of: 1/K, 1/°C, 1/°F, µm/(m·K), µin/(in·°F).`,
      'The temperature change of load "Warm-up" is given in "1/°C", which is not a temperature difference unit. Use one of: K, °C, °F.',
    ]);
    s.materials = [{ ...steel, thermalExpansion: { value: -1e-6, unit: "1/K" } }];
    s.loads[1] = { id: "heat-1", type: "temperature", name: "Warm-up", change: { value: -50, unit: "K" } };
    s.loads.push({ id: "heat-2", type: "temperature", name: "Again", change: null });
    expect(checkSimulationSpec(s, topology)).toEqual([
      'Load "Again" is a second temperature change. A setup can have one; delete the other.',
    ]);
  });

  it("accepts an elastic support and checks its stiffness (M2.6)", () => {
    const s = spec();
    s.supports.push({ id: "soil-1", type: "elastic", name: "Soil", faces: [3], stiffness: { value: 50, unit: "MN/m³" } });
    expect(validateSimulationSpec(s).ok).toBe(true);
    expect(checkSimulationSpec(s, topology)).toEqual([]);
    const { stiffness: _, ...noStiffness } = s.supports[1] as Extract<SimulationSpec["supports"][0], { type: "elastic" }>;
    expect(validateSimulationSpec({ ...s, supports: [noStiffness] }).ok).toBe(false);
    s.supports[1] = { ...s.supports[1], stiffness: { value: 50, unit: "MPa" } } as SimulationSpec["supports"][0];
    expect(checkSimulationSpec(s, topology)[0]).toMatch(
      /^The stiffness of support "Soil" is given in "MPa", which is not a foundation stiffness unit/,
    );
    s.supports[1] = { ...s.supports[1], stiffness: { value: 0, unit: "N/mm³" } } as SimulationSpec["supports"][0];
    expect(checkSimulationSpec(s, topology)).toEqual(['The stiffness of support "Soil" must be greater than zero; it is 0 N/mm³.']);
  });

  it("refuses a frictionless support on a face that is not flat", () => {
    const s = spec();
    s.supports.push({ id: "plane-1", type: "frictionless", name: "Symmetry", faces: [1, 2, 3] });
    const shaped = { ...topology, faces: [{ tag: 1, type: "plane" }, { tag: 2, type: "cylinder" }, { tag: 3, type: "other" }] };
    expect(simulationSpecProblems(s, shaped)).toEqual([
      {
        item: "plane-1",
        message:
          'Frictionless support "Symmetry" uses faces 2, 3, which are not flat. It holds flat faces only; use a fixed support or a prescribed displacement on curved faces.',
      },
    ]);
  });

  it("accepts the M2.3 loads and checks their units", () => {
    const s = spec();
    s.materials[0] = { ...first(s.materials), density: { value: 7.85, unit: "g/cm³" } };
    s.loads.push(
      { id: "force-1", type: "force", name: "Push", faces: [2], x: { value: 1, unit: "kN" }, y: null, z: { value: 0, unit: "lbf" } },
      { id: "gravity-1", type: "gravity", name: "Weight", x: null, y: null, z: { value: -1, unit: "g" } },
      {
        id: "spin-1",
        type: "centrifugal",
        name: "Spin",
        angularVelocity: { value: 3000, unit: "rpm" },
        axisPoint: { x: { value: 0, unit: "mm" }, y: null, z: { value: 1, unit: "in" } },
        axisDirection: { x: 0, y: null, z: 1 },
      },
    );
    expect(validateSimulationSpec(s).ok).toBe(true);
    expect(checkSimulationSpec(s, topology)).toEqual([]);
    // A gravity load has no faces.
    expect(validateSimulationSpec({ ...s, loads: [{ ...s.loads[2], faces: [1] }] }).ok).toBe(false);

    s.materials[0] = { ...first(s.materials), density: { value: 7.85, unit: "GPa" } };
    s.loads[1] = { id: "force-1", type: "force", name: "Push", faces: [2], x: { value: 1, unit: "MPa" }, y: null, z: null };
    s.loads[2] = { id: "gravity-1", type: "gravity", name: "Weight", x: { value: 1, unit: "rpm" }, y: null, z: null };
    expect(checkSimulationSpec(s, topology)).toEqual([
      expect.stringMatching(/^The density of material "Structural steel" is given in "GPa", which is not a density unit/),
      expect.stringMatching(/^The x component of load "Push" is given in "MPa", which is not a force unit/),
      expect.stringMatching(/^The x component of load "Weight" is given in "rpm", which is not an acceleration unit/),
    ]);
  });

  it("accepts a remote load and checks its units and faces (M2.4)", () => {
    const s = spec();
    s.loads.push({
      id: "remote-1",
      type: "remote",
      name: "Pipe",
      faces: [2],
      point: { x: { value: 1, unit: "in" }, y: null, z: { value: 0, unit: "mm" } },
      force: { x: { value: 1, unit: "kN" }, y: null, z: { value: 0, unit: "lbf" } },
      moment: { x: { value: 5, unit: "N·m" }, y: { value: 1, unit: "lbf·ft" }, z: null },
    });
    expect(validateSimulationSpec(s).ok).toBe(true);
    expect(checkSimulationSpec(s, topology)).toEqual([]);
    // A remote load needs all three parts.
    const { moment: _, ...noMoment } = s.loads[1] as Extract<SimulationSpec["loads"][0], { type: "remote" }>;
    expect(validateSimulationSpec({ ...s, loads: [noMoment] }).ok).toBe(false);

    s.loads[1] = {
      id: "remote-1",
      type: "remote",
      name: "Pipe",
      faces: [2, 99],
      point: { x: { value: 1, unit: "N" }, y: null, z: null },
      force: { x: { value: 1, unit: "N·m" }, y: null, z: null },
      moment: { x: { value: 1, unit: "N" }, y: null, z: null },
    };
    expect(checkSimulationSpec(s, topology)).toEqual([
      expect.stringMatching(/^The x coordinate of the reference point of load "Pipe" is given in "N", which is not a length unit/),
      expect.stringMatching(/^The x component of the force of load "Pipe" is given in "N·m", which is not a force unit/),
      expect.stringMatching(/^The x component of the moment of load "Pipe" is given in "N", which is not a moment unit/),
      'Load "Pipe" uses face 99, which the geometry does not have.',
    ]);
  });

  it("accepts a hydrostatic pressure and checks its units, faces and gravity (M2.5)", () => {
    const s = spec();
    s.loads.push({
      id: "hydrostatic-1",
      type: "hydrostatic",
      name: "Water",
      faces: [2],
      fluidDensity: { value: 62.4, unit: "lb/ft³" },
      gravity: { x: { value: 0, unit: "g" }, y: null, z: { value: -32.2, unit: "ft/s²" } },
      freeSurface: { x: { value: 1, unit: "in" }, y: null, z: { value: 0, unit: "mm" } },
    });
    expect(validateSimulationSpec(s).ok).toBe(true);
    expect(checkSimulationSpec(s, topology)).toEqual([]);
    const { freeSurface: _, ...noSurface } = s.loads[1] as Extract<SimulationSpec["loads"][0], { type: "hydrostatic" }>;
    expect(validateSimulationSpec({ ...s, loads: [noSurface] }).ok).toBe(false);

    s.loads[1] = {
      id: "hydrostatic-1",
      type: "hydrostatic",
      name: "Water",
      faces: [2, 99],
      fluidDensity: { value: 0, unit: "kg/m³" },
      gravity: { x: { value: 0, unit: "m" }, y: { value: 0, unit: "g" }, z: { value: 0, unit: "g" } },
      freeSurface: { x: { value: 1, unit: "N" }, y: null, z: null },
    };
    expect(checkSimulationSpec(s, topology)).toEqual([
      'The fluid density of load "Water" must be greater than zero; it is 0 kg/m³.',
      expect.stringMatching(/^The x component of the gravity of load "Water" is given in "m", which is not an acceleration unit/),
      expect.stringMatching(/^The x coordinate of the free-surface point of load "Water" is given in "N", which is not a length unit/),
      'The gravity of load "Water" is zero, so the fluid has no depth. Enter it, for example z = -1 g.',
      'Load "Water" uses face 99, which the geometry does not have.',
    ]);
  });

  it("refuses a zero axis, a second centrifugal load and a density of zero", () => {
    const s = spec();
    s.materials[0] = { ...first(s.materials), density: { value: 0, unit: "kg/m³" } };
    const spin = (id: string) => ({
      id,
      type: "centrifugal" as const,
      name: id,
      angularVelocity: { value: 100, unit: "rad/s" },
      axisPoint: { x: null, y: null, z: null },
      axisDirection: { x: 0, y: 0, z: 0 },
    });
    s.loads.push(spin("a"), { ...spin("b"), axisDirection: { x: 1, y: null, z: null } });
    expect(simulationSpecProblems(s, topology)).toEqual([
      { item: "steel", message: expect.stringMatching(/density of material "Structural steel" must be greater than zero/) },
      { item: "a", message: 'The axis direction of load "a" is zero. Give the axis a direction, for example z = 1.' },
      { item: "b", message: 'Load "b" is a second centrifugal load. A setup can have one; delete the other.' },
    ]);
  });

  it("accepts local mesh sizes and checks their units, repeated tags and tags against the geometry (M2.8)", () => {
    const s = spec();
    const local = (changes: Partial<LocalMeshSize>): LocalMeshSize => ({
      id: "local-1",
      name: "Hole",
      scope: "faces",
      tags: [2],
      size: { value: 0.5, unit: "mm" },
      ...changes,
    });
    s.mesh = { ...s.mesh, order: 1, local: [local({})] };
    expect(validateSimulationSpec(s).ok).toBe(true);
    expect(checkSimulationSpec(s, { ...topology, edges: [{ tag: 7 }] })).toEqual([]);
    s.mesh.local = [
      local({ size: { value: 0, unit: "mm" } }),
      local({ id: "local-2", name: "Edges", scope: "edges", tags: [7, 8, 7] }),
      local({ id: "local-3", name: "Body", scope: "bodies", tags: [2] }),
      local({ id: "steel", name: "Clash", size: { value: 1, unit: "N" } }),
    ];
    expect(simulationSpecProblems(s, { ...topology, edges: [{ tag: 7 }] })).toEqual([
      { item: "steel", message: 'The id "steel" of local mesh size "Clash" is used by another item; ids must be unique.' },
      { item: "local-1", message: 'The size of local mesh size "Hole" must be greater than zero; it is 0 mm.' },
      { item: "local-2", message: 'Local mesh size "Edges" lists edge 7 more than once.' },
      { item: "steel", message: expect.stringMatching(/^The size of local mesh size "Clash" is given in "N", which is not a length unit/) },
      { item: "local-2", message: 'Local mesh size "Edges" uses edge 8, which the geometry does not have.' },
      { item: "local-3", message: 'Local mesh size "Body" uses body 2, which the geometry does not have.' },
    ]);
  });

  it("asks for a new upload to size edges of a geometry imported before M2.8", () => {
    const s = spec();
    s.mesh.local = [{ id: "e", name: "Edge", scope: "edges", tags: [3], size: null }];
    expect(checkSimulationSpec(s, topology)).toEqual([
      'Local mesh size "Edge" uses edges, but this geometry was imported before edges could be picked. Upload the STEP file again to size its edges.',
    ]);
  });

  it("compares mesh settings by global size, order and complete local sizes (M2.8)", () => {
    const s = spec();
    const size = { value: 5, unit: "mm" };
    s.mesh = { size };
    expect(elementOrder(s)).toBe(2);
    expect(sameMeshSettings(s, { size, order: 2, local: [] })).toBe(true);
    expect(sameMeshSettings(s, { size, order: 1, local: [] })).toBe(false);
    expect(sameMeshSettings(s, { size: { value: 0.5, unit: "cm" }, order: 2, local: [] })).toBe(false);
    s.mesh.local = [
      { id: "a", name: "A", scope: "faces", tags: [3, 1], size: { value: 1, unit: "mm" } },
      // Incomplete local sizes do not take part in meshing.
      { id: "b", name: "B", scope: "edges", tags: [], size: { value: 1, unit: "mm" } },
      { id: "c", name: "C", scope: "bodies", tags: [1], size: null },
    ];
    const local = localSizeParams(s);
    expect(local).toEqual([{ scope: "faces", tags: [1, 3], size: { value: 1, unit: "mm" } }]);
    expect(sameMeshSettings(s, { size, order: 2, local })).toBe(true);
    expect(sameMeshSettings(s, { size, order: 2, local: [] })).toBe(false);
    expect(sameMeshSettings(s, { size, order: 2, local: [{ scope: "faces", tags: [1], size: { value: 1, unit: "mm" } }] })).toBe(
      false,
    );
  });
});

describe("mesh settings text (M2.10)", () => {
  const base = {
    geometryId: "g1",
    scaling: 0.001,
    size: { value: 4, unit: "mm" },
    order: 2 as const,
    local: [{ scope: "faces" as const, tags: [3, 1], size: { value: 1, unit: "mm" } }],
  };

  it("is the same for the same settings, whatever the key or tag order", () => {
    const shuffled = {
      local: [{ size: { unit: "mm", value: 1 }, tags: [1, 3], scope: "faces" as const }],
      order: 2 as const,
      size: { unit: "mm", value: 4 },
      scaling: 0.001,
      geometryId: "g1",
    };
    expect(meshSettingsText(shuffled)).toBe(meshSettingsText(base));
  });

  it("changes with the geometry, its scale and every mesh setting", () => {
    const text = meshSettingsText(base);
    for (const other of [
      { ...base, geometryId: "g2" },
      { ...base, scaling: 0.0254 },
      { ...base, size: { value: 4.5, unit: "mm" } },
      // A size typed in another unit is another mesh, as for sameMeshSettings.
      { ...base, size: { value: 0.4, unit: "cm" } },
      { ...base, order: 1 as const },
      { ...base, local: [] },
      { ...base, local: [{ ...base.local[0], scope: "edges" as const }] },
      { ...base, local: [{ ...base.local[0], tags: [1] }] },
      { ...base, local: [{ ...base.local[0], size: { value: 2, unit: "mm" } }] },
    ]) {
      expect(meshSettingsText(other as typeof base)).not.toBe(text);
    }
  });
});
