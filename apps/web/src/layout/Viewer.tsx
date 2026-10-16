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
// adds a probe at the nearest surface node, listed with its value and position.

import type { GeometryStatus, GeometryView, MeshView, RunView, TopologyEdge, TopologyFace } from "@clearfea/spec";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchDisplayMesh, fetchTopology } from "../api/geometries";
import { fetchMeshDisplay } from "../api/meshes";
import { fetchRunFields, fetchRunSurface } from "../api/runs";
import { fromSi } from "../units/convert";
import { useSystemUnit } from "../units/system";
import { type DisplayMesh, DisplayMeshError, parseDisplayMesh } from "../viewer/displayMesh";
import { type Marker, ModelView } from "../viewer/ModelView";
import {
  autoScale,
  BAND_COLOURS,
  BANDS,
  bandCoordinate,
  bandEdges,
  deformedPositions,
  extremeVertices,
  QUANTITIES,
  type Quantity,
  type ResultFields,
  ResultFieldsError,
  parseResultFields,
  quantityValues,
  range,
  scalarValues,
} from "../viewer/resultFields";

/** How the result view draws the shape: undeformed, at true scale, or exaggerated to be seen. */
export type Deformation = "undeformed" | "true" | "auto";

/** What the viewer shows of a succeeded run. */
export type ResultDisplay = {
  run: RunView;
  quantity: Quantity;
  deformation: Deformation;
  /** Display unit of each quantity kind (length, pressure): the project system's. */
  units: Readonly<Record<string, string>>;
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

/** What the result view draws: positions, band coordinates and the legend's figures. */
type Contour = {
  mesh: DisplayMesh;
  coordinates: Float32Array;
  /** The quantity's value at each vertex, in SI. */
  values: Float32Array;
  kind: string;
  edges: number[];
  unit: string;
  label: string;
  scale: number | null;
};

/** The contour of one quantity on a run's surface, or a reason it cannot be drawn. */
export function contourOf(
  mesh: DisplayMesh,
  results: ResultFields,
  display: Pick<ResultDisplay, "quantity" | "deformation" | "units">,
): Contour | string {
  const { label, kind, field: name, components, component } = QUANTITIES[display.quantity];
  const field = results.fields.get(name);
  const displacement = results.fields.get("displacement");
  const vertices = mesh.positions.length / 3;
  if (displacement?.components !== 3 || results.vertexCount !== vertices) {
    return "The result files of this run do not belong together. Run the simulation again; if it happens again, report it as a bug.";
  }
  if (!field) {
    // Runs solved before M3.1 kept displacement and von Mises stress only.
    return `This run was solved before ClearFEA kept stress components, principal stresses and strains, so it has no ${label.toLowerCase()}. Run the simulation again to see it.`;
  }
  if (field.components !== components) {
    return "The result files of this run do not belong together. Run the simulation again; if it happens again, report it as a bug.";
  }
  const values = quantityValues(field, component);
  const { min, max } = range(values);
  const coordinates = values.map((v) => bandCoordinate(v, min, max));
  let positions = mesh.positions;
  let scale: number | null = null;
  if (display.deformation !== "undeformed") {
    const size = diagonal(mesh.positions);
    scale = display.deformation === "true" ? 1 : autoScale(range(scalarValues(displacement)).max, size);
    positions = deformedPositions(mesh.positions, displacement, scale);
  }
  const unit = display.units[kind] ?? "";
  return {
    mesh: { ...mesh, positions },
    coordinates,
    values,
    kind,
    edges: bandEdges(min, max).map((edge) => fromSi(edge, unit, kind)),
    unit,
    label,
    scale,
  };
}

/** A value of the contour's quantity in its display unit, to four significant figures. */
function valueText(contour: Contour, vertex: number): string {
  return `${shortNumber(fromSi(contour.values[vertex] ?? 0, contour.unit, contour.kind))} ${contour.unit}`;
}

/** The markers on the model: the smallest and largest value of the quantity shown (unless
 * hidden) and each probe, numbered in the order they were placed (M3.3, ADR-052). */
export function markersOf(contour: Contour, probes: readonly number[], extremes: boolean): Marker[] {
  const markers: Marker[] = [];
  const at = extremeVertices(contour.values);
  if (extremes && at !== null) {
    markers.push({ vertex: at.max, kind: "max", text: `Max ${valueText(contour, at.max)}` });
    markers.push({ vertex: at.min, kind: "min", text: `Min ${valueText(contour, at.min)}` });
  }
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

function Legend({ contour }: { contour: Contour }) {
  const rows = Array.from({ length: BANDS }, (_, k) => BANDS - 1 - k);
  return (
    <section className="viewer-legend" aria-label="Legend">
      <div className="viewer-legend-title">
        {contour.label} ({contour.unit})
      </div>
      <ol>
        {rows.map((k) => (
          <li key={k}>
            <span className="viewer-legend-swatch" style={{ background: BAND_COLOURS[k] }} />
            {shortNumber(contour.edges[k] ?? 0)} to {shortNumber(contour.edges[k + 1] ?? 0)}
          </li>
        ))}
      </ol>
      <div className="viewer-legend-note">
        {contour.scale === null
          ? "Undeformed shape"
          : contour.scale === 1
            ? "Deformed shape, true scale"
            : `Deformed shape, scale ×${contour.scale.toLocaleString("en-US")}`}
      </div>
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
  onSignedOut,
}: {
  geometry: GeometryView | null;
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
  onSignedOut: (problem: string) => void;
}) {
  const canvasHost = useRef<HTMLDivElement>(null);
  const view = useRef<ModelView | null>(null);
  const [webgl, setWebgl] = useState(true);
  const [load, setLoad] = useState<Load>({ kind: "none" });
  const [hovered, setHovered] = useState<number | null>(null);
  /** Probed surface vertices of the run shown, in the order they were placed. */
  const [probes, setProbes] = useState<number[]>([]);
  const [extremes, setExtremes] = useState(true);
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
      runId !== null ? fetchRunSurface(runId) : shownMesh === null ? fetchDisplayMesh(id) : fetchMeshDisplay(shownMesh.id);
    const fields = runId !== null ? fetchRunFields(runId) : Promise.resolve(null);
    void Promise.all([surface, fetchTopology(id), fields]).then(([display, topology, values]) => {
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
        setLoad({ kind: "shown", key, model: { mesh: parsed, faces, edges, analysis: shownMesh, results } });
      } catch (error) {
        if (!(error instanceof DisplayMeshError || error instanceof ResultFieldsError)) throw error;
        setLoad({ kind: "failed", problem: error.message });
      }
    });
    return () => {
      current = false;
    };
  }, [key, id, runId, onSignedOut]);

  const model = load.kind === "shown" ? load.model : null;
  const quantity = result?.quantity ?? "vonMises";
  const deformation = result?.deformation ?? "auto";
  const units = result?.units;
  const contour = useMemo(
    () =>
      model?.results && units ? contourOf(model.mesh, model.results, { quantity, deformation, units }) : null,
    [model, quantity, deformation, units],
  );
  // Switching between a geometry, its mesh and its results keeps the camera where the user put it.
  const framed = useRef<string | null>(null);
  useEffect(() => {
    if (!model || id === undefined) return;
    const keep = framed.current === id;
    if (model.results !== null) {
      if (contour === null || typeof contour === "string") return;
      view.current?.setMesh(contour.mesh, "outlines", keep, contour.coordinates);
    } else {
      view.current?.setMesh(model.mesh, model.analysis === null ? "outlines" : "elements", keep);
    }
    framed.current = id;
  }, [model, contour, id]);

  // After setMesh, which clears them.
  useEffect(() => {
    if (!model?.results || contour === null || typeof contour === "string") return;
    view.current?.setMarkers(markersOf(contour, probes, extremes));
  }, [model, contour, probes, extremes]);

  // Edges are drawn over the geometry itself, never over a mesh or results; setMesh clears them.
  const edges = pickEdges && model !== null && model.analysis === null && model.results === null ? model.edges : null;
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
    return `Face ${tag}, ${faceTypes[face.type]}, ${area} ${areaUnit}`;
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
            <button type="button" onClick={() => view.current?.resetView()}>
              Reset view
            </button>
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
