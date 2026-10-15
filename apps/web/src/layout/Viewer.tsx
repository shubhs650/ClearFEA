// SPDX-License-Identifier: AGPL-3.0-or-later
// The 3D viewer (M1.3): loads the geometry's display mesh and topology, draws them with
// ModelView, shows the face under the pointer and keeps the face selection. Left-drag
// orbits, right-drag pans, the wheel zooms, a click adds or removes a face, Escape clears.

import type { GeometryStatus, GeometryView, TopologyFace } from "@clearfea/spec";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDisplayMesh, fetchTopology } from "../api/geometries";
import { type DisplayMesh, DisplayMeshError, parseDisplayMesh } from "../viewer/displayMesh";
import { ModelView } from "../viewer/ModelView";

/** Statuses in which the API serves the display mesh (apps/api/src/routes/geometries.ts). */
const VIEWABLE: readonly GeometryStatus[] = ["needs_unit", "unconfirmed", "ready"];

const NO_WEBGL =
  "This browser could not start WebGL, which the viewer needs. Turn on hardware acceleration in the browser settings, or try another browser.";

const faceTypes: Record<TopologyFace["type"], string> = {
  plane: "plane",
  cylinder: "cylinder",
  other: "curved",
};

type Model = { mesh: DisplayMesh; faces: Map<number, TopologyFace> };

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

export function Viewer({
  geometry,
  selection,
  onSelectionChange,
  onSignedOut,
}: {
  geometry: GeometryView | null;
  selection: ReadonlySet<number>;
  onSelectionChange: (next: Set<number>) => void;
  onSignedOut: (problem: string) => void;
}) {
  const canvasHost = useRef<HTMLDivElement>(null);
  const view = useRef<ModelView | null>(null);
  const [webgl, setWebgl] = useState(true);
  const [load, setLoad] = useState<Load>({ kind: "none" });
  const [hovered, setHovered] = useState<number | null>(null);

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
  const key = viewable ? `${geometry.id}:${geometry.scaling}` : null;
  const id = geometry?.id;
  useEffect(() => {
    if (key === null || id === undefined) {
      setLoad({ kind: "none" });
      return;
    }
    let current = true;
    setLoad((was) => (was.kind === "shown" && was.key === key ? was : { kind: "loading" }));
    void Promise.all([fetchDisplayMesh(id), fetchTopology(id)]).then(([display, topology]) => {
      if (!current) return;
      for (const result of [display, topology]) {
        if (result.kind === "signedOut") return onSignedOut(result.problem);
        if (result.kind === "error") return setLoad({ kind: "failed", problem: result.problem });
      }
      if (display.kind !== "ok" || topology.kind !== "ok") return;
      try {
        const mesh = parseDisplayMesh(display.value);
        const faces = new Map(topology.value.faces.map((face) => [face.tag, face]));
        setLoad({ kind: "shown", key, model: { mesh, faces } });
      } catch (error) {
        if (!(error instanceof DisplayMeshError)) throw error;
        setLoad({ kind: "failed", problem: error.message });
      }
    });
    return () => {
      current = false;
    };
  }, [key, id, onSignedOut]);

  const model = load.kind === "shown" ? load.model : null;
  useEffect(() => {
    if (model) view.current?.setMesh(model.mesh);
  }, [model]);

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
    const type = model?.faces.get(tag)?.type;
    return type ? `Face ${tag}, ${faceTypes[type]}` : `Face ${tag}`;
  };

  let message: string | null = null;
  if (!webgl) message = NO_WEBGL;
  else if (geometry === null) message = "Upload a STEP file to see the model here.";
  else if (geometry.status === "importing") message = "Importing the file. The model appears here when it is done.";
  else if (geometry.status === "failed") message = "The import failed, so there is no model to show.";
  else if (load.kind === "loading") message = "Loading the model…";
  else if (load.kind === "failed") message = load.problem;

  const shown = webgl && model !== null && message === null;
  const sorted = [...selection].sort((a, b) => a - b);

  return (
    <main className="pane pane-viewer" aria-label="3D viewer">
      <div className="viewer-canvas" ref={canvasHost} hidden={!shown} />
      {message !== null && (
        <p className={load.kind === "failed" ? "form-problem" : "pane-empty"} role={load.kind === "failed" ? "alert" : undefined}>
          {message}
        </p>
      )}
      {shown && (
        <>
          <div className="viewer-hover" aria-live="polite">
            {hovered !== null ? describe(hovered) : ""}
          </div>
          <div className="viewer-toolbar">
            <button type="button" onClick={() => view.current?.resetView()}>
              Reset view
            </button>
          </div>
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
        </>
      )}
    </main>
  );
}
