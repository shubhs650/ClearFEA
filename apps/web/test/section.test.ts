// SPDX-License-Identifier: AGPL-3.0-or-later
// Cut planes (M3.4, ADR-053): reading mesh.bin and cutting it.

import { describe, expect, it } from "vitest";
import { cutMesh, parseVolumeMesh, type Section, sectionPositions, sectionValues, VolumeMeshError } from "../src/viewer/section";
import { boxMesh } from "./volumeBox";

/** Total area of the section's triangles, and whether each faces along the normal. */
function areaAndFacing(section: Section, normal: readonly number[]): { area: number; facing: boolean } {
  const p = section.points;
  let area = 0;
  let facing = true;
  for (let k = 0; k < section.triangles.length; k += 3) {
    const [a, b, c] = [0, 1, 2].map((i) => section.triangles[k + i] ?? 0) as [number, number, number];
    const u = [0, 1, 2].map((i) => (p[3 * b + i] ?? 0) - (p[3 * a + i] ?? 0));
    const v = [0, 1, 2].map((i) => (p[3 * c + i] ?? 0) - (p[3 * a + i] ?? 0));
    const n = [
      (u[1] ?? 0) * (v[2] ?? 0) - (u[2] ?? 0) * (v[1] ?? 0),
      (u[2] ?? 0) * (v[0] ?? 0) - (u[0] ?? 0) * (v[2] ?? 0),
      (u[0] ?? 0) * (v[1] ?? 0) - (u[1] ?? 0) * (v[0] ?? 0),
    ];
    area += Math.hypot(...n) / 2;
    facing &&= n.reduce((sum, x, i) => sum + x * (normal[i] ?? 0), 0) > 0;
  }
  return { area, facing };
}

describe("reading mesh.bin", () => {
  it("reads nodes and elements of either order", () => {
    for (const [order, npe] of [
      [1, 4],
      [2, 10],
    ] as const) {
      const mesh = parseVolumeMesh(boxMesh(2, order));
      expect(mesh.order).toBe(order);
      expect(mesh.elementCount).toBe(48);
      expect(mesh.elements.length).toBe(48 * npe);
      expect(mesh.nodeCount).toBe(order === 1 ? 27 : 27 + 98);
      expect([...mesh.positions.slice(3, 6)]).toEqual([0.5, 0, 0]);
    }
  });

  it("reads a version 2 file, which adds the edges' segments (ADR-105)", () => {
    for (const order of [1, 2] as const) {
      const v1 = boxMesh(2, order);
      // One edge of one segment: two counts after the version 1 header, a row and its nodes at the end.
      const per = order + 1;
      const v2 = new ArrayBuffer(v1.byteLength + 8 + 12 + per * 4);
      const bytes = new Uint8Array(v2);
      bytes.set(new Uint8Array(v1, 0, 32), 0);
      bytes.set(new Uint8Array(v1, 32), 40);
      const view = new DataView(v2);
      view.setUint32(4, 2, true);
      view.setUint32(32, 1, true);
      view.setUint32(36, 1, true);
      const end = v1.byteLength + 8;
      view.setInt32(end, 7, true);
      view.setUint32(end + 4, 0, true);
      view.setUint32(end + 8, 1, true);
      for (let k = 0; k < per; k++) view.setUint32(end + 12 + 4 * k, k, true);
      const mesh = parseVolumeMesh(v2);
      const plain = parseVolumeMesh(v1);
      expect([...mesh.positions]).toEqual([...plain.positions]);
      expect([...mesh.elements]).toEqual([...plain.elements]);
      expect(mesh.bodies).toEqual(plain.bodies);
      expect(() => parseVolumeMesh(v2.slice(0, v2.byteLength - 4))).toThrow(/do not match its header/);
    }
  });

  it("refuses a damaged file with a message that says what to do", () => {
    const buffer = boxMesh(1);
    expect(() => parseVolumeMesh(buffer.slice(0, buffer.byteLength - 4))).toThrow(VolumeMeshError);
    expect(() => parseVolumeMesh(buffer.slice(0, buffer.byteLength - 4))).toThrow(/Run the simulation again/);
    const other = buffer.slice(0);
    new DataView(other).setUint32(4, 3, true);
    expect(() => parseVolumeMesh(other)).toThrow(/version 3/);
    const wrong = buffer.slice(0);
    const elements = new Uint32Array(wrong, 32 + parseVolumeMesh(buffer).nodeCount * 24);
    elements[0] = 1_000_000;
    expect(() => parseVolumeMesh(wrong)).toThrow(/node that does not exist/);
  });
});

describe("cutting the mesh", () => {
  it("covers the whole cross-section, facing the cut-away side, for any plane", () => {
    for (const order of [1, 2] as const) {
      const mesh = parseVolumeMesh(boxMesh(3, order));
      // Through nodes, between them, and slanted (a rectangle 1 by 1/cos 45°).
      for (const [normal, offset, area] of [
        [[1, 0, 0], 1 / 3, 1],
        [[0, -1, 0], -0.4, 1],
        [[0, 0, 1], 0.71, 1],
        [[Math.SQRT1_2, 0, Math.SQRT1_2], Math.SQRT1_2, Math.SQRT2],
      ] as const) {
        const section = cutMesh(mesh, { normal, offset });
        const got = areaAndFacing(section, normal);
        expect(got.area).toBeCloseTo(area, 10);
        expect(got.facing).toBe(true);
        for (let v = 0; v < section.t.length; v++) {
          const point = [0, 1, 2].map((i) => section.points[3 * v + i] ?? 0);
          expect(point.reduce((sum, x, i) => sum + x * (normal[i] ?? 0), 0)).toBeCloseTo(offset, 6);
        }
      }
    }
  });

  it("shares one vertex per cut edge and skips elements the plane misses", () => {
    const mesh = parseVolumeMesh(boxMesh(2, 1));
    const section = cutMesh(mesh, { normal: [1, 0, 0], offset: 0.25 });
    // Only the first layer of cells (24 tetrahedra) is cut; each cut edge appears once.
    expect(section.elementsCut).toBe(24);
    const edges = new Set([...section.from].map((a, v) => `${a}-${section.to[v]}`));
    expect(edges.size).toBe(section.t.length);
    expect(cutMesh(mesh, { normal: [1, 0, 0], offset: 2 }).triangles.length).toBe(0);
  });

  it("reads the bodies and leaves hidden bodies out of the section (M3.6)", () => {
    const mesh = parseVolumeMesh(boxMesh(2, 2, true));
    expect(mesh.bodies).toEqual([
      { tag: 1, firstElement: 0, elementCount: 24 },
      { tag: 2, firstElement: 24, elementCount: 24 },
    ]);
    const plane = { normal: [1, 0, 0], offset: 0.3 } as const;
    expect(areaAndFacing(cutMesh(mesh, plane), plane.normal).area).toBeCloseTo(1, 10);
    const upper = cutMesh(mesh, plane, new Set([1]));
    expect(upper.elementsCut).toBe(12);
    expect(areaAndFacing(upper, plane.normal).area).toBeCloseTo(0.5, 10);
    expect(Math.min(...[...upper.points].filter((_, i) => i % 3 === 2))).toBeCloseTo(0.5, 10);
    expect(cutMesh(mesh, plane, new Set([1, 2])).triangles.length).toBe(0);
  });

  it("draws a linear field exactly and uses the mid-edge nodes' own values", () => {
    const mesh = parseVolumeMesh(boxMesh(2, 2));
    const field = (x: number, y: number, z: number) => 1 + 2 * x - 3 * y + 0.5 * z;
    const values = new Float32Array(mesh.nodeCount);
    for (let n = 0; n < mesh.nodeCount; n++) {
      values[n] = field(mesh.positions[3 * n] ?? 0, mesh.positions[3 * n + 1] ?? 0, mesh.positions[3 * n + 2] ?? 0);
    }
    const section = cutMesh(mesh, { normal: [0, 0, 1], offset: 0.3 });
    const drawn = sectionValues(section, values);
    // A linear field is drawn exactly on the section.
    for (let v = 0; v < drawn.length; v++) {
      const [x, y, z] = [0, 1, 2].map((i) => section.points[3 * v + i] ?? 0) as [number, number, number];
      expect(drawn[v]).toBeCloseTo(field(x, y, z), 5);
    }
    // A value only a mid-edge node carries shows on the section through it.
    const bump = new Float32Array(mesh.nodeCount);
    const midNode = mesh.elements[7] ?? 0; // first element's node on its edge 3-0, inside the box
    bump[midNode] = 1;
    const through = cutMesh(mesh, { normal: [0, 0, 1], offset: mesh.positions[3 * midNode + 2] ?? 0 });
    expect(Math.max(...sectionValues(through, bump))).toBeCloseTo(1, 6);
  });

  it("places the section on the deformed shape at the scale asked for", () => {
    const mesh = parseVolumeMesh(boxMesh(1, 1));
    const section = cutMesh(mesh, { normal: [1, 0, 0], offset: 0.5 });
    const displacement = new Float32Array(mesh.nodeCount * 3);
    for (let n = 0; n < mesh.nodeCount; n++) displacement[3 * n + 2] = 0.001 * (mesh.positions[3 * n] ?? 0);
    const undeformed = sectionPositions(section, mesh.positions, null, 1);
    expect([...undeformed]).toEqual([...section.points]);
    const moved = sectionPositions(section, mesh.positions, displacement, 100);
    for (let v = 0; v < section.t.length; v++) {
      expect((moved[3 * v + 2] ?? 0) - (section.points[3 * v + 2] ?? 0)).toBeCloseTo(0.05, 6);
    }
  });
});
