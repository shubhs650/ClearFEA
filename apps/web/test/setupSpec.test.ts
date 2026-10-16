// SPDX-License-Identifier: AGPL-3.0-or-later
import { emptySimulationSpec, type Load, type MeshView, preRunProblems, type RunView, type SimulationSpec } from "@clearfea/spec";
import { describe, expect, it } from "vitest";
import {
  addFixedSupport,
  addLoad,
  addLocalSize,
  addMaterial,
  addPressure,
  addSupport,
  assignMaterial,
  bodyItem,
  facesOf,
  meshIsCurrent,
  meshStatus,
  runStatus,
  removeItem,
  sameSpec,
  setBondStatus,
  setupStatus,
  updateLoad,
  updateLocalSize,
  updateMaterial,
  updateSupport,
} from "../src/setup/spec";

const topology = { bodies: [{ tag: 1 }], faces: [{ tag: 1 }, { tag: 2 }, { tag: 3 }] };

function empty(): SimulationSpec {
  return emptySimulationSpec("g1", topology);
}

/** A spec with every item complete. */
function complete(): SimulationSpec {
  let spec = addMaterial(empty()).spec;
  const [material] = spec.materials;
  if (!material) throw new Error("no material");
  spec = updateMaterial(spec, { ...material, youngsModulus: { value: 200, unit: "GPa" }, poissonsRatio: 0.3 });
  spec = addFixedSupport(spec, [1]).spec;
  spec = addPressure(spec, [2, 3]).spec;
  const [load] = spec.loads;
  if (load?.type !== "pressure") throw new Error("no pressure");
  return updateLoad(spec, { ...load, magnitude: { value: 1, unit: "MPa" } });
}

/**
 * M2.3: a force, gravity and a centrifugal load; M2.4: a remote load; M2.5: a hydrostatic pressure;
 * M2.7: a temperature change; each incomplete and complete.
 */
function loadCases(full: SimulationSpec): SimulationSpec[] {
  const n = (value: number) => ({ value, unit: "N" });
  const g = (value: number) => ({ value, unit: "g" });
  const mm = (value: number) => ({ value, unit: "mm" });
  const [material] = full.materials;
  if (!material) throw new Error("no material");
  const dense = { ...full, materials: [{ ...material, density: { value: 7850, unit: "kg/m³" } }] };
  const force = addLoad(full, "force", [2]).spec;
  const gravity = addLoad(full, "gravity", [2]).spec;
  const spin = addLoad(dense, "centrifugal", []).spec;
  const remote = addLoad(full, "remote", [2]).spec;
  const nm = (value: number) => ({ value, unit: "N·m" });
  const water = addLoad(full, "hydrostatic", [2]).spec;
  const expanding = { ...full, materials: [{ ...material, thermalExpansion: { value: 12e-6, unit: "1/°C" } }] };
  const heat = addLoad(full, "temperature", [2]).spec;
  const warm = { change: { value: 50, unit: "°C" } };
  const fluid = {
    fluidDensity: { value: 1, unit: "g/cm³" },
    gravity: { x: g(0), y: g(0), z: g(-1) },
    freeSurface: { x: mm(0), y: mm(0), z: mm(80) },
  };
  const last = (spec: SimulationSpec) => spec.loads.at(-1) as Load;
  const set = (spec: SimulationSpec, changes: object) => updateLoad(spec, { ...last(spec), ...changes } as Load);
  return [
    force,
    set(force, { x: n(1), y: n(0), z: n(0) }),
    set(force, { x: n(1), y: n(0), z: n(0), faces: [] }),
    gravity,
    set(gravity, { x: g(0), y: g(0), z: g(-1) }),
    { ...set(gravity, { x: g(0), y: g(0), z: g(-1) }), materials: dense.materials },
    spin,
    set(spin, { angularVelocity: { value: 10, unit: "rpm" }, axisPoint: { x: mm(0), y: mm(0), z: mm(0) } }),
    set(spin, {
      angularVelocity: { value: 10, unit: "rpm" },
      axisPoint: { x: mm(0), y: mm(0), z: mm(0) },
      axisDirection: { x: 0, y: 0, z: 1 },
    }),
    remote,
    set(remote, { point: { x: mm(0), y: mm(0), z: mm(50) }, force: { x: n(1), y: n(0), z: n(0) } }),
    set(remote, {
      point: { x: mm(0), y: mm(0), z: mm(50) },
      force: { x: n(1), y: n(0), z: n(0) },
      moment: { x: nm(0), y: nm(0), z: nm(3) },
    }),
    set(remote, {
      point: { x: mm(0), y: mm(0), z: mm(50) },
      force: { x: n(1), y: n(0), z: n(0) },
      moment: { x: nm(0), y: nm(0), z: nm(3) },
      faces: [],
    }),
    water,
    set(water, { ...fluid, fluidDensity: null }),
    set(water, fluid),
    set(water, { ...fluid, gravity: { x: g(0), y: g(0), z: g(0) } }),
    set(water, { ...fluid, faces: [] }),
    heat,
    set(heat, warm),
    { ...set(heat, warm), materials: expanding.materials },
    { ...set(heat, { change: { value: 50, unit: "1/°C" } }), materials: expanding.materials },
    addLoad({ ...set(heat, warm), materials: expanding.materials }, "temperature", []).spec,
  ];
}

function displacementCases(full: SimulationSpec): SimulationSpec[] {
  const added = addSupport(full, "displacement", [2]);
  const move = added.spec.supports.find((s) => s.id === added.id);
  if (move?.type !== "displacement") throw new Error("no displacement");
  const plane = addSupport(full, "frictionless", []).spec;
  return [
    added.spec,
    updateSupport(added.spec, { ...move, x: null }),
    updateSupport(added.spec, { ...move, y: { value: 0, unit: "mm" } }),
    { ...updateSupport(added.spec, { ...move, y: { value: 0, unit: "mm" } }), loads: [] },
    { ...updateSupport(added.spec, { ...move, y: { value: 0.2, unit: "mm" } }), loads: [] },
    plane,
  ];
}

describe("setup status marks", () => {
  it("agree with the pre-run list: every mark is complete exactly when nothing stops a run", () => {
    const allComplete = (spec: SimulationSpec) =>
      [...setupStatus(spec, topology).values()].every((status) => status.mark === "complete");
    const full = complete();
    const [material] = full.materials;
    const [support] = full.supports;
    const [load] = full.loads;
    if (!material || !support || load?.type !== "pressure") throw new Error("incomplete fixture");
    const cases: SimulationSpec[] = [
      empty(),
      full,
      addMaterial(empty()).spec,
      { ...full, mesh: { size: null } },
      { ...full, loads: [] },
      { ...full, supports: [{ ...support, faces: [] }] },
      { ...full, loads: [{ ...load, magnitude: null }] },
      { ...full, materials: [{ ...material, poissonsRatio: null }] },
      { ...full, bodies: [{ tag: 1, material: null }] },
      { ...full, supports: [{ ...support, faces: [9] }] },
      // M2.2: a prescribed displacement asks for every component and one value; one other
      // than zero stands in for a load.
      ...displacementCases(full),
      ...loadCases(full),
    ];
    for (const spec of cases) {
      expect(allComplete(spec)).toBe(preRunProblems(spec, topology).length === 0);
    }
  });

  it("marks an empty setup's groups incomplete and says what to add", () => {
    const status = setupStatus(empty(), topology);
    expect(status.get("materials")).toEqual({ mark: "incomplete", notes: ["Add a material."] });
    expect(status.get("supports")).toEqual({ mark: "incomplete", notes: ["Add a support."] });
    expect(status.get("loads")).toEqual({ mark: "incomplete", notes: ["Add a load."] });
  });

  it("marks a filled-in setup complete everywhere", () => {
    const status = setupStatus(complete(), topology);
    for (const key of ["materials", "supports", "loads", "material-1", "fixed-1", "pressure-1"]) {
      expect(status.get(key)).toEqual({ mark: "complete", notes: [] });
    }
  });

  it("names the missing values of a new item, and its group follows", () => {
    const { spec } = addPressure(complete(), []);
    const status = setupStatus(spec, topology);
    expect(status.get("pressure-2")).toEqual({
      mark: "incomplete",
      notes: ["Pick the faces the pressure acts on.", "Enter the pressure."],
    });
    expect(status.get("loads")?.mark).toBe("incomplete");
  });

  it("marks an item with a problem as an error, ahead of anything missing", () => {
    let spec = complete();
    const [material] = spec.materials;
    if (!material) throw new Error("no material");
    spec = updateMaterial(spec, { ...material, youngsModulus: { value: 0, unit: "GPa" }, poissonsRatio: null });
    spec = addFixedSupport(spec, [9]).spec;
    const status = setupStatus(spec, topology);
    expect(status.get("material-1")).toEqual({
      mark: "error",
      notes: ['Young\'s modulus of material "Material 1" must be greater than zero; it is 0 GPa.'],
    });
    expect(status.get("materials")?.mark).toBe("error");
    expect(status.get("fixed-2")?.mark).toBe("error");
    expect(status.get("supports")?.notes).toEqual([
      'Support "Fixed support 2" uses face 9, which the geometry does not have.',
    ]);
  });

  it("asks for a material on a body that has none, on the body and under Bodies (M4.1)", () => {
    const spec = assignMaterial(complete(), 1, null);
    const statuses = setupStatus(spec, topology);
    expect(statuses.get("bodies")).toEqual({ mark: "incomplete", notes: ["Pick a material for Body 1."] });
    expect(statuses.get("body:1")).toEqual({ mark: "incomplete", notes: ["Pick its material."] });
    expect(statuses.get("materials")?.mark).toBe("complete");
  });

  it("names bodies by their part names (M4.1)", () => {
    const two = {
      ...complete(),
      bodies: [
        { tag: 1, material: null },
        { tag: 2, material: null },
      ],
    };
    const named = { ...topology, bodies: [{ tag: 1, name: "Shell" }, { tag: 2 }] };
    expect(setupStatus(two, named).get("bodies")?.notes).toEqual(["Pick a material for Shell, Body 2."]);
    const none = { ...two, materials: [] };
    expect(setupStatus(none, named).get("body:2")?.notes).toEqual(["Add a material under Materials, then pick it here."]);
  });
});

describe("setup edits", () => {
  it("gives the first material to every body, but not later ones", () => {
    const first = addMaterial(empty());
    expect(first.id).toBe("material-1");
    expect(first.spec.bodies).toEqual([{ tag: 1, material: "material-1" }]);
    const second = addMaterial(first.spec);
    expect(second.id).toBe("material-2");
    expect(second.spec.bodies).toEqual([{ tag: 1, material: "material-1" }]);
  });

  it("adds each type of support with its own id, name and defaults", () => {
    let spec = addSupport(empty(), "displacement", [1]).spec;
    spec = addSupport(spec, "frictionless", [2]).spec;
    spec = addSupport(spec, "elastic", []).spec;
    expect(spec.supports).toEqual([
      { id: "displacement-1", type: "displacement", name: "Prescribed displacement 1", faces: [1], x: "free", y: "free", z: "free" },
      { id: "frictionless-1", type: "frictionless", name: "Frictionless support 1", faces: [2] },
      { id: "elastic-1", type: "elastic", name: "Elastic support 1", faces: [], stiffness: null },
    ]);
    const status = setupStatus(spec, topology);
    expect(status.get("displacement-1")).toEqual({
      mark: "incomplete",
      notes: ["Give at least one component a value; every one is free."],
    });
    expect(status.get("frictionless-1")).toEqual({ mark: "complete", notes: [] });
    expect(status.get("elastic-1")).toEqual({
      mark: "incomplete",
      notes: ["Pick the faces it supports.", "Enter the foundation stiffness."],
    });
  });

  it("numbers new items with the smallest free number", () => {
    let spec = addFixedSupport(empty(), []).spec;
    spec = addFixedSupport(spec, []).spec;
    spec = removeItem(spec, "fixed-1");
    const again = addFixedSupport(spec, [2]);
    expect(again.id).toBe("fixed-1");
    expect(again.spec.supports.map((s) => s.name)).toEqual(["Fixed support 2", "Fixed support 1"]);
    expect(facesOf(again.spec, "fixed-1")).toEqual([2]);
    expect(facesOf(again.spec, "material-1")).toBeNull();
  });

  it("leaves bodies without a material when it is deleted", () => {
    const spec = removeItem(complete(), "material-1");
    expect(spec.materials).toEqual([]);
    expect(spec.bodies).toEqual([{ tag: 1, material: null }]);
  });
});

describe("mesh mark", () => {
  const mesh = (overrides: Partial<MeshView> = {}): MeshView => ({
    id: "m1",
    geometryId: "g1",
    size: { value: 5, unit: "mm" },
    order: 2,
    local: [],
    status: "ready",
    problem: null,
    nodeCount: 10,
    elementCount: 4,
    quality: null,
    createdAt: "2026-10-15T12:00:00.000Z",
    ...overrides,
  });

  it("needs a size, then a mesh made with that size", () => {
    const spec = empty();
    const settings = setupStatus(spec).get("mesh");
    expect(settings).toEqual({ mark: "incomplete", notes: ["Enter a global mesh size."] });
    if (!settings) throw new Error("no mark");
    expect(meshStatus(settings, spec, mesh())).toBe(settings);

    const sized: SimulationSpec = { ...spec, mesh: { size: { value: 5, unit: "mm" } } };
    const ok = setupStatus(sized).get("mesh");
    if (!ok) throw new Error("no mark");
    expect(ok.mark).toBe("complete");
    expect(meshStatus(ok, sized, null).notes).toEqual(["Generate the mesh."]);
    expect(meshStatus(ok, sized, mesh({ status: "meshing" })).notes).toEqual(["The mesh is being made."]);
    expect(meshStatus(ok, sized, mesh({ status: "failed", problem: "Too fine." }))).toEqual({
      mark: "error",
      notes: ["Too fine."],
    });
    expect(meshStatus(ok, sized, mesh())).toEqual({ mark: "complete", notes: [] });
    // The same length in another unit is still a different setting from what was meshed.
    expect(meshStatus(ok, sized, mesh({ size: { value: 0.5, unit: "cm" } })).mark).toBe("incomplete");
  });

  it("marks local sizes and needs a new mesh when the order or a local size changes (M2.8)", () => {
    const sized: SimulationSpec = { ...empty(), mesh: { size: { value: 5, unit: "mm" } } };
    const { spec, id } = addLocalSize(sized, "faces", [2]);
    expect(id).toBe("local-1");
    expect(facesOf(spec, id)).toEqual([2]);
    const status = setupStatus(spec, topology);
    expect(status.get(id)).toEqual({ mark: "incomplete", notes: ["Enter the local size."] });
    expect(status.get("mesh")).toEqual({ mark: "incomplete", notes: ["Enter the local size."] });
    const item = spec.mesh.local?.[0];
    if (!item) throw new Error("no local size");
    const done = updateLocalSize(spec, { ...item, size: { value: 1, unit: "mm" } });
    expect(setupStatus(done, topology).get("mesh")?.mark).toBe("complete");
    const tooLarge = updateLocalSize(spec, { ...item, size: { value: 0.6, unit: "cm" } });
    expect(setupStatus(tooLarge, topology).get(id)?.mark).toBe("error");

    const made = mesh({ local: [{ scope: "faces", tags: [2], size: { value: 1, unit: "mm" } }] });
    expect(meshIsCurrent(done, made)).toBe(true);
    expect(meshIsCurrent({ ...done, mesh: { ...done.mesh, order: 1 } }, made)).toBe(false);
    expect(meshIsCurrent(removeItem(done, id), made)).toBe(false);
    expect(meshIsCurrent(removeItem(done, id), mesh())).toBe(true);
    // Renaming a local size does not change the mesh.
    expect(meshIsCurrent(updateLocalSize(done, { ...item, name: "Hole", size: { value: 1, unit: "mm" } }), made)).toBe(true);
  });

  it("marks a mesh size in the wrong unit kind as an error", () => {
    const spec: SimulationSpec = { ...empty(), mesh: { size: { value: 5, unit: "MPa" } } };
    expect(setupStatus(spec).get("mesh")?.mark).toBe("error");
  });
});

describe("run mark", () => {
  const run = (overrides: Partial<RunView>): RunView => ({
    id: "r1",
    simulationId: "s1",
    meshId: "m1",
    spec: empty(),
    mesh: { size: { value: 5, unit: "mm" }, order: 2, nodeCount: 7108, elementCount: 4000 },
    software: { clearfea: "0.0.0+d9d394b", deckFormat: 1, calculix: "2.21", gmsh: "4.15.2", occt: "7.9.0" },
    files: [],
    machine: { size: "local", ratePerHour: 1_000_000 },
    estimate: null,
    cost: null,
    status: "solving",
    stage: "solving",
    problem: null,
    result: null,
    createdAt: "2026-10-15T12:00:00.000Z",
    finishedAt: null,
    ...overrides,
  });

  it("asks for a run until there is one, and follows its status", () => {
    expect(runStatus(null)).toEqual({ mark: "incomplete", notes: ["Run the simulation to get results."] });
    expect(runStatus(run({})).mark).toBe("incomplete");
    expect(runStatus(run({ status: "failed", problem: "Add a support." }))).toEqual({
      mark: "error",
      notes: ["Add a support."],
    });
    expect(runStatus(run({ status: "succeeded" }))).toEqual({ mark: "complete", notes: [] });
  });
});

describe("sameSpec", () => {
  it("compares content, not key order", () => {
    const spec = empty();
    const { mesh, ...rest } = spec;
    const reordered: SimulationSpec = { mesh, ...rest };
    expect(Object.keys(reordered)[0]).toBe("mesh");
    expect(sameSpec(spec, reordered)).toBe(true);
    expect(sameSpec(spec, { ...spec, mesh: { size: { value: 3, unit: "mm" } } })).toBe(false);
    expect(sameSpec(spec, { ...spec, bodies: [] })).toBe(false);
  });
});

describe("bonds (M4.2)", () => {
  const assembly = {
    bodies: [{ tag: 1 }, { tag: 2 }, { tag: 3 }],
    faces: [6, 9, 11, 14].map((tag) => ({ tag })),
    bonds: [
      { faces: [6, 11] as [number, number], bodies: [1, 2] as [number, number] },
      { faces: [9, 14] as [number, number], bodies: [2, 3] as [number, number] },
    ],
  };

  it("marks Bonds incomplete until every detected bond is reviewed", () => {
    let spec = emptySimulationSpec("g1", assembly);
    expect(setupStatus(spec, assembly).get("bonds")).toEqual({
      mark: "incomplete",
      notes: ["Review 2 detected bonds: accept or remove each. Bonds not removed are tied."],
    });
    spec = setBondStatus(spec, assembly, ["6-11"], "accepted");
    expect(setupStatus(spec, assembly).get("bonds")?.notes).toEqual([
      "Review the detected bond: accept or remove each. Bonds not removed are tied.",
    ]);
    spec = setBondStatus(spec, assembly, ["9-14"], "removed");
    expect(spec.bonds).toEqual([
      { faces: [6, 11], status: "accepted" },
      { faces: [9, 14], status: "removed" },
    ]);
    expect(setupStatus(spec, assembly).get("bonds")).toEqual({ mark: "complete", notes: [] });
  });

  it("gives a spec saved before M4.2 its own bond list on the first review", () => {
    const { bonds: _, ...older } = emptySimulationSpec("g1", assembly);
    expect(setBondStatus(older, assembly, ["9-14"], "accepted").bonds).toEqual([
      { faces: [6, 11], status: "detected" },
      { faces: [9, 14], status: "accepted" },
    ]);
  });

  it("does not block a run: detected bonds are tied", () => {
    const spec = emptySimulationSpec("g1", assembly);
    expect(preRunProblems(spec, assembly).some((p) => p.item === "bonds")).toBe(false);
  });
});

describe("bodies no support holds (M4.4)", () => {
  const assembly = {
    bodies: [{ tag: 1 }, { tag: 2, name: "Pad" }],
    faces: [
      { tag: 1, bodies: [1] },
      { tag: 2, bodies: [1] },
      { tag: 3, bodies: [2] },
      { tag: 4, bodies: [2] },
    ],
    bonds: [{ faces: [2, 3] as [number, number], bodies: [1, 2] as [number, number] }],
  };

  function assemblySpec(status: "accepted" | "removed"): SimulationSpec {
    const full = complete();
    const [material] = full.materials;
    const [support] = full.supports;
    if (!material || !support) throw new Error("incomplete fixture");
    return {
      ...full,
      bodies: [1, 2].map((tag) => ({ tag, material: material.id })),
      supports: [{ ...support, faces: [1] }],
      bonds: [{ faces: [2, 3], status }],
      mesh: { size: { value: 5, unit: "mm" } },
    };
  }

  it("marks the free body and Bodies incomplete, as the pre-run list refuses the run", () => {
    const removed = setupStatus(assemblySpec("removed"), assembly);
    expect(removed.get(bodyItem(1))).toEqual({ mark: "complete", notes: [] });
    expect(removed.get(bodyItem(2))).toEqual({
      mark: "incomplete",
      notes: ["No support holds it and no bond joins it to a held body. Add a support on one of its faces."],
    });
    expect(removed.get("bodies")?.notes).toEqual([
      'Body "Pad" is not bonded to a held body and no support holds it, so it is free to move. Add a support on one of its faces, or restore a removed bond under Bonds that joins it to a held body.',
    ]);
    expect(preRunProblems(assemblySpec("removed"), assembly).map((p) => p.item)).toEqual(["bodies"]);
    const accepted = setupStatus(assemblySpec("accepted"), assembly);
    expect([...accepted.values()].every((s) => s.mark === "complete")).toBe(true);
    expect(preRunProblems(assemblySpec("accepted"), assembly)).toEqual([]);
  });
});
