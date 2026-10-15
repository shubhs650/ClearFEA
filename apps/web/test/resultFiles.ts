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
 * 0 to 90 MPa, both rising with the vertex index. */
export function twoFacesFields(): ArrayBuffer {
  const vertices = 7;
  return encodeFields(vertices, [
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
