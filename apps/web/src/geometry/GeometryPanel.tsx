// SPDX-License-Identifier: AGPL-3.0-or-later
// Upload a STEP file and confirm its length unit (M1.2). Shows the user's most recent
// geometry; projects, and so a choice of geometry, come later in M1.

import { type GeometryStatus, type GeometryView, unitsTable } from "@clearfea/spec";
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useState } from "react";
import { confirmUnit, getGeometry, listGeometries, uploadGeometry } from "../api/geometries";
import type { ApiResult } from "../api/request";
import { fromSi } from "../units/convert";

/** How often the geometry is refreshed while it is importing (docs/ARCHITECTURE.md section 8). */
export const POLL_INTERVAL_MS = 2000;

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
  onSignedOut,
  onGeometryChange,
}: {
  onSignedOut: (problem: string) => void;
  /** Called with each new state of the shown geometry, so the viewer can follow it. */
  onGeometryChange?: (geometry: GeometryView) => void;
}) {
  const [geometry, setGeometry] = useState<GeometryView | null>(null);
  const [unit, setUnit] = useState("");
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);

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
    void listGeometries().then((result) => {
      const list = handle(result);
      const latest = list?.[0];
      if (latest) show(latest);
    });
  }, [handle, show]);

  const importing = geometry?.status === "importing";
  const id = geometry?.id;
  useEffect(() => {
    if (!importing || id === undefined) return;
    const timer = setInterval(async () => {
      const next = handle(await getGeometry(id));
      if (next) show(next);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [importing, id, handle, show]);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    const created = handle(await uploadGeometry(file));
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

  const settable =
    geometry !== null && ["needs_unit", "unconfirmed", "ready"].includes(geometry.status);

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
