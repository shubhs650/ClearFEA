// SPDX-License-Identifier: AGPL-3.0-or-later
// Reader for a run's result fields file (fields.bin), format in packages/spec/result-fields.md,
// and the pure helpers the result view draws from it (ADR-031). The worker writes the file
// (worker/clearfea_worker/results/surface.py); both sides are tested against
// packages/spec/fixtures/result-fields-three-vertices.bin. Values are SI throughout.

const MAGIC = "CFRF";
const VERSION = 1;
const HEADER_BYTES = 16;
const FIELD_BYTES = 36;

export type ResultField = {
  /** units.json quantity kind of the values, such as length or pressure. */
  kind: string;
  components: number;
  /** values[v * components + c] for vertex v, in the SI unit of `kind`. */
  values: Float32Array;
};

export type ResultFields = { vertexCount: number; fields: Map<string, ResultField> };

export class ResultFieldsError extends Error {}

const broken = (why: string) =>
  new ResultFieldsError(
    `The result file of this run is damaged (${why}). Run the simulation again; if it happens again, report it as a bug.`,
  );

function ascii(view: DataView, at: number, length: number): string {
  let text = "";
  for (let i = 0; i < length; i++) {
    const code = view.getUint8(at + i);
    if (code === 0) break;
    text += String.fromCharCode(code);
  }
  return text;
}

/** Reads and checks a fields.bin file. Throws ResultFieldsError with a user-facing message. */
export function parseResultFields(buffer: ArrayBuffer): ResultFields {
  if (buffer.byteLength < HEADER_BYTES) throw broken("the file is shorter than its header");
  const view = new DataView(buffer);
  if (ascii(view, 0, 4) !== MAGIC) throw broken("it does not start with CFRF");
  const version = view.getUint32(4, true);
  if (version !== VERSION) {
    throw new ResultFieldsError(
      `The result file is format version ${version}, but this viewer reads only version ${VERSION}. Reload the page to get the current viewer.`,
    );
  }
  const vertexCount = view.getUint32(8, true);
  const fieldCount = view.getUint32(12, true);
  if (HEADER_BYTES + fieldCount * FIELD_BYTES > buffer.byteLength) throw broken("its field table is cut short");
  const table: { name: string; kind: string; components: number }[] = [];
  for (let k = 0; k < fieldCount; k++) {
    const at = HEADER_BYTES + k * FIELD_BYTES;
    table.push({ name: ascii(view, at, 16), kind: ascii(view, at + 16, 16), components: view.getUint32(at + 32, true) });
  }
  const total = table.reduce((sum, f) => sum + f.components * vertexCount, 0);
  let offset = HEADER_BYTES + fieldCount * FIELD_BYTES;
  if (offset + total * 4 !== buffer.byteLength) throw broken(`its ${buffer.byteLength} bytes do not match its header`);
  const fields = new Map<string, ResultField>();
  for (const { name, kind, components } of table) {
    const values = new Float32Array(vertexCount * components);
    for (let i = 0; i < values.length; i++) values[i] = view.getFloat32(offset + i * 4, true);
    offset += values.length * 4;
    fields.set(name, { kind, components, values });
  }
  return { vertexCount, fields };
}

/** The quantities the result view can colour the model by. */
export type Quantity = "displacement" | "vonMises";

export const QUANTITIES: Record<Quantity, { label: string; kind: string }> = {
  displacement: { label: "Displacement magnitude", kind: "length" },
  vonMises: { label: "Von Mises stress", kind: "pressure" },
};

/** One value per vertex: the vector's length for a vector field, the value for a scalar one. */
export function scalarValues(field: ResultField): Float32Array {
  const { components, values } = field;
  if (components === 1) return values;
  const out = new Float32Array(values.length / components);
  for (let v = 0; v < out.length; v++) {
    let sum = 0;
    for (let c = 0; c < components; c++) sum += (values[v * components + c] ?? 0) ** 2;
    out[v] = Math.sqrt(sum);
  }
  return out;
}

export function range(values: Float32Array): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return values.length === 0 ? { min: 0, max: 0 } : { min, max };
}

/** Number of colour bands on the model and in the legend. */
export const BANDS = 9;

/** Band colours from the smallest value (blue) to the largest (red), as hex. */
export const BAND_COLOURS = [
  "#0000ff",
  "#0066ff",
  "#00ccff",
  "#00ffaa",
  "#00ff00",
  "#aaff00",
  "#ffdd00",
  "#ff8800",
  "#ff0000",
] as const;

/** The band edges, smallest first: BANDS + 1 values from min to max. */
export function bandEdges(min: number, max: number): number[] {
  return Array.from({ length: BANDS + 1 }, (_, k) => min + ((max - min) * k) / BANDS);
}

/** Where a value falls between min and max, 0 to 1, for the band texture. */
export function bandCoordinate(value: number, min: number, max: number): number {
  if (!(max > min)) return 0.5;
  return Math.min(Math.max((value - min) / (max - min), 0), 1);
}

/**
 * The deformation scale that makes the largest displacement about 5 percent of the model
 * size, rounded down to 1, 2 or 5 times a power of ten. 1 (true scale) if nothing moves or
 * the true deformation is already that large.
 */
export function autoScale(largestDisplacement: number, modelSize: number): number {
  if (!(largestDisplacement > 0) || !(modelSize > 0)) return 1;
  const raw = (0.05 * modelSize) / largestDisplacement;
  if (raw <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [5, 2, 1].find((m) => m * power <= raw) ?? 1;
  return step * power;
}

/** Positions moved by `scale` times the displacement: x + scale * u per vertex. */
export function deformedPositions(positions: Float32Array, displacement: ResultField, scale: number): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i++) {
    out[i] = (positions[i] ?? 0) + scale * (displacement.values[i] ?? 0);
  }
  return out;
}
