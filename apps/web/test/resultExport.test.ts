// SPDX-License-Identifier: AGPL-3.0-or-later
// CSV and VTK export (M3.8, ADR-057).

import type { SimulationSpec, SolveResult } from "@clearfea/spec";
import { describe, expect, it } from "vitest";
import { type ExportUnits, nodeCsv, reactionsCsv, VTK_NODE_ORDER, vtuParts } from "../src/viewer/resultExport";
import type { ResultField, ResultFields } from "../src/viewer/resultFields";
import { parseVolumeMesh, type VolumeMesh } from "../src/viewer/section";
import { boxMesh } from "./volumeBox";

const SI: ExportUnits = { length: "m", pressure: "Pa", force: "N", moment: "N·m", strain: "m/m", ratio: "1" };
const MM: ExportUnits = { length: "mm", pressure: "MPa", force: "kN", moment: "N·mm", strain: "µε", ratio: "1" };

/** Fields with values made from the node number, so each cell can be checked. */
function fieldsFor(mesh: VolumeMesh, withSafety = true): ResultFields {
  const n = mesh.nodeCount;
  const make = (kind: string, components: number, scale: number): ResultField => ({
    kind,
    components,
    values: Float32Array.from({ length: n * components }, (_, i) => scale * (i + 1)),
  });
  const fields = new Map<string, ResultField>([
    ["displacement", make("length", 3, 1e-6)],
    ["vonMises", make("pressure", 1, 1e6)],
    ["stress", make("pressure", 6, 1e5)],
    ["principalStress", make("pressure", 3, 1e5)],
    ["strain", make("strain", 6, 1e-6)],
  ]);
  if (withSafety) fields.set("safetyFactor", make("ratio", 1, 0.5));
  return { vertexCount: n, fields };
}

const rows = (chunks: string[]) => chunks.join("").split("\r\n").slice(0, -1);

describe("node CSV", () => {
  const mesh = parseVolumeMesh(boxMesh(2, 2));
  const nodes = fieldsFor(mesh);

  it("has a row per node, numbered as in the deck, after a header naming each column and its unit", () => {
    const lines = rows(nodeCsv(mesh, nodes, MM));
    expect(lines).toHaveLength(mesh.nodeCount + 1);
    expect(lines[0]?.startsWith("﻿")).toBe(true);
    const header = (lines[0] ?? "").slice(1).split(",");
    expect(header.slice(0, 8)).toEqual(["node", "x (mm)", "y (mm)", "z (mm)", "ux (mm)", "uy (mm)", "uz (mm)", "von Mises stress (MPa)"]);
    expect(header).toContain("stress zx (MPa)");
    expect(header).toContain("principal stress 3 (MPa)");
    expect(header).toContain("strain xy (tensor) (µε)");
    expect(header.at(-1)).toBe("safety factor");
    expect(header).toHaveLength(1 + 3 + 3 + 1 + 6 + 3 + 6 + 1);
    expect(lines.slice(1).every((l) => l.split(",").length === header.length)).toBe(true);
  });

  it("writes positions and values converted into the units asked for", () => {
    const lines = rows(nodeCsv(mesh, nodes, MM));
    // Node 2 (index 1) is at (0.5, 0, 0) m in the box.
    const cells = (lines[2] ?? "").split(",").map(Number);
    expect(cells[0]).toBe(2);
    expect(cells.slice(1, 4)).toEqual([500, 0, 0]);
    // Displacement of index 1: values 4, 5, 6 µm.
    expect(cells.slice(4, 7)).toEqual([0.004, 0.005, 0.006]);
    // von Mises of index 1: 2 MPa; strain xx of index 1: value 7e-6 m/m = 7 µε.
    expect(cells[7]).toBe(2);
    expect(cells[1 + 3 + 3 + 1 + 6 + 3]).toBe(7);
    expect(cells.at(-1)).toBe(1);
    const si = (rows(nodeCsv(mesh, nodes, SI))[2] ?? "").split(",").map(Number);
    expect(si[7]).toBe(2e6);
  });

  it("leaves out a field the run does not have", () => {
    const header = rows(nodeCsv(mesh, fieldsFor(mesh, false), SI))[0] ?? "";
    expect(header).not.toContain("safety factor");
  });

  it("refuses node values that do not match the mesh", () => {
    expect(() => nodeCsv(mesh, { ...nodes, vertexCount: 3 }, SI)).toThrow(/Run the simulation again/);
  });
});

describe("reactions CSV", () => {
  const spec = {
    supports: [{ id: "s1", name: "Base, fixed" }],
    loads: [{ id: "l1", name: "Push" }],
  } as unknown as SimulationSpec;
  const result = {
    reactions: [{ supportId: "s1", force: [0, 0, 1000], moment: [2, 0, 0], point: [0.01, 0, 0] }],
    loads: [{ loadId: "l1", force: [0, 0, -1000], moment: [-2, 0, 0] }],
  } as unknown as SolveResult;

  it("has a row per support and per load, named as in the run's setup, in the units asked for", () => {
    const lines = reactionsCsv(result, spec, MM).split("\r\n");
    expect(lines[0]).toBe(
      "﻿item,name,Fx (kN),Fy (kN),Fz (kN),Mx (N·mm),My (N·mm),Mz (N·mm),moment point x (mm),moment point y (mm),moment point z (mm)",
    );
    expect(lines[1]).toBe('reaction,"Base, fixed",0,0,1,2000,0,0,10,0,0');
    expect(lines[2]).toBe("applied load,Push,0,0,-1,-2000,0,0,0,0,0");
  });

  it("leaves the moment cells empty for a run solved before M3.2", () => {
    const old = { reactions: [{ supportId: "s1", force: [1, 2, 3] }] } as unknown as SolveResult;
    expect(reactionsCsv(old, spec, SI).split("\r\n")[1]).toBe('reaction,"Base, fixed",1,2,3,,,,,,');
  });
});

/** A .vtu file read back: its XML head, and each appended array by name. */
async function readVtu(parts: BlobPart[]) {
  const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
  const marker = new TextEncoder().encode('<AppendedData encoding="raw">\n_');
  let start = -1;
  for (let i = 0; i + marker.length <= bytes.length && start < 0; i++) {
    if (marker.every((b, k) => bytes[i + k] === b)) start = i + marker.length;
  }
  expect(start).toBeGreaterThan(0);
  const head = new TextDecoder().decode(bytes.subarray(0, start));
  const view = new DataView(bytes.buffer);
  const arrays = new Map<string, { type: string; components: number; data: DataView; tag: string }>();
  for (const match of head.matchAll(/<DataArray ([^>]*)\/>/g)) {
    const tag = match[1] ?? "";
    const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1];
    const offset = Number(attr("offset"));
    const size = Number(view.getBigUint64(start + offset, true));
    arrays.set(attr("Name") ?? "", {
      type: attr("type") ?? "",
      components: Number(attr("NumberOfComponents") ?? 1),
      data: new DataView(bytes.buffer, start + offset + 8, size),
      tag,
    });
  }
  const tail = new TextDecoder().decode(bytes.subarray(bytes.length - 30));
  return { head, arrays, tail };
}

describe("VTK file", () => {
  it("writes the mesh, its bodies and every field, readable back with the XML head's offsets", async () => {
    const mesh = parseVolumeMesh(boxMesh(2, 2, true));
    const nodes = fieldsFor(mesh);
    const { head, arrays, tail } = await readVtu(vtuParts(mesh, nodes));
    expect(head).toContain(`<Piece NumberOfPoints="${mesh.nodeCount}" NumberOfCells="${mesh.elementCount}">`);
    expect(tail).toContain("</VTKFile>");
    expect([...arrays.keys()]).toEqual([
      "displacement (m)",
      "vonMises (Pa)",
      "stress (Pa)",
      "principalStress (Pa)",
      "strain (m/m)",
      "safetyFactor",
      "body",
      "Points",
      "connectivity",
      "offsets",
      "types",
    ]);
    expect(arrays.get("stress (Pa)")?.tag).toContain('ComponentName5="XZ"');
    const stress = arrays.get("stress (Pa)");
    expect(stress?.components).toBe(6);
    expect(stress?.data.byteLength).toBe(mesh.nodeCount * 6 * 4);
    expect(stress?.data.getFloat32(4 * 7, true)).toBeCloseTo(8e5);
    const points = arrays.get("Points");
    expect(points?.data.getFloat64(3 * 8, true)).toBe(0.5);
    const body = arrays.get("body")?.data;
    expect(body?.getInt32(0, true)).toBe(1);
    expect(body?.getInt32((mesh.elementCount - 1) * 4, true)).toBe(2);
    const types = arrays.get("types")?.data;
    expect(types?.getUint8(0)).toBe(24);
    const offsets = arrays.get("offsets")?.data;
    expect(offsets?.getInt32((mesh.elementCount - 1) * 4, true)).toBe(mesh.elementCount * 10);
  });

  it("lists each 10-node element in VTK's node order: mid-edge nodes on VTK's edges", async () => {
    const mesh = parseVolumeMesh(boxMesh(2, 2));
    const { arrays } = await readVtu(vtuParts(mesh, fieldsFor(mesh)));
    const connectivity = arrays.get("connectivity")?.data;
    if (connectivity === undefined) throw new Error("no connectivity");
    // VTK's quadratic tetrahedron: nodes 4 to 9 on edges (0,1), (1,2), (2,0), (0,3), (1,3), (2,3).
    const vtkEdges = [
      [0, 1],
      [1, 2],
      [2, 0],
      [0, 3],
      [1, 3],
      [2, 3],
    ];
    const p = mesh.positions;
    for (let e = 0; e < mesh.elementCount; e++) {
      const node = (k: number) => connectivity.getInt32((e * 10 + k) * 4, true);
      vtkEdges.forEach(([a = 0, b = 0], k) => {
        for (let c = 0; c < 3; c++) {
          const middle = ((p[3 * node(a) + c] ?? 0) + (p[3 * node(b) + c] ?? 0)) / 2;
          expect(p[3 * node(4 + k) + c]).toBeCloseTo(middle, 12);
        }
      });
      // Corners as in mesh.bin, so the element keeps its positive volume.
      for (let k = 0; k < 4; k++) expect(node(k)).toBe(mesh.elements[e * 10 + k]);
    }
    expect(VTK_NODE_ORDER[1]).toEqual([0, 1, 2, 3]);
  });

  it("writes 4-node elements as VTK tetrahedra", async () => {
    const mesh = parseVolumeMesh(boxMesh(1, 1));
    const { arrays } = await readVtu(vtuParts(mesh, fieldsFor(mesh)));
    expect(arrays.get("types")?.data.getUint8(0)).toBe(10);
    expect(arrays.get("connectivity")?.data.byteLength).toBe(mesh.elementCount * 4 * 4);
  });
});
