// SPDX-License-Identifier: AGPL-3.0-or-later
import { emptySimulationSpec, type MeshView, type RunView, type SimulationSpec } from "@clearfea/spec";
import { describe, expect, it } from "vitest";
import {
  addFixedSupport,
  addMaterial,
  addPressure,
  assignMaterial,
  facesOf,
  meshStatus,
  runStatus,
  removeItem,
  setupStatus,
  updateLoad,
  updateMaterial,
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
  if (!load) throw new Error("no load");
  return updateLoad(spec, { ...load, magnitude: { value: 1, unit: "MPa" } });
}

describe("setup status marks", () => {
  it("marks an empty setup's groups incomplete and says what to add", () => {
    const status = setupStatus(empty(), topology);
    expect(status.get("materials")).toEqual({ mark: "incomplete", notes: ["Add a material."] });
    expect(status.get("supports")).toEqual({ mark: "incomplete", notes: ["Add a fixed support."] });
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

  it("asks for a material on a body that has none", () => {
    const spec = assignMaterial(complete(), 1, null);
    expect(setupStatus(spec, topology).get("materials")).toEqual({
      mark: "incomplete",
      notes: ["Assign a material to body 1."],
    });
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
    status: "ready",
    problem: null,
    nodeCount: 10,
    elementCount: 4,
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
