// SPDX-License-Identifier: AGPL-3.0-or-later
// The 3D viewer (M1.3): loads the geometry's display mesh and topology, draws them with
// ModelView, shows the face under the pointer and keeps the face selection. Left-drag
// orbits, right-drag pans, the wheel zooms, a click adds or removes a face, Escape clears.
// Given a ready analysis mesh (M1.6), it draws that mesh's surface with its element edges
// instead, with the element and node counts; faces stay pickable. Given a succeeded run (M1.9),
// it draws the run's mesh surface coloured in bands of one result quantity, optionally on the
// deformed shape, with a legend; faces are then not picked.

import type { GeometryStatus, GeometryView, MeshView, RunView, TopologyFace } from "@clearfea/spec";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchDisplayMesh, fetchTopology } from "../api/geometries";
import { fetchMeshDisplay } from "../api/meshes";
import { fetchRunFields, fetchRunSurface } from "../api/runs";
import { fromSi } from "../units/convert";
import { useSystemUnit } from "../units/system";
import { type DisplayMesh, DisplayMeshError, parseDisplayMesh } from "../viewer/displayMesh";
import { ModelView } from "../viewer/ModelView";
import {
  autoScale,
  BAND_COLOURS,
  BANDS,
  bandCoordinate,
  bandEdges,
  deformedPositions,
  QUANTITIES,
  type Quantity,
  type ResultFields,
  ResultFieldsError,
  parseResultFields,
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
  analysis: MeshView | null;
  /** The run's result fields when the model is a run's surface. */
  results: ResultFields | null;
};

type Load =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "failed"; problem: string }
  | { kind: "shown"; key: string; model: Model };

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
  const { label, kind } = QUANTITIES[display.quantity];
  const field = results.fields.get(display.quantity);
  const displacement = results.fields.get("displacement");
  const vertices = mesh.positions.length / 3;
  if (!field || !displacement || displacement.components !== 3 || results.vertexCount !== vertices) {
    return "The result files of this run do not belong together. Run the simulation again; if it happens again, report it as a bug.";
  }
  const values = scalarValues(field);
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
    edges: bandEdges(min, max).map((edge) => fromSi(edge, unit, kind)),
    unit,
    label,
    scale,
  };
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
  onSignedOut,
}: {
  geometry: GeometryView | null;
  /** A ready analysis mesh of the geometry to draw instead of the geometry itself. */
  mesh?: MeshView | null;
  /** A succeeded run of the geometry whose results to draw instead of the geometry or mesh. */
  result?: ResultDisplay | null;
  selection: ReadonlySet<number>;
  onSelectionChange: (next: Set<number>) => void;
  onSignedOut: (problem: string) => void;
}) {
  const canvasHost = useRef<HTMLDivElement>(null);
  const view = useRef<ModelView | null>(null);
  const [webgl, setWebgl] = useState(true);
  const [load, setLoad] = useState<Load>({ kind: "none" });
  const [hovered, setHovered] = useState<number | null>(null);
  const areaUnit = useSystemUnit("area");

  // The pick handler must see the latest selection without recreating the scene.
  const latest = useRef({ selection, onSelectionChange });
  latest.current = { selection, onSelectionChange };

  useEffect(() => {
    const host = canvasHost.current;
    if (!host) return;
    let created: ModelView;
    try {
      created = new ModelView(host, {
        onHover: setHovered,
        onPick: (tag) => {
          const { selection: current, onSelectionChange: change } = latest.current;
          change(toggleFace(current, tag));
        },
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
        setLoad({ kind: "shown", key, model: { mesh: parsed, faces, analysis: shownMesh, results } });
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

  useEffect(() => {
    view.current?.setSelection(selection);
  }, [selection]);

  const clear = useCallback(() => onSelectionChange(new Set()), [onSelectionChange]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && latest.current.selection.size > 0) clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clear]);

  const describe = (tag: number) => {
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
  const sorted = [...selection].sort((a, b) => a - b);

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
            <button type="button" onClick={() => view.current?.resetView()}>
              Reset view
            </button>
          </div>
          {!legend && (
            <section className="viewer-selection" aria-label="Selected faces">
              {sorted.length === 0 ? (
                <span className="viewer-hint">Click a face to select it. Drag to orbit, scroll to zoom.</span>
              ) : (
                <>
                  <span>
                    {sorted.length === 1 ? "1 face selected" : `${sorted.length} faces selected`}:{" "}
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
