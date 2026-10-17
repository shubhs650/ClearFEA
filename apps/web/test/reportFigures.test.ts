// SPDX-License-Identifier: AGPL-3.0-or-later
// Which figures a report needs and how a support's or load's figure is framed (M7.2).

import type { Load, ReportOptions, RunView, SavedView, SimulationSpec, Topology } from "@clearfea/spec";
import { describe, expect, it } from "vitest";
import { facingDirection, faceNormals, itemCaption, itemFaces, loadArrows, planFigures } from "../src/report/figures";
import type { DisplayMesh } from "../src/viewer/displayMesh";

const spec = {
  supports: [{ id: "fixed-1", type: "fixed", name: "Fixed support 1", faces: [1] }],
  loads: [
    { id: "pressure-1", type: "pressure", name: "Top", faces: [2], magnitude: { value: 1, unit: "MPa" } },
    { id: "gravity-1", type: "gravity", name: "Gravity 1", x: null, y: null, z: { value: -9.81, unit: "m/s²" } },
  ],
  analysis: "linear_static",
} as unknown as SimulationSpec;

const run = { spec, result: null } as unknown as Pick<RunView, "spec" | "result">;

const view = (id: string, name: string, result: SavedView["settings"]["result"]): SavedView => ({
  id,
  name,
  settings: { camera: { position: [1, 1, 1], target: [0, 0, 0] }, hiddenBodies: [], result },
  updatedAt: "2026-10-17T00:00:00.000Z",
});

const views = [
  view("v1", "Front", null),
  view("v2", "Iso", { quantity: "vonMises", deformation: "auto", extremes: true, cut: null }),
];

/** A vector to compare: rounded, and -0 read as 0. */
const near = (v: readonly number[] | undefined) => v?.map((x) => Number(x.toFixed(6)) + 0);

const options = (sections: ReportOptions["sections"], picked: string[]) => ({ sections, views: picked });

describe("planFigures", () => {
  it("lists each support, then each load, then the views picked in their order", () => {
    const planned = planFigures(run, options(["loadsSupports", "results"], ["v2", "v1", "deleted"]), views);
    expect(planned.map((f) => [f.kind, f.item, f.caption])).toEqual([
      ["support", "fixed-1", "Fixed support 1"],
      ["load", "pressure-1", "Top (pressure)"],
      ["load", "gravity-1", "Gravity 1"],
      ["view", "v2", 'Von Mises stress, view "Iso"'],
      ["view", "v1", 'Model, view "Front"'],
    ]);
  });

  it("follows the sections turned on", () => {
    expect(planFigures(run, options(["results"], ["v1"]), views).map((f) => f.item)).toEqual(["v1"]);
    expect(planFigures(run, options(["loadsSupports"], ["v1"]), views).map((f) => f.kind)).toEqual(["support", "load", "load"]);
    expect(planFigures(run, options(["project"], ["v1"]), views)).toEqual([]);
  });
});

describe("itemCaption", () => {
  it("adds the kind unless the name starts with it", () => {
    expect(itemCaption("Pressure 1", "Pressure")).toBe("Pressure 1");
    expect(itemCaption("Bolt holes", "Fixed support")).toBe("Bolt holes (fixed support)");
  });
});

/** A unit cube's top (z = 1, tag 2) and bottom (z = 0, tag 1) faces, each two counter-clockwise triangles seen from outside. */
const cube: DisplayMesh = {
  positions: new Float32Array([0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
  faces: [
    { tag: 1, firstVertex: 0, vertexCount: 4, firstTriangle: 0, triangleCount: 2 },
    { tag: 2, firstVertex: 4, vertexCount: 4, firstTriangle: 2, triangleCount: 2 },
  ],
};

const topology = {
  bbox: [0, 0, 0, 1, 1, 1],
  bodies: [{ tag: 1, volume: 1, faces: [1, 2] }],
  faces: [
    { tag: 1, type: "plane", gmshType: "Plane", area: 1, centroid: [0.5, 0.5, 0], bbox: [0, 0, 0, 1, 1, 0], bodies: [1] },
    { tag: 2, type: "plane", gmshType: "Plane", area: 1, centroid: [0.5, 0.5, 1], bbox: [0, 0, 1, 1, 1, 1], bodies: [1] },
  ],
} as unknown as Topology;

describe("framing a support or load", () => {
  const normals = faceNormals(cube);

  it("finds each face's outward normal times its area", () => {
    expect(near(normals.get(1))).toEqual([0, 0, -1]);
    expect(near(normals.get(2))).toEqual([0, 0, 1]);
  });

  it("looks at faces from their side, leaning towards the isometric direction", () => {
    const [, , z] = facingDirection([1], normals);
    expect(z).toBeLessThan(0);
    // Opposite faces cancel: the isometric direction.
    const iso = facingDirection([1, 2], normals);
    expect(iso.map((v) => Number(v.toFixed(3)))).toEqual([1, 0.8, 1.2]);
  });

  it("picks out a support's faces, or a heat generation's bodies, and nothing for gravity", () => {
    expect(itemFaces(spec.supports[0] as SimulationSpec["supports"][number], topology)).toEqual([1]);
    expect(itemFaces(spec.loads[1] as Load, topology)).toEqual([]);
    const heat = { id: "h", type: "heat_generation", name: "H", bodies: [1], power: null } as Load;
    expect(itemFaces(heat, topology)).toEqual([1, 2]);
  });

  it("points a pressure into its face, and out of it when negative", () => {
    const pressure = spec.loads[0] as Load;
    const [push] = loadArrows(pressure, topology, normals, 2);
    expect(near(push?.direction)).toEqual([0, 0, -1]);
    expect(near(push?.origin)).toEqual([0.5, 0.5, 1.5]);
    const suction = { ...pressure, magnitude: { value: -1, unit: "MPa" } } as Load;
    expect(near(loadArrows(suction, topology, normals, 2)[0]?.direction)).toEqual([0, 0, 1]);
  });

  it("points gravity along its acceleration and a force at its faces' centroid", () => {
    const [g] = loadArrows(spec.loads[1] as Load, topology, normals, 2);
    expect(near(g?.direction)).toEqual([0, 0, -1]);
    const force = { id: "f", type: "force", name: "F", faces: [2], x: { value: 1, unit: "kN" }, y: null, z: null } as Load;
    const [arrow] = loadArrows(force, topology, normals, 2);
    expect(near(arrow?.direction)).toEqual([1, 0, 0]);
    expect(near(arrow?.origin)).toEqual([0, 0.5, 1]);
    expect(arrow?.length).toBe(0.5);
  });
});
