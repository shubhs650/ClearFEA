// SPDX-License-Identifier: AGPL-3.0-or-later
// The 3D viewer (M1.3): loads the geometry's display mesh and topology, draws them with
// ModelView, shows the face under the pointer and keeps the face selection. Left-drag
// orbits, right-drag pans, the wheel zooms, a click adds or removes a face, Escape clears.
// Given a ready analysis mesh (M1.6), it draws that mesh's surface with its element edges
// instead, with the element and node counts; faces stay pickable. Given a succeeded run (M1.9),
// it draws the run's mesh surface coloured in bands of one result quantity, optionally on the
// deformed shape, with a legend; faces are then not picked. While a local mesh size on edges is
// open (M2.8), it draws the geometry's edges and a click adds or removes an edge instead. On
// results (M3.3) it marks the smallest and largest value of the quantity shown, and a click
// adds a probe at the nearest surface node, listed with its value and position. A cut plane
// (M3.4, ADR-053) across x, y or z hides the model on one side and colours the section the
// plane makes through the run's volume mesh, from the run's values at every node. Bodies can
// be hidden in every mode (M3.6, ADR-055), and the camera, hidden bodies and the result display
// can be saved as named views of the simulation and brought back. A steady-state thermal run
// (M5.1) has no displacement: its temperatures are drawn on the undeformed shape. A modal run
// (M6.2, ADR-071) shows the shape of one mode, coloured by its relative displacement and drawn
// deformed with its largest displacement at a tenth of the model's size, and can swing it.
// Through a share link (M8.7, ADR-082) it draws a run's results read-only, with the run's files
// read through the link instead of the owner's routes.

import type {
  Deformation as DeformationName,
  GeometryStatus,
  GeometryView,
  MeshView,
  RunView,
  SavedView,
  Topology,
  TopologyEdge,
  TopologyFace,
  ViewCut,
  ViewSettings,
} from "@clearfea/spec";
import { bodyLabels as labelBodies } from "@clearfea/spec";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchDisplayMesh, fetchTopology } from "../api/geometries";
import { fetchMeshDisplay } from "../api/meshes";
import type { ApiResult } from "../api/request";
import { fetchRunFields, fetchRunMesh, fetchRunNodeField, fetchRunSurface } from "../api/runs";
import { useViews } from "../setup/useViews";
import { fromSi } from "../units/convert";
import { useSystemUnit } from "../units/system";
import { type DisplayMesh, DisplayMeshError, parseDisplayMesh } from "../viewer/displayMesh";
import { type Marker, ModelView } from "../viewer/ModelView";
import {
  type ResultField,
  autoScale,
  BAND_COLOURS,
  BANDS,
  bandCoordinate,
  bandEdges,
  deformedPositions,
  extremeVertices,
  isModalRun,
  isViewQuantity,
  MODE_SHAPE_SHARE,
  modeField,
  modeResults,
  QUANTITIES,
  type Quantity,
  type ResultFields,
  ResultFieldsError,
  parseResultFields,
  quantityValues,
  range,
  SAFETY_FACTOR_CAP,
  scalarValues,
  withUnit,
} from "../viewer/resultFields";
import {
  cutMesh,
  type Plane,
  parseVolumeMesh,
  type Section,
  sectionPositions,
  sectionValues,
  type VolumeMesh,
  VolumeMeshError,
} from "../viewer/section";

/** How the result view draws the shape: undeformed, at true scale, or exaggerated to be seen.
 * Listed once in packages/spec/schemas/view.schema.json, since a saved view keeps one (M3.6). */
export type Deformation = DeformationName;

/** Where the viewer reads a geometry's topology and a run's files from. */
export interface ViewerSource {
  topology(geometryId: string): Promise<ApiResult<Topology>>;
  runSurface(runId: string): Promise<ApiResult<ArrayBuffer>>;
  runFields(runId: string): Promise<ApiResult<ArrayBuffer>>;
  runMesh(runId: string): Promise<ApiResult<ArrayBuffer>>;
  runNodeField(runId: string, field: string): Promise<ApiResult<ArrayBuffer>>;
}

/** The signed-in owner's routes. */
export const OWNER_SOURCE: ViewerSource = {
  topology: fetchTopology,
  runSurface: fetchRunSurface,
  runFields: fetchRunFields,
  runMesh: fetchRunMesh,
  runNodeField: fetchRunNodeField,
};

/** What the viewer shows of a succeeded run. */
export type ResultDisplay = {
  run: Pick<RunView, "id" | "status" | "spec" | "result">;
  quantity: Quantity;
  deformation: Deformation;
  /** Display unit of each quantity kind (length, pressure): the project system's. */
  units: Readonly<Record<string, string>>;
  /** The mode a modal run's shape is shown for, from 1 (M6.2); unused for other runs. */
  mode: number;
  /** Whether a modal run's mode shape swings (M6.2). */
  animate: boolean;
};

/** Statuses in which the API serves the display mesh (apps/api/src/routes/geometries.ts). */
const VIEWABLE: readonly GeometryStatus[] = ["needs_unit", "unconfirmed", "ready"];

const NO_WEBGL =
  "This browser could not start WebGL, which the viewer needs. Turn on hardware acceleration in the browser settings, or try another browser.";

const faceTypes: Record<TopologyFace["type"], string> = {
  plane: "plane",
  cylinder: "cylinder",
  other: "curved",
};

type Model = {
  mesh: DisplayMesh;
  faces: Map<number, TopologyFace>;
  /** The geometry's edges; null for a geometry imported before M2.8. */
  edges: TopologyEdge[] | null;
  /** The geometry's body tags, ascending. */
  bodies: number[];
  /** What each body is called (M4.1): its part name, or "Body <tag>". */
  bodyLabels: Map<number, string>;
  analysis: MeshView | null;
  /** The run's result fields when the model is a run's surface. */
  results: ResultFields | null;
};

type Load =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "failed"; problem: string }
  | { kind: "shown"; key: string; model: Model };

const NO_EDGES: ReadonlySet<number> = new Set();
const ignoreEdges = () => {};

/** Adds the face to the selection, or removes it if it is already there. */
export function toggleFace(selection: ReadonlySet<number>, tag: number): Set<number> {
  const next = new Set(selection);
  if (next.has(tag)) next.delete(tag);
  else next.add(tag);
  return next;
}

/** The faces to hide when these bodies are hidden: those whose every body is hidden, so a face
 * two bodies share stays drawn while either is shown. */
export function hiddenFacesOf(faces: ReadonlyMap<number, TopologyFace>, hiddenBodies: ReadonlySet<number>): Set<number> {
  const hidden = new Set<number>();
  if (hiddenBodies.size === 0) return hidden;
  for (const face of faces.values()) {
    if (face.bodies.length > 0 && face.bodies.every((body) => hiddenBodies.has(body))) hidden.add(face.tag);
  }
  return hidden;
}

/** 1 for each vertex of the display mesh on a face left shown, 0 on a hidden face. */
function shownVertices(mesh: DisplayMesh, hiddenFaces: ReadonlySet<number>): Uint8Array {
  const shown = new Uint8Array(mesh.positions.length / 3).fill(1);
  for (const face of mesh.faces) {
    if (hiddenFaces.has(face.tag)) shown.fill(0, face.firstVertex, face.firstVertex + face.vertexCount);
  }
  return shown;
}

const count = (n: number | null) => (n ?? 0).toLocaleString("en-US");

const shortNumber = (value: number) => String(Number(value.toPrecision(4)));

/** Length of the diagonal of the box around the positions. */
function diagonal(positions: Float32Array): number {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const v = positions[i] ?? 0;
    const axis = i % 3;
    lo[axis] = Math.min(lo[axis] ?? v, v);
    hi[axis] = Math.max(hi[axis] ?? v, v);
  }
  return positions.length === 0 ? 0 : Math.hypot(...hi.map((h, axis) => h - (lo[axis] ?? h)));
}

/** The run's surface as drawn: deformed or not, and the scale used; no displacement for a
 * steady-state thermal run (M5.1). `modeShape` when the displacement is a mode shape (M6.2). */
type Shape = { mesh: DisplayMesh; scale: number | null; displacement: ResultField | null; modeShape: boolean };

/** The shape the result view draws the run's surface in, or a reason it cannot be drawn. A
 * mode shape (M6.2) has no true scale: deformed, its largest displacement is drawn at
 * MODE_SHAPE_SHARE of the model's size. */
export function shapeOf(
  mesh: DisplayMesh,
  results: ResultFields,
  deformation: Deformation,
  modeShape = false,
): Shape | string {
  const displacement = results.fields.get("displacement");
  // A steady-state thermal run keeps the temperature alone; it is drawn undeformed.
  if (displacement === undefined && results.fields.has("temperature") && results.vertexCount === mesh.positions.length / 3) {
    return { mesh, scale: null, displacement: null, modeShape };
  }
  if (displacement?.components !== 3 || results.vertexCount !== mesh.positions.length / 3) {
    return "The result files of this run do not belong together. Run the simulation again; if it happens again, report it as a bug.";
  }
  if (deformation === "undeformed") return { mesh, scale: null, displacement, modeShape };
  const largest = range(scalarValues(displacement)).max;
  const size = diagonal(mesh.positions);
  const scale = modeShape
    ? largest > 0
      ? (MODE_SHAPE_SHARE * size) / largest
      : 0
    : deformation === "true"
      ? 1
      : autoScale(largest, size);
  return {
    mesh: { ...mesh, positions: deformedPositions(mesh.positions, displacement, scale) },
    scale,
    displacement,
    modeShape,
  };
}

/** What a cut plane adds to the contour (M3.4): the quantity at each section vertex, and
 * which surface vertices are drawn (1) or not (0): cut away by the plane or, since M3.6, on a
 * hidden body. Without a cut plane but with hidden bodies, there are no section values. */
export type CutValues = { values: Float32Array; kept: Uint8Array };

/**
 * What hidden bodies and a cut plane leave of the contour (M3.4, M3.6): the quantity at each
 * section vertex, from its values at every node, and which surface vertices stay drawn. Null
 * when nothing is hidden or cut; without a section (none asked for, or not loaded yet) hidden
 * bodies alone decide.
 */
export function cutValuesOf(
  mesh: DisplayMesh,
  hiddenFaces: ReadonlySet<number>,
  cut: { section: Section; plane: Plane; field: ResultField; quantity: Quantity } | null,
): CutValues | null {
  const kept = hiddenFaces.size === 0 ? null : shownVertices(mesh, hiddenFaces);
  if (cut === null) return kept === null ? null : { values: new Float32Array(0), kept };
  const { section, plane, field, quantity } = cut;
  const values = sectionValues(section, quantityValues(field, QUANTITIES[quantity].component));
  const p = mesh.positions;
  const [nx, ny, nz] = plane.normal;
  const drawn = kept ?? new Uint8Array(p.length / 3).fill(1);
  for (let v = 0; v < drawn.length; v++) {
    if (nx * (p[3 * v] ?? 0) + ny * (p[3 * v + 1] ?? 0) + nz * (p[3 * v + 2] ?? 0) > plane.offset) drawn[v] = 0;
  }
  return { values, kept: drawn };
}

/** What the result view draws: band coordinates and the legend's figures. */
export type Contour = {
  mesh: DisplayMesh;
  coordinates: Float32Array;
  /** The quantity's value at each vertex, in SI. */
  values: Float32Array;
  kind: string;
  edges: number[];
  unit: string;
  label: string;
  scale: number | null;
  /** False for a run with no displacement (a thermal run), whose shape is never deformed. */
  deformable: boolean;
  /** True when the shape drawn is a mode shape (M6.2), which has no true scale. */
  modeShape: boolean;
  /** Smallest values drawn red, largest blue (the safety factor, ADR-054). */
  smallestRed: boolean;
  /** The safety factor's cap when the largest value drawn reaches it, so the legend says so. */
  cap: number | null;
  /** With a cut plane: band coordinates and values (SI) of the section's vertices, and the
   * surface vertices left standing. */
  cut: { coordinates: Float32Array; values: Float32Array; kept: Uint8Array } | null;
};

/**
 * The contour of one quantity on a run's surface drawn in `shape`, or a reason it cannot be
 * drawn. With a cut plane or hidden bodies the bands span what is drawn: the surface left
 * standing and the section (ADR-053, ADR-055), so the legend and the min/max markers cover the
 * same values.
 */
export function contourOf(
  shape: Shape,
  results: ResultFields,
  display: Pick<ResultDisplay, "quantity" | "units">,
  cut: CutValues | null = null,
): Contour | string {
  const { label, kind, field: name, components, component, smallestRed = false } = QUANTITIES[display.quantity];
  const field = results.fields.get(name);
  if (!field && name === "safetyFactor") {
    return "This run has no safety factor against yield. It needs a yield strength for every material, and runs solved before ClearFEA worked it out have none. Enter the yield strength under Materials and run the simulation again.";
  }
  if (!field && name === "temperature") {
    return "This run has no temperatures. Only a steady-state thermal or a thermal stress analysis solves them; set the analysis type under Analysis and run the simulation again.";
  }
  if (!field && name === "heatFlux") {
    return "This run was solved before ClearFEA kept heat fluxes, so it has none. Run the simulation again to see the heat flux.";
  }
  if (!field && name === "displacement") {
    return "This run has no displacement. A steady-state thermal analysis solves temperatures only; show the temperature instead.";
  }
  if (!field) {
    // Runs solved before M3.1 kept displacement and von Mises stress only.
    return `This run was solved before ClearFEA kept stress components, principal stresses and strains, so it has no ${label.toLowerCase()}. Run the simulation again to see it.`;
  }
  if (field.components !== components) {
    return "The result files of this run do not belong together. Run the simulation again; if it happens again, report it as a bug.";
  }
  const values = quantityValues(field, component);
  let { min, max } = range(cut === null ? values : values.filter((_, v) => cut.kept[v] === 1));
  if (cut !== null && cut.values.length > 0) {
    const inside = range(cut.values);
    const anyKept = cut.kept.includes(1);
    min = anyKept ? Math.min(min, inside.min) : inside.min;
    max = anyKept ? Math.max(max, inside.max) : inside.max;
  }
  const band = (v: number) => (smallestRed ? 1 - bandCoordinate(v, min, max) : bandCoordinate(v, min, max));
  const coordinates = values.map(band);
  const unit = display.units[kind] ?? "";
  return {
    mesh: shape.mesh,
    coordinates,
    values,
    kind,
    edges: bandEdges(min, max).map((edge) => fromSi(edge, unit, kind)),
    unit,
    label,
    scale: shape.scale,
    deformable: shape.displacement !== null,
    modeShape: shape.modeShape,
    smallestRed,
    cap: name === "safetyFactor" && max >= SAFETY_FACTOR_CAP ? SAFETY_FACTOR_CAP : null,
    cut: cut === null ? null : { coordinates: cut.values.map(band), values: cut.values, kept: cut.kept },
  };
}

/** A value in SI of the contour's quantity in its display unit, to four significant figures. */
function shown(contour: Contour, value: number): string {
  return withUnit(shortNumber(fromSi(value, contour.unit, contour.kind)), contour.unit);
}

/** The value of the contour's quantity at a surface vertex, in its display unit. */
function valueText(contour: Contour, vertex: number): string {
  return shown(contour, contour.values[vertex] ?? 0);
}

/** Where the smallest and largest value drawn are: on the surface (or, with a cut plane, the
 * surface left standing) or on the section, whichever holds it (the section on a tie). */
function extremesOf(contour: Contour): { min: Marker; max: Marker } | null {
  const cut = contour.cut;
  const surface = cut === null ? contour.values : contour.values.map((v, k) => (cut.kept[k] === 1 ? v : Number.NaN));
  const onSurface = keptExtremes(surface);
  const onSection = cut === null ? null : extremeVertices(cut.values);
  const pick = (which: "min" | "max"): Marker | null => {
    const better = (a: number, b: number) => (which === "min" ? a <= b : a >= b);
    const s = onSurface?.[which];
    const c = onSection?.[which];
    const label = which === "min" ? "Min" : "Max";
    if (c !== undefined && cut !== null && (s === undefined || better(cut.values[c] ?? 0, surface[s] ?? 0))) {
      return { vertex: c, kind: which, text: `${label} ${shown(contour, cut.values[c] ?? 0)}`, onSection: true };
    }
    if (s === undefined) return null;
    return { vertex: s, kind: which, text: `${label} ${valueText(contour, s)}` };
  };
  const min = pick("min");
  const max = pick("max");
  return min === null || max === null ? null : { min, max };
}

/** extremeVertices over the values that are not NaN (surface vertices the cut leaves standing):
 * the first vertex where several share the value. */
function keptExtremes(values: Float32Array): { min: number; max: number } | null {
  let min = -1;
  let max = -1;
  values.forEach((value, v) => {
    if (Number.isNaN(value)) return;
    if (min < 0 || value < (values[min] ?? 0)) min = v;
    if (max < 0 || value > (values[max] ?? 0)) max = v;
  });
  return min < 0 ? null : { min, max };
}

/** The markers on the model: the smallest and largest value of the quantity shown (unless
 * hidden) and each probe, numbered in the order they were placed (M3.3, ADR-052). With a cut
 * plane the smallest and largest are those drawn, on the surface left standing or the section. */
export function markersOf(contour: Contour, probes: readonly number[], extremes: boolean): Marker[] {
  const markers: Marker[] = [];
  const at = extremesOf(contour);
  if (extremes && at !== null) markers.push(at.max, at.min);
  probes.forEach((vertex, k) => {
    markers.push({ vertex, kind: "probe", text: `${k + 1}: ${valueText(contour, vertex)}` });
  });
  return markers;
}

function Probes({
  contour,
  probes,
  positions,
  lengthUnit,
  onClear,
}: {
  contour: Contour;
  probes: readonly number[];
  /** Undeformed vertex positions, in metres. */
  positions: Float32Array;
  lengthUnit: string;
  onClear: () => void;
}) {
  const where = (vertex: number) =>
    [0, 1, 2].map((axis) => shortNumber(fromSi(positions[vertex * 3 + axis] ?? 0, lengthUnit, "length"))).join(", ");
  return (
    <section className="viewer-probes" aria-label="Probes">
      {probes.length === 0 ? (
        <span className="viewer-hint">Click the model to probe the value at the nearest node.</span>
      ) : (
        <>
          <ol>
            {probes.map((vertex, k) => (
              <li key={vertex}>
                {k + 1}: {valueText(contour, vertex)} at ({where(vertex)}) {lengthUnit}
              </li>
            ))}
          </ol>
          <button type="button" onClick={onClear}>
            Clear probes
          </button>
        </>
      )}
    </section>
  );
}

/** What a contour's legend says: its title, one row per band from the largest value down, and
 * notes on the safety factor's cap and the shape drawn. The viewer and report figures (M7.2)
 * both draw it. */
export type LegendContent = { title: string; rows: { colour: string; text: string }[]; notes: string[] };

export function legendOf(contour: Contour): LegendContent {
  const rows = Array.from({ length: BANDS }, (_, k) => BANDS - 1 - k).map((k) => ({
    colour: BAND_COLOURS[contour.smallestRed ? BANDS - 1 - k : k] ?? "",
    text: `${shortNumber(contour.edges[k] ?? 0)} to ${shortNumber(contour.edges[k + 1] ?? 0)}`,
  }));
  const notes: string[] = [];
  if (contour.cap !== null) notes.push(`Factors of ${contour.cap} and more are shown as ${contour.cap}`);
  if (contour.deformable) {
    notes.push(
      contour.scale === null
        ? "Undeformed shape"
        : contour.modeShape
          ? `Mode shape, largest displacement drawn at ${100 * MODE_SHAPE_SHARE} % of the model's size`
          : contour.scale === 1
            ? "Deformed shape, true scale"
            : `Deformed shape, scale ×${contour.scale.toLocaleString("en-US")}`,
    );
  }
  return { title: contour.unit === "1" ? contour.label : `${contour.label} (${contour.unit})`, rows, notes };
}

function Legend({ contour }: { contour: Contour }) {
  const { title, rows, notes } = legendOf(contour);
  return (
    <section className="viewer-legend" aria-label="Legend">
      <div className="viewer-legend-title">{title}</div>
      <ol>
        {rows.map((row) => (
          <li key={row.colour}>
            <span className="viewer-legend-swatch" style={{ background: row.colour }} />
            {row.text}
          </li>
        ))}
      </ol>
      {notes.map((note) => (
        <div key={note} className="viewer-legend-note">
          {note}
        </div>
      ))}
    </section>
  );
}

/** A cut plane across one axis (M3.4): where along the model it lies (0 at the smallest
 * coordinate, 1 at the largest) and which side it cuts away (the larger coordinates, unless
 * flipped). A saved view keeps one (M3.6). */
export type CutSetting = ViewCut;

const AXES = ["x", "y", "z"] as const;

/** Steps of the cut plane's slider across the model. */
const CUT_STEPS = 200;

/** The plane of a cut setting through a model whose extent along each axis is `box`. */
export function planeOf(setting: CutSetting, box: { lo: number[]; hi: number[] }): Plane {
  const lo = box.lo[setting.axis] ?? 0;
  const hi = box.hi[setting.axis] ?? 0;
  const offset = lo + setting.at * (hi - lo);
  const normal: [number, number, number] = [0, 0, 0];
  normal[setting.axis] = setting.flipped ? -1 : 1;
  return { normal, offset: setting.flipped ? -offset : offset };
}

/** The run's volume mesh and its fields at every node, fetched one field at a time (M3.4). */
type Volume = {
  runId: string;
  mesh: VolumeMesh | null;
  fields: Map<string, ResultField>;
  problem: string | null;
};

/**
 * Fetches the run's mesh and the named fields at every node, once each, while `wanted` is not
 * null; keeps what it has fetched until the run changes.
 */
function useVolume(
  source: ViewerSource,
  runId: string | null,
  wanted: readonly string[] | null,
  onSignedOut: (problem: string) => void,
): Volume | null {
  const [volume, setVolume] = useState<Volume | null>(null);
  const current = volume !== null && volume.runId === runId ? volume : null;
  const asked = useRef(new Set<string>());
  const key = wanted === null ? null : wanted.join(",");
  useEffect(() => {
    if (runId === null || key === null) return;
    if (current === null) asked.current = new Set();
    const fetches: Promise<void>[] = [];
    const fail = (problem: string) =>
      setVolume((was) => ({ ...(was?.runId === runId ? was : { runId, mesh: null, fields: new Map() }), problem }));
    if (!asked.current.has("mesh")) {
      asked.current.add("mesh");
      fetches.push(
        source.runMesh(runId).then((reply) => {
          if (reply.kind === "signedOut") return onSignedOut(reply.problem);
          if (reply.kind === "error") return fail(reply.problem);
          try {
            const mesh = parseVolumeMesh(reply.value);
            setVolume((was) => ({ ...(was?.runId === runId ? was : { runId, fields: new Map(), problem: null }), mesh }));
          } catch (error) {
            if (!(error instanceof VolumeMeshError)) throw error;
            fail(error.message);
          }
        }),
      );
    }
    for (const name of key.split(",")) {
      if (asked.current.has(name)) continue;
      asked.current.add(name);
      fetches.push(
        source.runNodeField(runId, name).then((reply) => {
          if (reply.kind === "signedOut") return onSignedOut(reply.problem);
          if (reply.kind === "error") return fail(reply.problem);
          try {
            const field = parseResultFields(reply.value).fields.get(name);
            if (field === undefined) return fail(`The run's values at every node have no ${name}. Run the simulation again.`);
            setVolume((was) => {
              const base = was?.runId === runId ? was : { runId, mesh: null, problem: null };
              return { ...base, fields: new Map([...(was?.runId === runId ? was.fields : []), [name, field]]) };
            });
          } catch (error) {
            if (!(error instanceof ResultFieldsError)) throw error;
            fail(error.message);
          }
        }),
      );
    }
    void Promise.all(fetches);
  }, [source, runId, key, current, onSignedOut]);
  return current;
}

/** The box around a volume mesh's nodes. */
export function boxOf(mesh: VolumeMesh): { lo: number[]; hi: number[] } {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let n = 0; n < mesh.nodeCount; n++) {
    for (let axis = 0; axis < 3; axis++) {
      const v = mesh.positions[n * 3 + axis] ?? 0;
      if (v < (lo[axis] ?? v)) lo[axis] = v;
      if (v > (hi[axis] ?? v)) hi[axis] = v;
    }
  }
  return { lo, hi };
}

function CutPanel({
  setting,
  onChange,
  where,
  status,
}: {
  setting: CutSetting;
  onChange: (next: CutSetting) => void;
  /** The plane's position along its axis, in display units. */
  where: string | null;
  status: string;
}) {
  return (
    <section className="viewer-cut" aria-label="Cut plane">
      <div className="viewer-cut-row">
        <span>Across</span>
        {AXES.map((name, axis) => (
          <label key={name}>
            <input
              type="radio"
              name="cut-axis"
              checked={setting.axis === axis}
              onChange={() => onChange({ ...setting, axis: axis as CutSetting["axis"] })}
            />
            {name}
          </label>
        ))}
      </div>
      <label className="viewer-cut-row">
        <span>Position</span>
        <input
          type="range"
          min={0}
          max={CUT_STEPS}
          value={Math.round(setting.at * CUT_STEPS)}
          onChange={(event) => onChange({ ...setting, at: Number(event.target.value) / CUT_STEPS })}
        />
      </label>
      <div className="viewer-cut-row">
        <span>{where ?? ""}</span>
        <label>
          <input
            type="checkbox"
            checked={setting.flipped}
            onChange={(event) => onChange({ ...setting, flipped: event.target.checked })}
          />
          Keep the other side
        </label>
      </div>
      <div className="viewer-cut-status" role="status">
        {status}
      </div>
    </section>
  );
}

/** The geometry's bodies, each with a checkbox to show or hide it (M3.6). The last body shown
 * cannot be hidden, so the model never disappears. */
function BodiesPanel({
  bodies,
  labels,
  hidden,
  onChange,
}: {
  bodies: readonly number[];
  labels: ReadonlyMap<number, string>;
  hidden: ReadonlySet<number>;
  onChange: (next: Set<number>) => void;
}) {
  const shownCount = bodies.length - hidden.size;
  return (
    <section className="viewer-panel viewer-bodies" aria-label="Bodies">
      <ul>
        {bodies.map((tag) => {
          const shown = !hidden.has(tag);
          return (
            <li key={tag}>
              <label>
                <input
                  type="checkbox"
                  checked={shown}
                  disabled={shown && shownCount === 1}
                  onChange={(event) => {
                    const next = new Set(hidden);
                    if (event.target.checked) next.delete(tag);
                    else next.add(tag);
                    onChange(next);
                  }}
                />
                {labels.get(tag) ?? `Body ${tag}`}
              </label>
            </li>
          );
        })}
      </ul>
      <button type="button" disabled={hidden.size === 0} onClick={() => onChange(new Set())}>
        Show all
      </button>
    </section>
  );
}

/** The simulation's saved views (M3.6): click one to go back to it; save the current view
 * under a name (the same name replaces that view). */
function ViewsPanel({
  list,
  onApply,
  onSave,
  onDelete,
}: {
  list: ReturnType<typeof useViews>["list"];
  onApply: (view: SavedView) => void;
  onSave: (name: string) => Promise<string | null>;
  onDelete: (view: SavedView) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (work: Promise<string | null>) => {
    setBusy(true);
    setNote(await work);
    setBusy(false);
  };
  const trimmed = name.trim();
  return (
    <section className="viewer-panel viewer-views" aria-label="Saved views">
      {list.kind === "loading" && <span className="viewer-hint">Loading the saved views…</span>}
      {list.kind === "failed" && <span className="form-problem">{list.problem}</span>}
      {list.kind === "ok" && list.views.length === 0 && (
        <span className="viewer-hint">No saved views yet. Name the current view and save it.</span>
      )}
      {list.kind === "ok" && list.views.length > 0 && (
        <ul>
          {list.views.map((view) => (
            <li key={view.id}>
              <button type="button" className="viewer-view-name" onClick={() => onApply(view)}>
                {view.name}
              </button>
              <button
                type="button"
                aria-label={`Delete the view "${view.name}"`}
                disabled={busy}
                onClick={() => void act(onDelete(view))}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="viewer-views-save"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed !== "") void act(onSave(trimmed));
        }}
      >
        <input
          type="text"
          aria-label="View name"
          placeholder="View name"
          maxLength={100}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" disabled={busy || trimmed === ""}>
          Save view
        </button>
      </form>
      {note !== null && <span className="viewer-views-note" role="status">{note}</span>}
    </section>
  );
}

export function Viewer({
  geometry,
  mesh = null,
  result = null,
  selection,
  onSelectionChange,
  pickEdges = false,
  edgeSelection = NO_EDGES,
  onEdgeSelectionChange = ignoreEdges,
  simulationId = null,
  onResultChange,
  onSignedOut,
  source = OWNER_SOURCE,
}: {
  /** The geometry to draw; a shared run's page passes what it knows of it (M8.7). */
  geometry: Pick<GeometryView, "id" | "status" | "scaling"> | null;
  /** A ready analysis mesh of the geometry to draw instead of the geometry itself. */
  mesh?: MeshView | null;
  /** A succeeded run of the geometry whose results to draw instead of the geometry or mesh. */
  result?: ResultDisplay | null;
  selection: ReadonlySet<number>;
  onSelectionChange: (next: Set<number>) => void;
  /** Draw the geometry's edges and pick edges instead of faces (M2.8). */
  pickEdges?: boolean;
  edgeSelection?: ReadonlySet<number>;
  onEdgeSelectionChange?: (next: Set<number>) => void;
  /** The open simulation, whose saved views the viewer lists (M3.6); null for none. */
  simulationId?: string | null;
  /** Shows another quantity, deformation or mode, when a saved view brings them back. */
  onResultChange?: (next: Pick<ResultDisplay, "quantity" | "deformation" | "mode">) => void;
  onSignedOut: (problem: string) => void;
  /** Where the topology and the run's files are read from: the owner's routes unless given. */
  source?: ViewerSource;
}) {
  const canvasHost = useRef<HTMLDivElement>(null);
  const view = useRef<ModelView | null>(null);
  const [webgl, setWebgl] = useState(true);
  const [load, setLoad] = useState<Load>({ kind: "none" });
  const [hovered, setHovered] = useState<number | null>(null);
  /** Probed surface vertices of the run shown, in the order they were placed. */
  const [probes, setProbes] = useState<number[]>([]);
  const [extremes, setExtremes] = useState(true);
  /** The cut plane on the results, or null for none (M3.4). */
  const [cutSetting, setCutSetting] = useState<CutSetting | null>(null);
  /** Hidden bodies of the geometry shown (M3.6). */
  const [hiddenBodies, setHiddenBodies] = useState<ReadonlySet<number>>(new Set());
  const [panel, setPanel] = useState<"bodies" | "views" | null>(null);
  // Loaded when the panel opens, so opening a simulation asks nothing more of the API.
  const views = useViews(panel === "views" ? simulationId : null, onSignedOut);
  const areaUnit = useSystemUnit("area");

  // The pick handler must see the latest selection without recreating the scene.
  const latest = useRef({ selection, onSelectionChange, pickEdges, edgeSelection, onEdgeSelectionChange });
  latest.current = { selection, onSelectionChange, pickEdges, edgeSelection, onEdgeSelectionChange };

  useEffect(() => {
    const host = canvasHost.current;
    if (!host) return;
    let created: ModelView;
    try {
      created = new ModelView(host, {
        onHover: setHovered,
        onPick: (tag) => {
          const now = latest.current;
          if (now.pickEdges) now.onEdgeSelectionChange(toggleFace(now.edgeSelection, tag));
          else now.onSelectionChange(toggleFace(now.selection, tag));
        },
        // A second click on a probed node removes its probe.
        onProbe: (vertex) => setProbes((was) => (was.includes(vertex) ? was.filter((v) => v !== vertex) : [...was, vertex])),
      });
    } catch {
      setWebgl(false);
      return;
    }
    view.current = created;
    return () => {
      created.dispose();
      view.current = null;
    };
  }, []);

  // A re-import at another unit changes the scaling, and so the display mesh.
  const viewable = geometry !== null && VIEWABLE.includes(geometry.status);
  const analysis = viewable && mesh !== null && mesh.status === "ready" && mesh.geometryId === geometry.id ? mesh : null;
  const runId = viewable && result?.run.status === "succeeded" ? result.run.id : null;
  const key = viewable
    ? `${geometry.id}:${geometry.scaling}:${runId !== null ? `run:${runId}` : (analysis?.id ?? "geometry")}`
    : null;
  const id = geometry?.id;
  // Body tags belong to one geometry.
  const [bodiesOf, setBodiesOf] = useState(id);
  if (bodiesOf !== id) {
    setBodiesOf(id);
    setHiddenBodies(new Set());
  }
  // Probes belong to the run they were placed on.
  const [probedRun, setProbedRun] = useState(runId);
  if (probedRun !== runId) {
    setProbedRun(runId);
    setProbes([]);
  }
  // The analysis mesh as of the key; read through a ref so its object identity does not reload.
  const analysisNow = useRef(analysis);
  analysisNow.current = analysis;
  useEffect(() => {
    if (key === null || id === undefined) {
      setLoad({ kind: "none" });
      return;
    }
    let current = true;
    const shownMesh = runId === null ? analysisNow.current : null;
    setLoad((was) => (was.kind === "shown" && was.key === key ? was : { kind: "loading" }));
    const surface =
      runId !== null ? source.runSurface(runId) : shownMesh === null ? fetchDisplayMesh(id) : fetchMeshDisplay(shownMesh.id);
    const fields = runId !== null ? source.runFields(runId) : Promise.resolve(null);
    void Promise.all([surface, source.topology(id), fields]).then(([display, topology, values]) => {
      if (!current) return;
      for (const reply of [display, topology, values]) {
        if (reply === null) continue;
        if (reply.kind === "signedOut") return onSignedOut(reply.problem);
        if (reply.kind === "error") return setLoad({ kind: "failed", problem: reply.problem });
      }
      if (display.kind !== "ok" || topology.kind !== "ok" || values?.kind === "error") return;
      try {
        const parsed = parseDisplayMesh(display.value);
        const results = values?.kind === "ok" ? parseResultFields(values.value) : null;
        const faces = new Map(topology.value.faces.map((face) => [face.tag, face]));
        const edges = topology.value.edges ?? null;
        const bodies = topology.value.bodies.map((body) => body.tag).sort((a, b) => a - b);
        const bodyLabels = labelBodies(topology.value);
        setLoad({
          kind: "shown",
          key,
          model: { mesh: parsed, faces, edges, bodies, bodyLabels, analysis: shownMesh, results },
        });
      } catch (error) {
        if (!(error instanceof DisplayMeshError || error instanceof ResultFieldsError)) throw error;
        setLoad({ kind: "failed", problem: error.message });
      }
    });
    return () => {
      current = false;
    };
  }, [key, id, runId, source, onSignedOut]);

  const model = load.kind === "shown" ? load.model : null;
  // Hidden bodies the model has; a saved view may name bodies of nothing else.
  const hiddenFaces = useMemo(
    () => (model === null ? new Set<number>() : hiddenFacesOf(model.faces, hiddenBodies)),
    [model, hiddenBodies],
  );
  useEffect(() => {
    view.current?.setHiddenFaces(hiddenFaces);
  }, [hiddenFaces]);
  const quantity = result?.quantity ?? "vonMises";
  const deformation = result?.deformation ?? "auto";
  const units = result?.units;
  // A modal run (M6.2) draws the shape of one mode, which is also what deforms it.
  const modal = result !== null && isModalRun(result.run);
  const mode = result?.mode ?? 1;
  const animate = modal && (result?.animate ?? false);
  const drawn = useMemo(
    () => (model?.results ? (modal ? modeResults(model.results, mode) : model.results) : null),
    [model, modal, mode],
  );
  const shape = useMemo(
    () =>
      model === null || drawn === null ? null : typeof drawn === "string" ? drawn : shapeOf(model.mesh, drawn, deformation, modal),
    [model, drawn, deformation, modal],
  );

  // A cut plane needs the run's mesh, the quantity's field at every node and, to draw the
  // section on the deformed shape, the displacement too; a thermal run (M5.1) has none to ask for.
  // A modal run's are both the shown mode's field (M6.2).
  const quantityField = modal ? modeField(mode) : QUANTITIES[quantity].field;
  const wanted = useMemo(() => {
    if (cutSetting === null || !model?.results) return null;
    const displacement = model.results.fields.has("displacement") ? ["displacement"] : [];
    return [...new Set([...displacement, quantityField])];
  }, [cutSetting, model, quantityField]);
  const volume = useVolume(source, runId, wanted, onSignedOut);
  const volumeBox = useMemo(() => (volume?.mesh ? boxOf(volume.mesh) : null), [volume?.mesh]);
  const plane = useMemo(
    () => (cutSetting === null || volumeBox === null ? null : planeOf(cutSetting, volumeBox)),
    [cutSetting, volumeBox],
  );
  const section = useMemo<Section | null>(
    () => (plane === null || !volume?.mesh ? null : cutMesh(volume.mesh, plane, hiddenBodies)),
    [plane, volume?.mesh, hiddenBodies],
  );
  const nodeField = volume?.fields.get(quantityField);
  const cutValues = useMemo<CutValues | null>(() => {
    if (!model) return null;
    // Until the section is ready (or when it cannot be made), hidden bodies alone decide.
    const ready = cutSetting !== null && section !== null && plane !== null && nodeField !== undefined;
    return cutValuesOf(model.mesh, hiddenFaces, ready ? { section, plane, field: nodeField, quantity } : null);
  }, [section, plane, nodeField, model, quantity, hiddenFaces, cutSetting]);
  const contour = useMemo(() => {
    if (!model?.results || !units || shape === null || drawn === null) return null;
    if (typeof shape === "string") return shape;
    if (typeof drawn === "string") return drawn;
    return contourOf(shape, drawn, { quantity, units }, cutValues);
  }, [model, shape, drawn, quantity, units, cutValues]);
  const nodeDisplacement = volume?.fields.get(modal ? quantityField : "displacement");
  const sectionShape = useMemo(() => {
    if (section === null || !volume?.mesh || contour === null || typeof contour === "string") return null;
    if (contour.scale !== null && nodeDisplacement === undefined) return null;
    return sectionPositions(section, volume.mesh.positions, nodeDisplacement?.values ?? null, contour.scale ?? 0);
  }, [section, volume?.mesh, nodeDisplacement, contour]);
  // The section on the undeformed shape, which a swinging mode shape moves it from (M6.2).
  const sectionRest = useMemo(
    () => (!animate || section === null || !volume?.mesh ? null : sectionPositions(section, volume.mesh.positions, null, 0)),
    [animate, section, volume?.mesh],
  );
  const legendShown = !!model?.results && contour !== null && typeof contour !== "string";
  // The model is rebuilt only when its shape changes; a new quantity or cut recolours it.
  const contourNow = useRef<Contour | null>(null);
  contourNow.current = contour !== null && typeof contour !== "string" ? contour : null;
  const contourReady = contourNow.current !== null;
  // Switching between a geometry, its mesh and its results keeps the camera where the user put it.
  const framed = useRef<string | null>(null);
  useEffect(() => {
    if (!model || id === undefined) return;
    const keep = framed.current === id;
    if (model.results !== null) {
      if (shape === null || typeof shape === "string" || !contourReady) return;
      const coordinates = contourNow.current?.coordinates;
      view.current?.setMesh(shape.mesh, "outlines", keep, coordinates, model.mesh.positions);
    } else {
      view.current?.setMesh(model.mesh, model.analysis === null ? "outlines" : "elements", keep);
    }
    framed.current = id;
  }, [model, shape, contourReady, id]);

  // After setMesh, which clears them: the colours, the cut plane and the markers. A new shape
  // always brings a new contour, so these follow every setMesh.
  useEffect(() => {
    if (!model?.results || contour === null || typeof contour === "string") return;
    view.current?.setBands(contour.coordinates);
  }, [model, contour]);
  useEffect(() => {
    if (!model?.results || contour === null || typeof contour === "string") return;
    const cut = contour.cut;
    // While a mode shape swings, the section swings with the model (M6.2).
    const swing =
      animate && sectionShape !== null && section !== null && volume?.mesh && contour.scale !== null
        ? sectionShape.map((p, k) => p - (sectionRest?.[k] ?? p))
        : undefined;
    view.current?.setCut(
      plane === null || section === null || sectionShape === null || cut === null
        ? null
        : { plane, positions: sectionShape, indices: section.triangles, coordinates: cut.coordinates, swing },
    );
  }, [model, contour, plane, section, sectionShape, animate, volume?.mesh, sectionRest]);
  // A modal run's mode shape swings about the undeformed shape (M6.2): each vertex moves by its
  // share of the deformation drawn. After setMesh, which stops it.
  useEffect(() => {
    if (!model?.results || contour === null || typeof contour === "string") return;
    const shown = typeof shape === "object" && shape !== null ? shape : null;
    view.current?.setSwing(
      animate && shown !== null && shown.scale !== null && shown.displacement !== null
        ? shown.displacement.values.map((u) => (shown.scale ?? 0) * u)
        : null,
    );
  }, [model, contour, shape, animate]);
  useEffect(() => {
    if (!model?.results || contour === null || typeof contour === "string") return;
    view.current?.setMarkers(markersOf(contour, probes, extremes));
  }, [model, contour, probes, extremes]);

  // Edges are drawn over the geometry itself, never over a mesh or results; setMesh clears them.
  // Edges of hidden bodies only are left out with them (M3.6).
  const allEdges = pickEdges && model !== null && model.analysis === null && model.results === null ? model.edges : null;
  const edges = useMemo(
    () =>
      allEdges === null || hiddenFaces.size === 0
        ? allEdges
        : allEdges.filter((edge) => !edge.faces.every((face) => hiddenFaces.has(face))),
    [allEdges, hiddenFaces],
  );
  useEffect(() => {
    if (!model) return;
    view.current?.setEdges(edges);
  }, [model, edges]);

  useEffect(() => {
    view.current?.setSelection(selection);
  }, [selection]);

  useEffect(() => {
    view.current?.setEdgeSelection(edgeSelection);
  }, [edgeSelection]);

  const clear = useCallback(() => {
    if (latest.current.pickEdges) latest.current.onEdgeSelectionChange(new Set());
    else onSelectionChange(new Set());
  }, [onSelectionChange]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const now = latest.current;
      if (event.key === "Escape" && (now.pickEdges ? now.edgeSelection : now.selection).size > 0) clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clear]);

  const settingsNow = (): ViewSettings | null => {
    const camera = view.current?.cameraView();
    if (!camera || !model) return null;
    return {
      camera,
      hiddenBodies: model.bodies.filter((tag) => hiddenBodies.has(tag)),
      // A view keeps only the quantities view.schema.json lists; the temperature (M5.1) is not one
      // yet, so its view keeps the camera and hidden bodies alone.
      result:
        legendShown && isViewQuantity(quantity)
          ? { quantity, deformation, extremes, cut: cutSetting, ...(modal ? { mode } : {}) }
          : null,
    };
  };
  const saveView = async (name: string): Promise<string | null> => {
    const settings = settingsNow();
    if (settings === null) return "The view could not be read. Wait until the model is drawn and try again.";
    const done = await views.save(name, settings);
    return done.kind === "ok" ? done.message : done.problem;
  };
  const deleteView = async (saved: SavedView): Promise<string | null> => {
    const done = await views.remove(saved);
    return done.kind === "ok" ? done.message : done.problem;
  };
  /** Brings a saved view back: its camera and hidden bodies always, and on results its
   * quantity, deformation, markers and cut plane. */
  const applyView = (saved: SavedView) => {
    const { camera, hiddenBodies: hide, result: shows } = saved.settings;
    const bodies = new Set(model?.bodies ?? []);
    const next = new Set(hide.filter((tag) => bodies.has(tag)));
    setHiddenBodies(next.size < bodies.size ? next : new Set());
    if (legendShown && shows !== null) {
      onResultChange?.({ quantity: shows.quantity, deformation: shows.deformation, mode: shows.mode ?? 1 });
      setExtremes(shows.extremes);
      setCutSetting(shows.cut);
    }
    view.current?.setCamera(camera);
  };

  const lengthUnit = useSystemUnit("length");
  const describe = (tag: number) => {
    if (edges !== null) {
      const edge = edges.find((e) => e.tag === tag);
      if (edge === undefined) return `Edge ${tag}`;
      return `Edge ${tag}, ${Number(fromSi(edge.length, lengthUnit, "length").toPrecision(4))} ${lengthUnit} long`;
    }
    const face = model?.faces.get(tag);
    if (face === undefined) return `Face ${tag}`;
    const area = Number(fromSi(face.area, areaUnit, "area").toPrecision(4));
    const text = `Face ${tag}, ${faceTypes[face.type]}, ${area} ${areaUnit}`;
    // In an assembly the hover also names the body the face belongs to (M4.1).
    if (model === null || model.bodies.length < 2) return text;
    return `${text}, ${face.bodies.map((body) => model.bodyLabels.get(body) ?? `Body ${body}`).join(" and ")}`;
  };

  let message: string | null = null;
  if (!webgl) message = NO_WEBGL;
  else if (geometry === null) message = "Upload a STEP file to see the model here.";
  else if (geometry.status === "importing") message = "Importing the file. The model appears here when it is done.";
  else if (geometry.status === "failed") message = "The import failed, so there is no model to show.";
  else if (load.kind === "loading")
    message = runId !== null ? "Loading the results…" : analysis === null ? "Loading the model…" : "Loading the mesh…";
  else if (load.kind === "failed") message = load.problem;
  else if (typeof contour === "string") message = contour;

  const shown = webgl && model !== null && message === null;
  const legend = model?.results && contour !== null && typeof contour !== "string" ? contour : null;
  const bodyList = model !== null && model.bodies.length > 1 ? model.bodies : null;
  const picking = edges !== null ? { one: "edge", many: "edges" } : { one: "face", many: "faces" };
  const sorted = [...(edges !== null ? edgeSelection : selection)].sort((a, b) => a - b);

  return (
    <main className="pane pane-viewer" aria-label="3D viewer">
      <div className="viewer-canvas" ref={canvasHost} hidden={!shown} />
      {message !== null && (
        <p
          className={load.kind === "failed" || typeof contour === "string" ? "form-problem" : "pane-empty"}
          role={load.kind === "failed" || typeof contour === "string" ? "alert" : undefined}
        >
          {message}
        </p>
      )}
      {shown && (
        <>
          <div className="viewer-hover" aria-live="polite">
            {hovered !== null ? describe(hovered) : ""}
          </div>
          {model?.analysis && (
            <div className="viewer-mesh">
              Mesh: {count(model.analysis.elementCount)} elements, {count(model.analysis.nodeCount)} nodes
            </div>
          )}
          {legend && <Legend contour={legend} />}
          <div className="viewer-toolbar">
            {legend && (
              <label>
                <input type="checkbox" checked={extremes} onChange={(event) => setExtremes(event.target.checked)} />
                Min and max
              </label>
            )}
            {legend && (
              <label>
                <input
                  type="checkbox"
                  checked={cutSetting !== null}
                  onChange={(event) => setCutSetting(event.target.checked ? { axis: 0, at: 0.5, flipped: false } : null)}
                />
                Cut plane
              </label>
            )}
            {bodyList !== null && (
              <button
                type="button"
                aria-pressed={panel === "bodies"}
                onClick={() => setPanel(panel === "bodies" ? null : "bodies")}
              >
                Bodies{hiddenBodies.size > 0 ? ` (${bodyList.length - hiddenBodies.size} of ${bodyList.length})` : ""}
              </button>
            )}
            {simulationId !== null && (
              <button
                type="button"
                aria-pressed={panel === "views"}
                onClick={() => setPanel(panel === "views" ? null : "views")}
              >
                Views
              </button>
            )}
            <button type="button" onClick={() => view.current?.resetView()}>
              Reset view
            </button>
          </div>
          <div className="viewer-panels">
          {panel === "bodies" && bodyList !== null && (
            <BodiesPanel bodies={bodyList} labels={model?.bodyLabels ?? new Map()} hidden={hiddenBodies} onChange={setHiddenBodies} />
          )}
          {panel === "views" && simulationId !== null && (
            <ViewsPanel list={views.list} onApply={applyView} onSave={saveView} onDelete={deleteView} />
          )}
          {legend && cutSetting !== null && (
            <CutPanel
              setting={cutSetting}
              onChange={setCutSetting}
              where={
                plane === null || volumeBox === null
                  ? null
                  : `${AXES[cutSetting.axis]} = ${shortNumber(
                      fromSi(plane.offset * (plane.normal[cutSetting.axis] ?? 1), units?.length ?? lengthUnit, "length"),
                    )} ${units?.length ?? lengthUnit}`
              }
              status={
                volume?.problem
                  ? volume.problem
                  : section === null || legend.cut === null || sectionShape === null
                    ? "Loading the mesh and the values inside it…"
                    : section.triangles.length === 0
                      ? "The plane misses the model. Move it with the slider."
                      : `Cuts ${count(section.elementsCut)} elements.`
              }
            />
          )}
          </div>
          {legend && model && (
            <Probes
              contour={legend}
              probes={probes}
              positions={model.mesh.positions}
              lengthUnit={units?.length ?? lengthUnit}
              onClear={() => setProbes([])}
            />
          )}
          {!legend && (
            <section className="viewer-selection" aria-label={`Selected ${picking.many}`}>
              {sorted.length === 0 ? (
                <span className="viewer-hint">Click {picking.one === "edge" ? "an edge" : "a face"} to select it. Drag to orbit, scroll to zoom.</span>
              ) : (
                <>
                  <span>
                    {sorted.length === 1 ? `1 ${picking.one} selected` : `${sorted.length} ${picking.many} selected`}:{" "}
                    {sorted.join(", ")}
                  </span>
                  <button type="button" onClick={clear}>
                    Clear
                  </button>
                </>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
