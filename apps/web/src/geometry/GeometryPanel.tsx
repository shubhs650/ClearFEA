// SPDX-License-Identifier: AGPL-3.0-or-later
// Upload a STEP file and confirm its length unit (M1.2). Shows the project's most recent
// geometry (M14.3); a choice of geometry comes with the workbench tree (M15.1).

import { type GeometryStatus, type GeometryView, type JobWait, unitsTable } from "@clearfea/spec";
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { confirmUnit, followGeometry, getGeometry, listGeometries, uploadGeometry } from "../api/geometries";
import type { ApiResult } from "../api/request";
import { MachineStartNote } from "../jobs/MachineStartNote";
import { usePolling, waitChanged } from "../jobs/usePolling";
import { fromSi } from "../units/convert";

const LENGTH_UNITS = Object.keys(unitsTable.kinds.length?.units ?? {});

const labels: Record<GeometryStatus, string> = {
  importing: "Importing",
  needs_unit: "Choose a unit",
  unconfirmed: "Confirm the unit",
  ready: "Ready",
  failed: "Import failed",
};

/** A length for display: at most four significant figures, no trailing zeros. */
function format(value: number): string {
  return String(Number(value.toPrecision(4)));
}

function extents(bbox: readonly number[]): number[] {
  return [0, 1, 2].map((i) => (bbox[i + 3] ?? 0) - (bbox[i] ?? 0));
}

/** The bounding box in a unit, for example "100 × 50 × 20 mm". */
function sizeIn(geometry: GeometryView, unit: string): string | null {
  if (geometry.bbox === null) return null;
  return `${extents(geometry.bbox)
    .map((e) => format(fromSi(e, unit, "length")))
    .join(" × ")} ${unit}`;
}

/** The bounding box in the file's own coordinates, before any unit is applied. */
function sizeInFile(geometry: GeometryView): string | null {
  const { bbox, readingFactor, scaling } = geometry;
  if (bbox === null || readingFactor === null || scaling === null) return null;
  return extents(bbox)
    .map((e) => format(e / (readingFactor * scaling)))
    .join(" × ");
}

export function GeometryPanel({
  projectId,
  onSignedOut,
  onGeometryChange,
  refresh = 0,
}: {
  /** The open project, whose geometries are listed and which uploads go into. */
  projectId?: string;
  onSignedOut: (problem: string) => void;
  /** Called with each new state of the shown geometry, so the viewer can follow it. */
  onGeometryChange?: (geometry: GeometryView) => void;
  /** Changing this number reloads the shown geometry, for example once a simulation locks its unit. */
  refresh?: number;
}) {
  const [geometry, setGeometry] = useState<GeometryView | null>(null);
  const [unit, setUnit] = useState("");
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState<JobWait | null>(null);

  const handle = useCallback(
    <T,>(result: ApiResult<T>): T | undefined => {
      if (result.kind === "ok") {
        setProblem(undefined);
        return result.value;
      }
      if (result.kind === "signedOut") onSignedOut(result.problem);
      else setProblem(result.problem);
      return undefined;
    },
    [onSignedOut],
  );

  const show = useCallback(
    (next: GeometryView) => {
      setGeometry(next);
      setUnit(next.confirmedUnit ?? next.detectedUnit ?? "");
      onGeometryChange?.(next);
    },
    [onGeometryChange],
  );

  useEffect(() => {
    void listGeometries(projectId).then((result) => {
      const list = handle(result);
      const latest = list?.[0];
      if (latest) show(latest);
    });
  }, [projectId, handle, show]);

  const importing = geometry?.status === "importing";
  const id = geometry?.id;
  // While the file imports, check on it through the shared polling hook (M11.2, ADR-112).
  usePolling(importing && id !== undefined ? id : null, async (current) => {
    if (id === undefined) return { changed: false };
    const result = await followGeometry(id);
    if (!current()) return { changed: false };
    const followed = handle(result);
    if (!followed) return { changed: false };
    const changed = followed.value.status !== "importing" || waitChanged(wait, followed.wait);
    setWait(followed.wait);
    show(followed.value);
    return { changed, retryAfter: followed.wait?.retryAfter };
  });

  // Only a new refresh number reloads; the geometry id is read as it is then.
  const shownId = useRef(id);
  shownId.current = id;
  useEffect(() => {
    const target = shownId.current;
    if (refresh === 0 || target === undefined) return;
    let current = true;
    void getGeometry(target).then((result) => {
      const next = current ? handle(result) : undefined;
      if (next) show(next);
    });
    return () => {
      current = false;
    };
  }, [refresh, handle, show]);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    const created = handle(await uploadGeometry(file, projectId));
    setBusy(false);
    if (created) show(created);
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!geometry || unit === "") return;
    setBusy(true);
    const updated = handle(await confirmUnit(geometry.id, unit));
    setBusy(false);
    if (updated) show(updated);
  }

  // Once a simulation uses the geometry, its faces are fixed and so is its unit (ADR-026).
  const settable =
    geometry !== null &&
    !geometry.unitLocked &&
    ["needs_unit", "unconfirmed", "ready"].includes(geometry.status);

  return (
    <section className="geometry" aria-label="Geometry">
      <h2 className="pane-title">Geometry</h2>
      {geometry === null && <p className="pane-empty">Upload a STEP file to start.</p>}
      {geometry !== null && (
        <dl className="geometry-facts">
          <dt>File</dt>
          <dd>{geometry.name}</dd>
          <dt>Status</dt>
          <dd className={`geometry-status geometry-${geometry.status}`}>{labels[geometry.status]}</dd>
          {geometry.bodyCount !== null && (
            <>
              <dt>Bodies, faces</dt>
              <dd>
                {geometry.bodyCount}, {geometry.faceCount}
              </dd>
            </>
          )}
          {geometry.status === "ready" && geometry.confirmedUnit && (
            <>
              <dt>Size</dt>
              <dd>{sizeIn(geometry, geometry.confirmedUnit)}</dd>
            </>
          )}
        </dl>
      )}
      <MachineStartNote wait={importing ? wait : null} />
      {geometry?.status === "failed" && geometry.problem && (
        <p className="form-problem" role="alert">
          {geometry.problem}
        </p>
      )}
      {geometry?.status === "unconfirmed" && geometry.detectedUnit && (
        <p className="geometry-unit-note">
          The file says its length unit is <strong>{geometry.detectedUnit}</strong>
          {geometry.declaredUnit ? ` (${geometry.declaredUnit})` : ""}, which makes the part{" "}
          {sizeIn(geometry, geometry.detectedUnit)}. Confirm the unit, or choose the one it was
          really drawn in.
        </p>
      )}
      {geometry?.status === "needs_unit" && (
        <p className="geometry-unit-note">
          {geometry.unitProblem} Its coordinates span {sizeInFile(geometry)}. Choose the unit they
          are in.
        </p>
      )}
      {geometry?.unitLocked && (
        <p className="geometry-unit-note">
          The unit is {geometry.confirmedUnit} and is locked, because a simulation uses this
          geometry. To use the file in another unit, upload it again.
        </p>
      )}
      {settable && (
        <form className="geometry-unit" onSubmit={confirm}>
          <label className="field">
            <span>Length unit of the file</span>
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {unit === "" && <option value="">Choose a unit</option>}
              {LENGTH_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy || unit === "" || unit === geometry?.confirmedUnit}>
            {geometry?.status === "ready" ? "Change unit" : "Confirm unit"}
          </button>
        </form>
      )}
      <label className="file-button">
        <span>{geometry === null ? "Upload a STEP file" : "Upload another STEP file"}</span>
        <input type="file" accept=".step,.stp" onChange={upload} disabled={busy} />
      </label>
      {problem && (
        <p className="form-problem" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}
