// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  autoScale,
  BANDS,
  bandCoordinate,
  bandEdges,
  deformedPositions,
  parseResultFields,
  ResultFieldsError,
  range,
  scalarValues,
} from "../src/viewer/resultFields";
import { readFixture } from "./fixtures";
import { encodeFields } from "./resultFiles";

// Written by the worker's writer; worker/tests/test_surface.py checks it byte for byte.
const fixture = () => readFixture("result-fields-three-vertices.bin");

describe("result fields reader", () => {
  it("reads the worker's file: each field with its kind, components and SI values", () => {
    const { vertexCount, fields } = parseResultFields(fixture());
    expect(vertexCount).toBe(3);
    expect([...fields.keys()]).toEqual(["displacement", "vonMises"]);
    const displacement = fields.get("displacement");
    expect(displacement?.kind).toBe("length");
    expect(displacement?.components).toBe(3);
    expect([...(displacement?.values ?? [])]).toEqual(
      [0, 0, 0, 1e-3, -2e-3, 0.5e-3, 0, 0, 4e-3].map((v) => Math.fround(v)),
    );
    const mises = fields.get("vonMises");
    expect(mises?.kind).toBe("pressure");
    expect([...(mises?.values ?? [])]).toEqual([1.5e6, 2.5e8, 0]);
  });

  it("refuses a file with the wrong magic, version or length", () => {
    const bytes = new Uint8Array(fixture());
    const wrongMagic = bytes.slice();
    wrongMagic[0] = 88;
    expect(() => parseResultFields(wrongMagic.buffer)).toThrow(/does not start with CFRF/);
    const wrongVersion = bytes.slice();
    new DataView(wrongVersion.buffer).setUint32(4, 2, true);
    expect(() => parseResultFields(wrongVersion.buffer)).toThrow(/version 2/);
    expect(() => parseResultFields(bytes.slice(0, bytes.length - 4).buffer)).toThrow(ResultFieldsError);
    expect(() => parseResultFields(new ArrayBuffer(8))).toThrow(/shorter than its header/);
  });
});

describe("result view helpers", () => {
  it("takes a vector's length and a scalar as it is", () => {
    const { fields } = parseResultFields(
      encodeFields(2, [
        { name: "displacement", kind: "length", components: 3, values: [3, 4, 0, 0, 0, -2] },
        { name: "vonMises", kind: "pressure", components: 1, values: [7, 9] },
      ]),
    );
    const displacement = fields.get("displacement");
    const mises = fields.get("vonMises");
    if (!displacement || !mises) throw new Error("fields missing");
    expect([...scalarValues(displacement)]).toEqual([5, 2]);
    expect([...scalarValues(mises)]).toEqual([7, 9]);
    expect(range(scalarValues(displacement))).toEqual({ min: 2, max: 5 });
  });

  it("splits the range into equal bands and places values in them", () => {
    const edges = bandEdges(0, 90);
    expect(edges).toHaveLength(BANDS + 1);
    expect(edges[0]).toBe(0);
    expect(edges[BANDS]).toBe(90);
    expect(bandCoordinate(0, 0, 90)).toBe(0);
    expect(bandCoordinate(45, 0, 90)).toBe(0.5);
    expect(bandCoordinate(90, 0, 90)).toBe(1);
    // A field with one value everywhere sits in the middle band, not at an end.
    expect(bandCoordinate(3, 3, 3)).toBe(0.5);
  });

  it("exaggerates a small deformation to about 5 percent of the model, in round steps", () => {
    // 0.1 m model, 1e-5 m displacement: 500 exactly.
    expect(autoScale(1e-5, 0.1)).toBe(500);
    // 1.3e-5 m: 384.6..., rounded down to 200.
    expect(autoScale(1.3e-5, 0.1)).toBe(200);
    expect(autoScale(4e-6, 0.1)).toBe(1000);
    // Already large, or nothing moves: true scale.
    expect(autoScale(0.02, 0.1)).toBe(1);
    expect(autoScale(0, 0.1)).toBe(1);
  });

  it("moves each position by the scaled displacement", () => {
    const field = { kind: "length", components: 3, values: new Float32Array([1, 0, 0, 0, -1, 0.5]) };
    const moved = deformedPositions(new Float32Array([0, 0, 0, 1, 1, 1]), field, 2);
    expect([...moved]).toEqual([2, 0, 0, 1, -1, 2]);
  });
});
