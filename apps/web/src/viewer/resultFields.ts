// SPDX-License-Identifier: AGPL-3.0-or-later
// Reader for a run's result fields file (fields.bin), format in packages/spec/result-fields.md,
// and the pure helpers the result view draws from it (ADR-031). The worker writes the file
// (worker/clearfea_worker/results/surface.py); both sides are tested against
// packages/spec/fixtures/result-fields-three-vertices.bin. Values are SI throughout.

import type { ResultQuantity } from "@clearfea/spec";

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

/** The quantities the result view can colour the model by (M1.9; components and principal
 * stresses since M3.1, ADR-050). Listed once in packages/spec/schemas/view.schema.json, since
 * a saved view keeps one (M3.6). */
export type Quantity = ResultQuantity;

export type QuantityGroup = "Displacement" | "Stress" | "Strain" | "Safety factor";

export type QuantityInfo = {
  label: string;
  /** units.json kind of the values. */
  kind: string;
  group: QuantityGroup;
  /** The fields.bin field it is read from, its component count, and the component shown;
   * null shows a vector's length or a scalar's value. */
  field: string;
  components: number;
  component: number | null;
  /** True when the smallest values matter most, so they are drawn red (the safety factor). */
  smallestRed?: boolean;
};

const tensor = (field: string, kind: string, c: number): Pick<QuantityInfo, "field" | "kind" | "components" | "component"> => ({
  field,
  kind,
  components: 6,
  component: c,
});

/** In menu order. Tensor components are in CalculiX's order xx, yy, zz, xy, yz, zx; shear
 * strains are tensor components, half the engineering shear strain γ. */
export const QUANTITIES: Record<Quantity, QuantityInfo> = {
  displacement: { label: "Displacement magnitude", kind: "length", group: "Displacement", field: "displacement", components: 3, component: null },
  vonMises: { label: "Von Mises stress", kind: "pressure", group: "Stress", field: "vonMises", components: 1, component: null },
  principal1: { label: "Maximum principal stress σ1", kind: "pressure", group: "Stress", field: "principalStress", components: 3, component: 0 },
  principal2: { label: "Middle principal stress σ2", kind: "pressure", group: "Stress", field: "principalStress", components: 3, component: 1 },
  principal3: { label: "Minimum principal stress σ3", kind: "pressure", group: "Stress", field: "principalStress", components: 3, component: 2 },
  stressXX: { label: "Normal stress σxx", group: "Stress", ...tensor("stress", "pressure", 0) },
  stressYY: { label: "Normal stress σyy", group: "Stress", ...tensor("stress", "pressure", 1) },
  stressZZ: { label: "Normal stress σzz", group: "Stress", ...tensor("stress", "pressure", 2) },
  stressXY: { label: "Shear stress τxy", group: "Stress", ...tensor("stress", "pressure", 3) },
  stressYZ: { label: "Shear stress τyz", group: "Stress", ...tensor("stress", "pressure", 4) },
  stressZX: { label: "Shear stress τzx", group: "Stress", ...tensor("stress", "pressure", 5) },
  strainXX: { label: "Normal strain εxx", group: "Strain", ...tensor("strain", "strain", 0) },
  strainYY: { label: "Normal strain εyy", group: "Strain", ...tensor("strain", "strain", 1) },
  strainZZ: { label: "Normal strain εzz", group: "Strain", ...tensor("strain", "strain", 2) },
  strainXY: { label: "Shear strain εxy (γxy / 2)", group: "Strain", ...tensor("strain", "strain", 3) },
  strainYZ: { label: "Shear strain εyz (γyz / 2)", group: "Strain", ...tensor("strain", "strain", 4) },
  strainZX: { label: "Shear strain εzx (γzx / 2)", group: "Strain", ...tensor("strain", "strain", 5) },
  safetyFactor: {
    label: "Safety factor against yield",
    kind: "ratio",
    group: "Safety factor",
    field: "safetyFactor",
    components: 1,
    component: null,
    smallestRed: true,
  },
};

/** The largest safety factor the worker keeps; larger ones and unstressed nodes read as this
 * (ADR-054, worker/clearfea_worker/results/safety.py). */
export const SAFETY_FACTOR_CAP = 15;

/** A value with its display unit, or alone for a dimensionless ratio (unit "1"). */
export function withUnit(text: string, unit: string): string {
  return unit === "1" || unit === "" ? text : `${text} ${unit}`;
}

/** The values a quantity shows, one per vertex: a component of its field, or the field's
 * scalarValues. */
export function quantityValues(field: ResultField, component: number | null): Float32Array {
  if (component === null) return scalarValues(field);
  const out = new Float32Array(field.values.length / field.components);
  for (let v = 0; v < out.length; v++) out[v] = field.values[v * field.components + component] ?? 0;
  return out;
}

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

/** The vertices holding the smallest and the largest value (the first of each when several
 * share it), for the min/max markers (M3.3, ADR-052); null when there are no values. */
export function extremeVertices(values: Float32Array): { min: number; max: number } | null {
  if (values.length === 0) return null;
  let min = 0;
  let max = 0;
  for (let v = 1; v < values.length; v++) {
    const value = values[v] ?? 0;
    if (value < (values[min] ?? 0)) min = v;
    if (value > (values[max] ?? 0)) max = v;
  }
  return { min, max };
}

/**
 * The corner of a triangle nearest a point on it: the vertex a probe picks (M3.3, ADR-052), so
 * the probe shows the node's own value from the solver rather than one interpolated for display.
 */
export function nearestCorner(
  positions: Float32Array,
  indices: Uint32Array,
  triangle: number,
  point: readonly [number, number, number],
): number {
  let best = indices[triangle * 3] ?? 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let k = 0; k < 3; k++) {
    const v = indices[triangle * 3 + k] ?? 0;
    const d = Math.hypot(
      (positions[v * 3] ?? 0) - point[0],
      (positions[v * 3 + 1] ?? 0) - point[1],
      (positions[v * 3 + 2] ?? 0) - point[2],
    );
    if (d < distance) {
      distance = d;
      best = v;
    }
  }
  return best;
}
