// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings panel for the mesh (M1.6): the global element size, a button that meshes the
// geometry with the saved size, and what the latest mesh is. While this panel is open the
// viewer draws the mesh.

import type { MeshView, SimulationSpec } from "@clearfea/spec";
import { QuantityField } from "./fields";
import { Notes } from "./ItemPanels";
import { type ItemStatus, meshIsCurrent } from "./spec";

const count = (n: number | null) => (n ?? 0).toLocaleString("en-US");

export function MeshPanel({
  spec,
  status,
  defaultUnit,
  mesh,
  saved,
  requesting,
  requestProblem,
  onChange,
  onGenerate,
}: {
  spec: SimulationSpec;
  status: ItemStatus | undefined;
  /** The unit offered while no size is entered: the geometry's own length unit. */
  defaultUnit: string;
  mesh: MeshView | null;
  /** True when the spec on screen is the one the API has, so a mesh request uses it. */
  saved: boolean;
  requesting: boolean;
  requestProblem?: string;
  onChange: (spec: SimulationSpec) => void;
  onGenerate: () => void;
}) {
  const size = spec.mesh.size;
  const meshing = mesh?.status === "meshing";
  const current = meshIsCurrent(spec, mesh);
  const canGenerate = size !== null && saved && !requesting && !meshing && !(current && mesh?.status === "ready");
  return (
    <section className="setup-panel" aria-label="Mesh">
      <h2 className="pane-title">Mesh</h2>
      <Notes status={status} />
      <QuantityField
        label="Global size"
        kind="length"
        positive
        value={size}
        defaultUnit={defaultUnit}
        hint="The largest element edge length. Second-order tetrahedra (10 nodes)."
        onChange={(next) => onChange({ ...spec, mesh: { ...spec.mesh, size: next } })}
      />
      <button type="button" onClick={onGenerate} disabled={!canGenerate}>
        {mesh === null ? "Generate mesh" : "Generate mesh again"}
      </button>
      {requestProblem && (
        <p className="form-problem" role="alert">
          {requestProblem}
        </p>
      )}
      {mesh !== null && (
        <div className="mesh-summary" role="status" aria-label="Latest mesh">
          {mesh.status === "meshing" && <p>Meshing with a size of {mesh.size.value} {mesh.size.unit}…</p>}
          {mesh.status === "failed" && <p className="form-problem">{mesh.problem}</p>}
          {mesh.status === "ready" && (
            <dl className="geometry-facts">
              <dt>Elements</dt>
              <dd>{count(mesh.elementCount)}</dd>
              <dt>Nodes</dt>
              <dd>{count(mesh.nodeCount)}</dd>
              <dt>Size</dt>
              <dd>
                {mesh.size.value} {mesh.size.unit}
              </dd>
            </dl>
          )}
        </div>
      )}
    </section>
  );
}
