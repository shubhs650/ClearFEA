// SPDX-License-Identifier: AGPL-3.0-or-later
// Builds result fields files (packages/spec/result-fields.md) for tests that need one sized
// for another surface than the shared fixture's.

export type TestField = { name: string; kind: string; components: number; values: number[] };

export function encodeFields(vertexCount: number, fields: TestField[]): ArrayBuffer {
  const total = fields.reduce((sum, f) => sum + f.values.length, 0);
  const buffer = new ArrayBuffer(16 + fields.length * 36 + total * 4);
  const view = new DataView(buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, "CFRF");
  view.setUint32(4, 1, true);
  view.setUint32(8, vertexCount, true);
  view.setUint32(12, fields.length, true);
  fields.forEach((f, k) => {
    text(16 + k * 36, f.name);
    text(16 + k * 36 + 16, f.kind);
    view.setUint32(16 + k * 36 + 32, f.components, true);
  });
  let offset = 16 + fields.length * 36;
  for (const f of fields) {
    for (const v of f.values) {
      view.setFloat32(offset, v, true);
      offset += 4;
    }
  }
  return buffer;
}

/** Fields for the 7 vertices of display-two-faces.bin: x displacement 0 to 0.6 mm, von Mises
 * 0 to 90 MPa, both rising with the vertex index. Unless `before31`, also the M3.1 fields:
 * σxx 0 to 60 MPa and τxy 0 to -6 MPa, principal stresses σ1 = σxx, σ3 = τxy, and εxx 0 to
 * 6e-4 with εxy 0 to 1.2e-4. A run solved before M3.1 has only displacement and von Mises.
 * With `safety`, also the safety factor of a 250 MPa yield strength, 250 / (v * 15) capped at
 * 15 (ADR-054): 15, 15, 8.333, 5.556, 4.167, 3.333, 2.778. */
export function twoFacesFields({ before31 = false, safety = false } = {}): ArrayBuffer {
  const vertices = 7;
  const each = (row: (v: number) => number[]) => Array.from({ length: vertices }, (_, v) => row(v)).flat();
  const m31: TestField[] = [
    { name: "stress", kind: "pressure", components: 6, values: each((v) => [v * 10e6, 0, 0, -v * 1e6, 0, 0]) },
    { name: "principalStress", kind: "pressure", components: 3, values: each((v) => [v * 10e6, 0, -v * 1e6]) },
    { name: "strain", kind: "strain", components: 6, values: each((v) => [v * 1e-4, 0, 0, v * 2e-5, 0, 0]) },
  ];
  const factor = (v: number) => (v * 15 * 15 <= 250 ? 15 : 250 / (v * 15));
  return encodeFields(vertices, [
    ...(before31 ? [] : m31),
    ...(safety ? [{ name: "safetyFactor", kind: "ratio", components: 1, values: each((v) => [factor(v)]) }] : []),
    {
      name: "displacement",
      kind: "length",
      components: 3,
      values: Array.from({ length: vertices }, (_, v) => [v * 1e-4, 0, 0]).flat(),
    },
    {
      name: "vonMises",
      kind: "pressure",
      components: 1,
      values: Array.from({ length: vertices }, (_, v) => v * 15e6),
    },
  ]);
}
