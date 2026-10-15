// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  DisplayMeshError,
  faceAtTriangle,
  faceOutlines,
  parseDisplayMesh,
} from "../src/viewer/displayMesh";
import { readFixture } from "./fixtures";

// Written by the worker's writer; worker/tests/test_display.py checks it byte for byte.
const fixture = () => readFixture("display-two-faces.bin");

/** The fixture with some bytes changed. */
function patched(edit: (view: DataView) => void, length?: number): ArrayBuffer {
  const source = new Uint8Array(fixture());
  const copy = new Uint8Array(length ?? source.length);
  copy.set(source.subarray(0, copy.length));
  edit(new DataView(copy.buffer));
  return copy.buffer;
}

describe("display mesh reader", () => {
  it("reads the worker's file: faces in tag order, each with its own vertices", () => {
    const mesh = parseDisplayMesh(fixture());
    expect(mesh.faces).toEqual([
      { tag: 3, firstVertex: 0, vertexCount: 3, firstTriangle: 0, triangleCount: 1 },
      { tag: 7, firstVertex: 3, vertexCount: 4, firstTriangle: 1, triangleCount: 2 },
    ]);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 3, 4, 5, 3, 5, 6]);
    expect(mesh.positions.length).toBe(21);
    // Metres, as written: the triangle sits at z = 0.02, the square's far corner at 0.1, 0.05.
    expect(mesh.positions[2]).toBeCloseTo(0.02, 7);
    expect(mesh.positions[15]).toBeCloseTo(0.1, 7);
    expect(mesh.positions[16]).toBeCloseTo(0.05, 7);
  });

  it("resolves a picked triangle to its face tag", () => {
    const mesh = parseDisplayMesh(fixture());
    expect(faceAtTriangle(mesh, 0)?.tag).toBe(3);
    expect(faceAtTriangle(mesh, 1)?.tag).toBe(7);
    expect(faceAtTriangle(mesh, 2)?.tag).toBe(7);
    expect(faceAtTriangle(mesh, 3)).toBeNull();
  });

  it("outlines each face along its own boundary, not its inner diagonals", () => {
    const outline = faceOutlines(parseDisplayMesh(fixture()));
    // Three edges for the triangle and four for the square; the square's diagonal is shared.
    expect(outline.length).toBe((3 + 4) * 2 * 3);
  });

  it("refuses a file that is not a display mesh", () => {
    expect(() => parseDisplayMesh(patched((v) => v.setUint8(0, 0x58)))).toThrow(DisplayMeshError);
    expect(() => parseDisplayMesh(new ArrayBuffer(8))).toThrow(/shorter than its header/);
  });

  it("refuses a version it does not know, and says how to get a newer viewer", () => {
    expect(() => parseDisplayMesh(patched((v) => v.setUint32(4, 2, true)))).toThrow(
      /version 2.*Reload the page/,
    );
  });

  it("refuses a truncated file", () => {
    const short = fixture().byteLength - 4;
    expect(() => parseDisplayMesh(patched(() => {}, short))).toThrow(/do not match its header/);
  });

  it("refuses a face whose triangles use another face's vertices", () => {
    // Indices start after the 20-byte header and 7 vertices; point the first one at vertex 5.
    expect(() => parseDisplayMesh(patched((v) => v.setUint32(20 + 7 * 12, 5, true)))).toThrow(
      /face 3 uses vertices outside its own range/,
    );
  });
});
