// SPDX-License-Identifier: AGPL-3.0-or-later
// CSV and VTK export of a run's results (M3.8, ADR-057), built in the browser from the files the
// run already keeps: mesh.bin (packages/spec/volume-mesh.md), nodes.bin (every field at every
// mesh node, packages/spec/result-fields.md) and the run's summary. Nothing is computed here
// that the viewer does not already show: the values are the stored ones, converted for the CSV
// with units.json (convert.ts) into the units the result is shown in, and written to the VTK
// file in SI as stored. Numbers only.

import type { SimulationSpec, SolveResult } from "@clearfea/spec";
import { fromSi } from "../units/convert";
import type { ResultFields } from "./resultFields";
import type { VolumeMesh } from "./section";

/** The units an export writes, one per kind (the Run panel's result units, ADR-056). */
export type ExportUnits = Readonly<
  Record<"length" | "pressure" | "force" | "moment" | "strain" | "temperature" | "heatFlux" | "heatFlow" | "ratio", string>
>;

/** A column group of the node CSV: one fields.bin field, its components' column names. */
type CsvField = { name: string; kind: keyof ExportUnits; columns: readonly string[] };

const TENSOR = ["xx", "yy", "zz", "xy", "yz", "zx"] as const;

/** The node CSV's result columns, in fields.bin's order; a field the run lacks is left out. */
const CSV_FIELDS: readonly CsvField[] = [
  { name: "displacement", kind: "length", columns: ["ux", "uy", "uz"] },
  { name: "vonMises", kind: "pressure", columns: ["von Mises stress"] },
  { name: "stress", kind: "pressure", columns: TENSOR.map((c) => `stress ${c}`) },
  { name: "principalStress", kind: "pressure", columns: ["principal stress 1", "principal stress 2", "principal stress 3"] },
  // Tensor shear components (half the engineering shear strain), as stored (ADR-050).
  { name: "strain", kind: "strain", columns: TENSOR.map((c) => (c[0] === c[1] ? `strain ${c}` : `strain ${c} (tensor)`)) },
  { name: "safetyFactor", kind: "ratio", columns: ["safety factor"] },
  // The fields of a steady-state thermal run (M5.1, M5.3); the temperature is absolute,
  // converted with its offset.
  { name: "temperature", kind: "temperature", columns: ["temperature"] },
  { name: "heatFlux", kind: "heatFlux", columns: ["heat flux qx", "heat flux qy", "heat flux qz"] },
];

/** A column name with its unit in brackets; a ratio has none. */
function header(name: string, unit: string): string {
  return unit === "1" ? name : `${name} (${unit})`;
}

/** A float32 result value to seven significant figures, which is all it holds. */
function value(x: number): string {
  return String(Number(x.toPrecision(7)));
}

/** A float64 position to ten significant figures. */
function position(x: number): string {
  return String(Number(x.toPrecision(10)));
}

/** A CSV field, quoted when it holds a comma, quote or line break. */
function cell(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Byte order mark, so spreadsheet programs read the units (µε, N·m) as UTF-8. */
const BOM = "﻿";

/** Rows per chunk of the node CSV, so a large model never becomes one huge string. */
const ROWS_PER_CHUNK = 20_000;

/**
 * The results at every node of the mesh as CSV chunks: the CalculiX node number (as in the
 * deck), the undeformed position, then every field of the run, in `units`. A generator, so the
 * caller can let the page breathe between chunks of a large model. Throws when the node values
 * and the mesh disagree on the node count.
 */
export function* nodeCsvChunks(mesh: VolumeMesh, nodes: ResultFields, units: ExportUnits): Generator<string> {
  if (nodes.vertexCount !== mesh.nodeCount) {
    throw new Error(
      `The run's node values cover ${nodes.vertexCount} nodes but its mesh has ${mesh.nodeCount}. Run the simulation again; if it happens again, report it as a bug.`,
    );
  }
  const present = CSV_FIELDS.flatMap((f) => {
    const field = nodes.fields.get(f.name);
    return field !== undefined && field.components === f.columns.length ? [{ ...f, field }] : [];
  });
  const columns = [
    "node",
    ...["x", "y", "z"].map((c) => header(c, units.length)),
    ...present.flatMap((f) => f.columns.map((c) => header(c, units[f.kind]))),
  ];
  yield `${BOM}${columns.map(cell).join(",")}\r\n`;
  const { positions } = mesh;
  let rows: string[] = [];
  for (let n = 0; n < mesh.nodeCount; n++) {
    const row = [String(n + 1)];
    for (let c = 0; c < 3; c++) row.push(position(fromSi(positions[3 * n + c] ?? 0, units.length, "length")));
    for (const { kind, field } of present) {
      const unit = units[kind];
      for (let c = 0; c < field.components; c++) {
        row.push(value(fromSi(field.values[n * field.components + c] ?? 0, unit, kind)));
      }
    }
    rows.push(row.join(","));
    if (rows.length === ROWS_PER_CHUNK) {
      yield `${rows.join("\r\n")}\r\n`;
      rows = [];
    }
  }
  if (rows.length > 0) yield `${rows.join("\r\n")}\r\n`;
}

/** The node CSV as one list of chunks (nodeCsvChunks). */
export function nodeCsv(mesh: VolumeMesh, nodes: ResultFields, units: ExportUnits): string[] {
  return [...nodeCsvChunks(mesh, nodes, units)];
}

/**
 * Each support's reaction and each load's total from the run's summary (ADR-051), as one CSV: a
 * row per support, then a row per load, named as in the run's own frozen setup. Each moment is
 * about the point in its row: a support's faces' area centroid, the origin for a load. Runs
 * solved before M3.2 have no reaction moments or load totals, so those cells are empty.
 */
export function reactionsCsv(result: SolveResult, spec: SimulationSpec, units: ExportUnits): string {
  const supportName = new Map(spec.supports.map((s) => [s.id, s.name]));
  const loadName = new Map(spec.loads.map((l) => [l.id, l.name]));
  const f = (v: number) => position(fromSi(v, units.force, "force"));
  const m = (v: number) => position(fromSi(v, units.moment, "moment"));
  const l = (v: number) => position(fromSi(v, units.length, "length"));
  const columns = [
    "item",
    "name",
    ...["Fx", "Fy", "Fz"].map((c) => header(c, units.force)),
    ...["Mx", "My", "Mz"].map((c) => header(c, units.moment)),
    ...["moment point x", "moment point y", "moment point z"].map((c) => header(c, units.length)),
  ];
  const rows = [columns];
  // A steady-state thermal run has no reactions (M5.1).
  for (const r of result.reactions ?? []) {
    rows.push([
      "reaction",
      supportName.get(r.supportId) ?? r.supportId,
      ...r.force.map(f),
      ...(r.moment?.map(m) ?? ["", "", ""]),
      ...(r.moment && r.point ? r.point.map(l) : ["", "", ""]),
    ]);
  }
  for (const load of result.loads ?? []) {
    rows.push(["applied load", loadName.get(load.loadId) ?? load.loadId, ...load.force.map(f), ...load.moment.map(m), ...[0, 0, 0].map(l)]);
  }
  return `${BOM}${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

/**
 * Each thermal load's heat flow from a steady-state thermal run's summary (M5.3), as one CSV: a
 * row per load, named as in the run's own frozen setup, positive into the body and negative out
 * of it, then the heat in, the heat out and the out-of-balance fraction of the heat balance.
 */
export function heatFlowsCsv(result: SolveResult, spec: SimulationSpec, units: ExportUnits): string {
  const loadName = new Map(spec.loads.map((l) => [l.id, l.name]));
  const w = (v: number) => position(fromSi(v, units.heatFlow, "heatFlow"));
  const rows = [["item", "name", header("heat into the body", units.heatFlow)]];
  for (const flow of result.heatFlows ?? []) {
    rows.push(["heat flow", loadName.get(flow.loadId) ?? flow.loadId, w(flow.heat)]);
  }
  const balance = result.heatBalance;
  if (balance) {
    rows.push(["heat in", "all loads", w(balance.heatIn)]);
    rows.push(["heat out", "all loads", w(-balance.heatOut)]);
    rows.push(["out of balance (fraction)", `of ${w(balance.scale)} ${units.heatFlow}`, position(balance.ratio)]);
  }
  return `${BOM}${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

/** VTK cell types (VTK's vtkCellType.h). */
const VTK_TETRA = 10;
const VTK_QUADRATIC_TETRA = 24;

/**
 * For each VTK node position of a 10-node tetrahedron, the mesh.bin (Gmsh) local node there.
 * VTK lists the mid-edge nodes of edges (0,1), (1,2), (2,0), (0,3), (1,3), (2,3); Gmsh lists
 * (0,1), (1,2), (2,0), (3,0), (3,2), (3,1), so the last two swap. Corners are the same.
 */
export const VTK_NODE_ORDER: Readonly<Record<1 | 2, readonly number[]>> = {
  1: [0, 1, 2, 3],
  2: [0, 1, 2, 3, 4, 5, 6, 7, 9, 8],
};

/** The VTK array name of a fields.bin field: its name and its SI unit. */
const VTK_UNITS: Record<string, string> = { length: "m", pressure: "Pa", strain: "m/m", temperature: "K", heatFlux: "W/m^2" };

/** VTK names the six components of a symmetric tensor XX, YY, ZZ, XY, YZ, XZ, CalculiX's order. */
const COMPONENT_NAMES: Record<string, readonly string[]> = {
  displacement: ["X", "Y", "Z"],
  heatFlux: ["X", "Y", "Z"],
  stress: ["XX", "YY", "ZZ", "XY", "YZ", "XZ"],
  strain: ["XX", "YY", "ZZ", "XY", "YZ", "XZ"],
  principalStress: ["1", "2", "3"],
};

type Block = { bytes: ArrayBufferView; xml: (offset: number) => string };

const xmlText = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/**
 * The mesh and every field at its nodes as a VTK XML unstructured grid (.vtu) with raw appended
 * data, in SI as stored: undeformed node positions in metres, the fields as point data named
 * with their SI unit (warp by `displacement` to see the deformed shape), and each element's body
 * tag as cell data. Blob parts, so a large model is never copied into one string.
 */
export function vtuParts(mesh: VolumeMesh, nodes: ResultFields): BlobPart[] {
  if (nodes.vertexCount !== mesh.nodeCount) {
    throw new Error(
      `The run's node values cover ${nodes.vertexCount} nodes but its mesh has ${mesh.nodeCount}. Run the simulation again; if it happens again, report it as a bug.`,
    );
  }
  const { order, elementCount } = mesh;
  const npe = order === 1 ? 4 : 10;
  const map = VTK_NODE_ORDER[order];
  const connectivity = new Int32Array(elementCount * npe);
  for (let e = 0; e < elementCount; e++) {
    for (let k = 0; k < npe; k++) connectivity[e * npe + k] = mesh.elements[e * npe + (map[k] ?? 0)] ?? 0;
  }
  const offsets = new Int32Array(elementCount);
  for (let e = 0; e < elementCount; e++) offsets[e] = (e + 1) * npe;
  const types = new Uint8Array(elementCount).fill(order === 1 ? VTK_TETRA : VTK_QUADRATIC_TETRA);
  const body = new Int32Array(elementCount);
  for (const b of mesh.bodies) body.fill(b.tag, b.firstElement, b.firstElement + b.elementCount);

  const array = (type: string, name: string | null, components: number, extra = "") => (offset: number) =>
    `<DataArray type="${type}"${name === null ? "" : ` Name="${xmlText(name)}"`}${
      components > 1 ? ` NumberOfComponents="${components}"` : ""
    }${extra} format="appended" offset="${offset}"/>`;

  const pointBlocks: Block[] = [];
  for (const [name, field] of nodes.fields) {
    const unit = VTK_UNITS[field.kind];
    const names = COMPONENT_NAMES[name];
    const extra =
      names !== undefined && names.length === field.components
        ? names.map((n, k) => ` ComponentName${k}="${n}"`).join("")
        : "";
    pointBlocks.push({
      bytes: field.values,
      xml: array("Float32", unit === undefined ? name : `${name} (${unit})`, field.components, extra),
    });
  }
  const cellBlocks: Block[] = [{ bytes: body, xml: array("Int32", "body", 1) }];
  const pointsBlock: Block = { bytes: mesh.positions, xml: array("Float64", "Points", 3) };
  const cellsBlocks: Block[] = [
    { bytes: connectivity, xml: array("Int32", "connectivity", 1) },
    { bytes: offsets, xml: array("Int32", "offsets", 1) },
    { bytes: types, xml: array("UInt8", "types", 1) },
  ];

  // Raw appended data: each array is preceded by its byte count as a little-endian UInt64.
  let offset = 0;
  const placed = (blocks: Block[]) =>
    blocks.map((b) => {
      const xml = b.xml(offset);
      offset += 8 + b.bytes.byteLength;
      return xml;
    });
  const pointXml = placed(pointBlocks);
  const cellXml = placed(cellBlocks);
  const [pointsXml] = placed([pointsBlock]);
  const cellsXml = placed(cellsBlocks);
  const vectors = nodes.fields.has("displacement") ? ` Vectors="${xmlText(`displacement (${VTK_UNITS.length})`)}"` : "";
  const head = [
    '<?xml version="1.0"?>',
    '<VTKFile type="UnstructuredGrid" version="1.0" byte_order="LittleEndian" header_type="UInt64">',
    "<UnstructuredGrid>",
    `<Piece NumberOfPoints="${mesh.nodeCount}" NumberOfCells="${elementCount}">`,
    `<PointData${vectors}>`,
    ...pointXml,
    "</PointData>",
    '<CellData Scalars="body">',
    ...cellXml,
    "</CellData>",
    "<Points>",
    pointsXml,
    "</Points>",
    "<Cells>",
    ...cellsXml,
    "</Cells>",
    "</Piece>",
    "</UnstructuredGrid>",
    '<AppendedData encoding="raw">',
    "_",
  ].join("\n");
  const parts: BlobPart[] = [head];
  for (const b of [...pointBlocks, ...cellBlocks, pointsBlock, ...cellsBlocks]) {
    const size = new DataView(new ArrayBuffer(8));
    size.setBigUint64(0, BigInt(b.bytes.byteLength), true);
    parts.push(size.buffer, b.bytes as ArrayBufferView<ArrayBuffer>);
  }
  parts.push("\n</AppendedData>\n</VTKFile>\n");
  return parts;
}
