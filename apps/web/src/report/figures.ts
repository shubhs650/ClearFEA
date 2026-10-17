// SPDX-License-Identifier: AGPL-3.0-or-later
// The report's figures, captured in the browser (M7.2, ADR-011): one per support and load of the
// run's frozen setup, drawn on the geometry with its faces picked out and an arrow for a load
// with a direction, and one per saved view the report options pick, drawn as it was saved (a
// result plot with its legend and min/max markers, or the geometry). They are drawn by a
// ModelView on a canvas off screen, the same renderer the user looks at, and stored on the run
// for the report job (M7.3).

import {
  type Load,
  loadKinds,
  type Quantity as SpecQuantity,
  type ReportFigure,
  type ReportOptions,
  type RunView,
  type SavedView,
  type Support,
  supportKinds,
  type Topology,
} from "@clearfea/spec";
import { fetchDisplayMesh, fetchTopology } from "../api/geometries";
import { clearFigures, saveFigure } from "../api/figures";
import type { ApiResult } from "../api/request";
import { fetchRunFields, fetchRunMesh, fetchRunNodeField, fetchRunSurface } from "../api/runs";
import {
  boxOf,
  contourOf,
  cutValuesOf,
  hiddenFacesOf,
  legendOf,
  type LegendContent,
  markersOf,
  planeOf,
  shapeOf,
} from "../layout/Viewer";
import { toSi } from "../units/convert";
import { type DisplayMesh, parseDisplayMesh } from "../viewer/displayMesh";
import { FIGURE_HEIGHT, FIGURE_WIDTH, paintFigure, pngOf } from "../viewer/figure";
import { type Arrow, ISOMETRIC, ModelView } from "../viewer/ModelView";
import {
  isModalRun,
  modeField,
  modeResults,
  QUANTITIES,
  type ResultField,
  type ResultFields,
  parseResultFields,
  runChoice,
} from "../viewer/resultFields";
import { cutMesh, parseVolumeMesh, sectionPositions, type VolumeMesh } from "../viewer/section";

/** A figure the report needs, before it is drawn. */
export type PlannedFigure =
  | { kind: "support"; item: string; caption: string; support: Support }
  | { kind: "load"; item: string; caption: string; load: Load }
  | { kind: "view"; item: string; caption: string; view: SavedView };

const quoted = (name: string) => `"${name}"`;

/** A support's or load's caption: its name, with its kind unless the name already starts with it
 * (as the names the setup gives do, "Pressure 1"). */
export function itemCaption(name: string, kind: string): string {
  return name.toLowerCase().startsWith(kind.toLowerCase()) ? name : `${name} (${kind.toLowerCase()})`;
}

/** What a saved view draws, for its caption: the quantity (or mode) of a result view, else the model. */
function viewCaption(view: SavedView, run: Pick<RunView, "spec" | "result">): string {
  const shows = view.settings.result;
  if (shows === null) return `Model, view ${quoted(view.name)}`;
  const { quantity, mode } = runChoice(run, { quantity: shows.quantity, deformation: shows.deformation, mode: shows.mode ?? 1 });
  const what = isModalRun(run) ? `Shape of mode ${mode}` : QUANTITIES[quantity].label;
  return `${what}, view ${quoted(view.name)}`;
}

/**
 * The figures a report of the run needs, in the order it prints them: with Loads and supports on,
 * each support then each load of the run's setup; with Result plots on, each view the options
 * pick, in the order picked (a view deleted since is left out).
 */
export function planFigures(
  run: Pick<RunView, "spec" | "result">,
  options: Pick<ReportOptions, "sections" | "views">,
  views: readonly SavedView[],
): PlannedFigure[] {
  const planned: PlannedFigure[] = [];
  if (options.sections.includes("loadsSupports")) {
    for (const support of run.spec.supports) {
      planned.push({ kind: "support", item: support.id, caption: itemCaption(support.name, supportKinds[support.type]), support });
    }
    for (const load of run.spec.loads) {
      planned.push({ kind: "load", item: load.id, caption: itemCaption(load.name, loadKinds[load.type]), load });
    }
  }
  if (options.sections.includes("results")) {
    const byId = new Map(views.map((v) => [v.id, v]));
    for (const id of options.views) {
      const view = byId.get(id);
      if (view !== undefined) planned.push({ kind: "view", item: id, caption: viewCaption(view, run), view });
    }
  }
  return planned;
}

type Vector = [number, number, number];

const length = (v: readonly number[]) => Math.hypot(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
const scaled = (v: readonly number[], s: number): Vector => [(v[0] ?? 0) * s, (v[1] ?? 0) * s, (v[2] ?? 0) * s];
const plus = (a: readonly number[], b: readonly number[]): Vector => [
  (a[0] ?? 0) + (b[0] ?? 0),
  (a[1] ?? 0) + (b[1] ?? 0),
  (a[2] ?? 0) + (b[2] ?? 0),
];
const unit = (v: readonly number[]): Vector => scaled(v, 1 / (length(v) || 1));

/** Three quantities of one kind in SI, missing ones as 0; null when one has a unit of another kind. */
function vectorOf(components: readonly (SpecQuantity | null)[], kind: string): Vector | null {
  try {
    const [x, y, z] = components.map((q) => (q === null ? 0 : toSi(q.value, q.unit, kind)));
    return [x ?? 0, y ?? 0, z ?? 0];
  } catch {
    return null;
  }
}

/** Each face's area times its outward unit normal, summed over its triangles in the display mesh. */
export function faceNormals(mesh: DisplayMesh): Map<number, Vector> {
  const normals = new Map<number, Vector>();
  const p = mesh.positions;
  const at = (v: number): Vector => [p[v * 3] ?? 0, p[v * 3 + 1] ?? 0, p[v * 3 + 2] ?? 0];
  for (const face of mesh.faces) {
    let sum: Vector = [0, 0, 0];
    for (let t = face.firstTriangle; t < face.firstTriangle + face.triangleCount; t++) {
      const a = at(mesh.indices[t * 3] ?? 0);
      const b = at(mesh.indices[t * 3 + 1] ?? 0);
      const c = at(mesh.indices[t * 3 + 2] ?? 0);
      const u = plus(b, scaled(a, -1));
      const w = plus(c, scaled(a, -1));
      // Half the cross product is the triangle's area along its normal (counter-clockwise outward).
      sum = plus(sum, scaled([u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], 0.5));
    }
    normals.set(face.tag, sum);
  }
  return normals;
}

/** How far from the faces' normal the camera looks at them: square on would hide the model's
 * depth and an arrow into the face. */
const FACING_TILT = (50 * Math.PI) / 180;

const dot = (a: readonly number[], b: readonly number[]) => (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);

/**
 * Where the camera looks from to show faces: from their side, FACING_TILT off their mean normal
 * towards the usual isometric direction, so the model keeps its depth and an arrow pushing on the
 * faces shows. Faces whose normals cancel (a bore, faces on opposite sides) are shown from the
 * isometric direction.
 */
export function facingDirection(faces: readonly number[], normals: ReadonlyMap<number, Vector>): Vector {
  let sum: Vector = [0, 0, 0];
  let area = 0;
  for (const tag of faces) {
    const n = normals.get(tag) ?? [0, 0, 0];
    sum = plus(sum, n);
    area += length(n);
  }
  const iso = unit(ISOMETRIC);
  if (area === 0 || length(sum) < 0.3 * area) return iso;
  const normal = unit(sum);
  // The isometric direction's part square to the normal; any square direction when they line up.
  let across = plus(iso, scaled(normal, -dot(iso, normal)));
  if (length(across) < 1e-6) across = Math.abs(normal[1]) < 0.9 ? [-normal[2], 0, normal[0]] : [1, 0, 0];
  return plus(scaled(normal, Math.cos(FACING_TILT)), scaled(unit(across), Math.sin(FACING_TILT)));
}

/** A support's or load's figure is framed closer than the viewer's start, which leaves room around the model. */
const ITEM_MARGIN = 0.95;

/** The faces a support or load is drawn on: its own, or those of its bodies (heat generation).
 * Loads on every body (gravity, centrifugal, a temperature change) pick out no faces. */
export function itemFaces(item: Support | Load, topology: Pick<Topology, "bodies">): number[] {
  if ("faces" in item) return item.faces;
  if (item.type === "heat_generation") return topology.bodies.filter((b) => item.bodies.includes(b.tag)).flatMap((b) => b.faces);
  return [];
}

/** At most this many faces of a pressure carry an arrow, so a figure stays readable. */
const MAX_FACE_ARROWS = 12;

/**
 * Arrows showing which way a load acts: a force or remote force pointing at where it acts, gravity
 * through the middle of the model, the axis of a centrifugal load, and a pressure, hydrostatic
 * pressure or heat flux pushing into (or, negative, out of) each flat face it is on. Other loads
 * and supports have none. `size` is the model's size, which sets the arrows' length.
 */
export function loadArrows(
  load: Load,
  topology: Pick<Topology, "faces" | "bbox">,
  normals: ReadonlyMap<number, Vector>,
  size: number,
): Arrow[] {
  const long = 0.3 * size;
  const faces = new Map(topology.faces.map((f) => [f.tag, f]));
  const [x0, y0, z0, x1, y1, z1] = topology.bbox;
  const middle: Vector = [((x0 ?? 0) + (x1 ?? 0)) / 2, ((y0 ?? 0) + (y1 ?? 0)) / 2, ((z0 ?? 0) + (z1 ?? 0)) / 2];
  /** An arrow along `direction` whose tip is at `tip`. */
  const pointingAt = (tip: Vector, direction: Vector): Arrow => ({
    origin: plus(tip, scaled(unit(direction), -long)),
    direction: unit(direction),
    length: long,
  });
  const centroidOf = (tags: readonly number[]): Vector | null => {
    let sum: Vector = [0, 0, 0];
    let area = 0;
    for (const tag of tags) {
      const face = faces.get(tag);
      if (face === undefined) continue;
      sum = plus(sum, scaled(face.centroid, face.area));
      area += face.area;
    }
    return area > 0 ? scaled(sum, 1 / area) : null;
  };
  /** Into each flat face (out of it when `inward` is false). */
  const intoFaces = (tags: readonly number[], inward: boolean): Arrow[] =>
    tags
      .filter((tag) => faces.get(tag)?.type === "plane" && length(normals.get(tag) ?? []) > 0)
      .slice(0, MAX_FACE_ARROWS)
      .map((tag) => {
        const outward = unit(normals.get(tag) ?? [0, 0, 1]);
        const centroid = faces.get(tag)?.centroid ?? [0, 0, 0];
        return inward
          ? pointingAt([centroid[0] ?? 0, centroid[1] ?? 0, centroid[2] ?? 0], scaled(outward, -1))
          : { origin: [centroid[0] ?? 0, centroid[1] ?? 0, centroid[2] ?? 0], direction: outward, length: long };
      });
  switch (load.type) {
    case "force": {
      const force = vectorOf([load.x, load.y, load.z], "force");
      const at = centroidOf(load.faces);
      return force === null || at === null || length(force) === 0 ? [] : [pointingAt(at, force)];
    }
    case "remote": {
      const force = vectorOf([load.force.x, load.force.y, load.force.z], "force");
      const point = vectorOf([load.point.x, load.point.y, load.point.z], "length");
      return force === null || point === null || length(force) === 0 ? [] : [pointingAt(point, force)];
    }
    case "gravity": {
      const g = vectorOf([load.x, load.y, load.z], "acceleration");
      return g === null || length(g) === 0 ? [] : [pointingAt(plus(middle, scaled(unit(g), long / 2)), g)];
    }
    case "centrifugal": {
      const point = vectorOf([load.axisPoint.x, load.axisPoint.y, load.axisPoint.z], "length");
      const { x, y, z } = load.axisDirection;
      const axis: Vector = [x ?? 0, y ?? 0, z ?? 0];
      if (point === null || length(axis) === 0) return [];
      return [{ origin: plus(point, scaled(unit(axis), -0.6 * size)), direction: unit(axis), length: 1.2 * size }];
    }
    case "pressure":
      return load.magnitude === null || load.magnitude.value === 0 ? [] : intoFaces(load.faces, load.magnitude.value > 0);
    case "heat_flux":
      return load.flux === null || load.flux.value === 0 ? [] : intoFaces(load.faces, load.flux.value > 0);
    case "hydrostatic":
      return intoFaces(load.faces, true);
    default:
      return [];
  }
}

/** What capturing achieved: the figures stored, and why any could not be drawn. */
export type CaptureOutcome =
  | { kind: "ok"; figures: ReportFigure[]; problems: string[] }
  | { kind: "signedOut"; problem: string }
  | { kind: "error"; problem: string };

/** Data fetched once per capture and shared by its figures. */
type Loaded<T> = Promise<T | string>;

function once<T>(load: () => Loaded<T>): () => Loaded<T> {
  let promise: Loaded<T> | null = null;
  return () => {
    promise ??= load();
    return promise;
  };
}

class SignedOut extends Error {}

/** The value of an API reply, or the problem it reports; a signed-out reply stops the capture. */
function replyValue<T, U>(reply: ApiResult<T>, parse: (value: T) => U): U | string {
  if (reply.kind === "signedOut") throw new SignedOut(reply.problem);
  if (reply.kind === "error") return reply.problem;
  try {
    return parse(reply.value);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Draws the planned figures of a succeeded run and stores them, replacing any stored before.
 * `units` are the display units of the legend's quantities. A figure that cannot be drawn (a view
 * of a quantity the run does not have) is left out and its problem returned; the others are kept.
 */
export async function captureFigures(args: {
  run: RunView;
  geometryId: string;
  planned: readonly PlannedFigure[];
  units: Readonly<Record<string, string>>;
  onProgress?: (done: number, total: number) => void;
}): Promise<CaptureOutcome> {
  const { run, geometryId, planned, units, onProgress } = args;
  const cleared = await clearFigures(run.id);
  if (cleared.kind !== "ok") return cleared;

  const geometry = once(async () => {
    const [display, topology] = await Promise.all([fetchDisplayMesh(geometryId), fetchTopology(geometryId)]);
    const mesh = replyValue(display, parseDisplayMesh);
    const topo = replyValue(topology, (t) => t);
    if (typeof mesh === "string") return mesh;
    if (typeof topo === "string") return topo;
    return { mesh, topology: topo, normals: faceNormals(mesh) };
  });
  const results = once(async () => {
    const [surface, fields] = await Promise.all([fetchRunSurface(run.id), fetchRunFields(run.id)]);
    const mesh = replyValue(surface, parseDisplayMesh);
    const values = replyValue(fields, parseResultFields);
    if (typeof mesh === "string") return mesh;
    if (typeof values === "string") return values;
    return { mesh, values };
  });
  const volume = once(async () => replyValue(await fetchRunMesh(run.id), parseVolumeMesh));
  const nodeFields = new Map<string, () => Loaded<ResultField>>();
  const nodeField = (name: string) => {
    let load = nodeFields.get(name);
    if (load === undefined) {
      load = once(async () => {
        const parsed = replyValue(await fetchRunNodeField(run.id, name), parseResultFields);
        if (typeof parsed === "string") return parsed;
        return parsed.fields.get(name) ?? `The run's values at every node have no ${name}. Run the simulation again.`;
      });
      nodeFields.set(name, load);
    }
    return load();
  };

  // Off screen at the figure's size: a hidden element has no size to draw at.
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, {
    position: "fixed",
    left: "-20000px",
    top: "0",
    width: `${FIGURE_WIDTH}px`,
    height: `${FIGURE_HEIGHT}px`,
  });
  document.body.appendChild(host);
  let view: ModelView;
  try {
    view = new ModelView(host, { onHover: () => {}, onPick: () => {} }, { pixelRatio: 1, background: "#ffffff" });
  } catch {
    host.remove();
    return {
      kind: "error",
      problem: "This browser could not start WebGL, which drawing the figures needs. Turn on hardware acceleration in the browser settings, or try another browser.",
    };
  }

  const figures: ReportFigure[] = [];
  const problems: string[] = [];
  try {
    for (const [position, figure] of planned.entries()) {
      onProgress?.(position, planned.length);
      const drawn =
        figure.kind === "view"
          ? await drawView(view, figure.view, { run, units, geometry, results, volume, nodeField })
          : await drawItem(view, figure, geometry);
      if (typeof drawn === "string") {
        problems.push(`${figure.caption}: ${drawn}`);
        continue;
      }
      const image = await pngOf(paintFigure(view.snapshot(), drawn.legend));
      const saved = await saveFigure(run.id, figure.kind, figure.item, figure.caption, position, image);
      if (saved.kind === "signedOut") return saved;
      if (saved.kind === "error") problems.push(`${figure.caption}: ${saved.problem}`);
      else figures.push(saved.value);
    }
    onProgress?.(planned.length, planned.length);
    return { kind: "ok", figures, problems };
  } catch (error) {
    if (error instanceof SignedOut) return { kind: "signedOut", problem: error.message };
    throw error;
  } finally {
    view.dispose();
    host.remove();
  }
}

type Geometry = { mesh: DisplayMesh; topology: Topology; normals: Map<number, Vector> };

/** The model's size: the diagonal of the geometry's box. */
function sizeOf(topology: Pick<Topology, "bbox">): number {
  const [x0, y0, z0, x1, y1, z1] = topology.bbox;
  return Math.hypot((x1 ?? 0) - (x0 ?? 0), (y1 ?? 0) - (y0 ?? 0), (z1 ?? 0) - (z0 ?? 0));
}

/** Draws a support or load on the geometry: its faces picked out, seen from their side, with its arrows. */
async function drawItem(
  view: ModelView,
  figure: Extract<PlannedFigure, { kind: "support" | "load" }>,
  geometry: () => Loaded<Geometry>,
): Promise<{ legend: null } | string> {
  const item = figure.kind === "support" ? figure.support : figure.load;
  const load = figure.kind === "load" ? figure.load : null;
  const model = await geometry();
  if (typeof model === "string") return model;
  const faces = itemFaces(item, model.topology);
  view.setHiddenFaces(new Set());
  view.setSelection(new Set(faces));
  view.setMesh(model.mesh, "outlines", false);
  view.resetView(facingDirection(faces, model.normals), ITEM_MARGIN);
  view.setArrows(load === null ? [] : loadArrows(load, model.topology, model.normals, sizeOf(model.topology)));
  return { legend: null };
}

/** Draws a saved view: on the run's results as it was saved, or the geometry for a view saved without results. */
async function drawView(
  view: ModelView,
  saved: SavedView,
  data: {
    run: RunView;
    units: Readonly<Record<string, string>>;
    geometry: () => Loaded<Geometry>;
    results: () => Loaded<{ mesh: DisplayMesh; values: ResultFields }>;
    volume: () => Loaded<VolumeMesh>;
    nodeField: (name: string) => Loaded<ResultField>;
  },
): Promise<{ legend: LegendContent | null } | string> {
  const { camera, hiddenBodies, result: shows } = saved.settings;
  const model = await data.geometry();
  if (typeof model === "string") return model;
  const bodies = new Set(model.topology.bodies.map((b) => b.tag));
  const hide = new Set(hiddenBodies.filter((tag) => bodies.has(tag)));
  // As in the viewer, a view hiding every body shows them all.
  const hidden = hide.size < bodies.size ? hide : new Set<number>();
  const hiddenFaces = hiddenFacesOf(new Map(model.topology.faces.map((f) => [f.tag, f])), hidden);
  view.setSelection(new Set());
  view.setHiddenFaces(hiddenFaces);

  if (shows === null) {
    view.setMesh(model.mesh, "outlines", false);
    view.setCamera(camera);
    return { legend: null };
  }

  const { run, units } = data;
  const solved = await data.results();
  if (typeof solved === "string") return solved;
  const modal = isModalRun(run);
  const choice = runChoice(run, { quantity: shows.quantity, deformation: shows.deformation, mode: shows.mode ?? 1 });
  const drawn = modal ? modeResults(solved.values, choice.mode) : solved.values;
  if (typeof drawn === "string") return drawn;
  const shape = shapeOf(solved.mesh, drawn, choice.deformation, modal);
  if (typeof shape === "string") return shape;

  let cut = null;
  if (shows.cut !== null) {
    const mesh = await data.volume();
    if (typeof mesh === "string") return mesh;
    const field = await data.nodeField(modal ? modeField(choice.mode) : QUANTITIES[choice.quantity].field);
    if (typeof field === "string") return field;
    const plane = planeOf(shows.cut, boxOf(mesh));
    cut = { mesh, plane, section: cutMesh(mesh, plane, hidden), field };
  }
  const cutValues = cutValuesOf(
    solved.mesh,
    hiddenFaces,
    cut === null ? null : { section: cut.section, plane: cut.plane, field: cut.field, quantity: choice.quantity },
  );
  const contour = contourOf(shape, drawn, { quantity: choice.quantity, units }, cutValues);
  if (typeof contour === "string") return contour;

  view.setMesh(shape.mesh, "outlines", true, contour.coordinates, solved.mesh.positions);
  if (cut !== null && contour.cut !== null) {
    let displacement: ResultField | null = null;
    if (contour.scale !== null) {
      const field = await data.nodeField(modal ? modeField(choice.mode) : "displacement");
      if (typeof field === "string") return field;
      displacement = field;
    }
    view.setCut({
      plane: cut.plane,
      positions: sectionPositions(cut.section, cut.mesh.positions, displacement?.values ?? null, contour.scale ?? 0),
      indices: cut.section.triangles,
      coordinates: contour.cut.coordinates,
    });
  }
  view.setMarkers(markersOf(contour, [], shows.extremes));
  view.setCamera(camera);
  return { legend: legendOf(contour) };
}
