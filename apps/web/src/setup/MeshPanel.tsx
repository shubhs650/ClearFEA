// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings panels for the mesh: the global element size (M1.6), the element order and local
// sizes on faces, edges or bodies (M2.8), a button that meshes the geometry with the saved
// settings, and what the latest mesh is with its quality summary. While the Mesh panel is open
// the viewer draws the mesh; while a local size is open it shows the geometry to pick from.

import {
  type BodyAssignment,
  type ElementOrder,
  type LocalMeshScope,
  type LocalMeshSize,
  localScopes,
  type MeshQuality,
  type MeshView,
  type SimulationSpec,
} from "@clearfea/spec";
import { QuantityInput } from "../units/QuantityInput";
import { Notes } from "./ItemPanels";
import { FacesField, TagsField, TextField } from "./fields";
import { type ItemStatus, meshIsCurrent, removeItem, updateLocalSize } from "./spec";

const count = (n: number | null) => (n ?? 0).toLocaleString("en-US");

const orders: { order: ElementOrder; label: string }[] = [
  { order: 2, label: "Second order (10-node tetrahedra)" },
  { order: 1, label: "First order (4-node tetrahedra)" },
];

const localAdds: { scope: LocalMeshScope; label: string }[] = [
  { scope: "faces", label: "Add a local size on faces" },
  { scope: "edges", label: "Add a local size on edges" },
  { scope: "bodies", label: "Add a local size on bodies" },
];

function Quality({ quality }: { quality: MeshQuality }) {
  const most = Math.max(...quality.shapeHistogram, 1);
  return (
    <section className="mesh-quality" aria-label="Mesh quality">
      <h3>Element shape</h3>
      <p className="field-hint">
        Inscribed to circumscribed sphere radius ratio: 1 for a regular tetrahedron, 0 for a flat one.
      </p>
      <dl className="geometry-facts">
        <dt>Lowest</dt>
        <dd>{quality.shapeMin.toFixed(3)}</dd>
        <dt>Mean</dt>
        <dd>{quality.shapeMean.toFixed(3)}</dd>
        <dt>Smallest scaled Jacobian</dt>
        <dd>{quality.jacobianMin.toFixed(3)}</dd>
      </dl>
      <ol className="mesh-histogram" aria-label="Elements by shape">
        {quality.shapeHistogram.map((n, k) => {
          const range = `${(k / 10).toFixed(1)} to ${((k + 1) / 10).toFixed(1)}`;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: the ten bins are fixed and ordered.
            <li key={k} title={`${range}: ${count(n)} elements`}>
              <span className="mesh-histogram-range">{range}</span>
              <span className="mesh-histogram-bar" style={{ width: `${(100 * n) / most}%` }} />
              <span className="mesh-histogram-count">{count(n)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function MeshPanel({
  spec,
  status,
  mesh,
  saved,
  requesting,
  requestProblem,
  reused = false,
  onChange,
  onGenerate,
  onAddLocal,
}: {
  spec: SimulationSpec;
  status: ItemStatus | undefined;
  mesh: MeshView | null;
  /** True when the spec on screen is the one the API has, so a mesh request uses it. */
  saved: boolean;
  requesting: boolean;
  requestProblem?: string;
  /** True when the last request reused this mesh, made earlier with the same settings (M2.10). */
  reused?: boolean;
  onChange: (spec: SimulationSpec) => void;
  onGenerate: () => void;
  /** Adds a local size of the scope, taking the viewer's selection where it fits. */
  onAddLocal: (scope: LocalMeshScope) => void;
}) {
  const size = spec.mesh.size;
  const order = spec.mesh.order ?? 2;
  const meshing = mesh?.status === "meshing";
  const current = meshIsCurrent(spec, mesh);
  const canGenerate = size !== null && saved && !requesting && !meshing && !(current && mesh?.status === "ready");
  return (
    <section className="setup-panel" aria-label="Mesh">
      <h2 className="pane-title">Mesh</h2>
      <Notes status={status} />
      <QuantityInput
        label="Global size"
        kind="length"
        positive
        value={size}
        hint="The largest element edge length."
        onChange={(next) => onChange({ ...spec, mesh: { ...spec.mesh, size: next } })}
      />
      <div className="field">
        <label htmlFor="mesh-order">Element order</label>
        <select
          id="mesh-order"
          value={order}
          onChange={(event) => onChange({ ...spec, mesh: { ...spec.mesh, order: Number(event.target.value) as ElementOrder } })}
        >
          {orders.map((o) => (
            <option key={o.order} value={o.order}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="field-hint">
          {order === 2
            ? "Edges follow curved faces. Recommended for stresses."
            : "Stiffer than second order: stresses and deflections in bending come out low unless the mesh is much finer."}
        </span>
      </div>
      <div className="field">
        <span>Local sizes</span>
        <span className="field-hint">
          A smaller size on faces, edges or bodies; elements grow by about 20 percent per element to the global size away
          from them. Select faces or edges in the viewer first to give a new local size those.
        </span>
        <div className="field-actions field-actions-column">
          {localAdds.map(({ scope, label }) => (
            <button key={scope} type="button" onClick={() => onAddLocal(scope)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <button type="button" onClick={onGenerate} disabled={!canGenerate}>
        {mesh === null ? "Generate mesh" : "Generate mesh again"}
      </button>
      {requestProblem && (
        <p className="form-problem" role="alert">
          {requestProblem}
        </p>
      )}
      {/* A failed mesh's reason is the first note above. */}
      {mesh !== null && mesh.status !== "failed" && (
        <div className="mesh-summary" role="status" aria-label="Latest mesh">
          {reused && (
            <p className="field-hint mesh-reused">
              {mesh.status === "meshing"
                ? "A mesh with these settings is already being made, so this simulation will use it. It is not made or charged twice."
                : "Reused the mesh made earlier with these settings. Nothing was meshed or charged again."}
            </p>
          )}
          {mesh.status === "meshing" && (
            <p>
              Meshing with a size of {mesh.size.value} {mesh.size.unit}
              {mesh.local.length > 0 ? ` and ${mesh.local.length === 1 ? "a local size" : `${mesh.local.length} local sizes`}` : ""}…
            </p>
          )}
          {mesh.status === "ready" && (
            <>
              <dl className="geometry-facts">
                <dt>Elements</dt>
                <dd>{count(mesh.elementCount)}</dd>
                <dt>Nodes</dt>
                <dd>{count(mesh.nodeCount)}</dd>
                <dt>Size</dt>
                <dd>
                  {mesh.size.value} {mesh.size.unit}
                </dd>
                <dt>Order</dt>
                <dd>{mesh.order === 2 ? "Second (10 nodes)" : "First (4 nodes)"}</dd>
                <dt>Local sizes</dt>
                <dd>{mesh.local.length === 0 ? "None" : mesh.local.map((l) => `${l.size.value} ${l.size.unit}`).join(", ")}</dd>
              </dl>
              {mesh.quality !== null && <Quality quality={mesh.quality} />}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** The bodies a local size applies to, as checkboxes. */
function BodiesField({
  bodies,
  tags,
  onChange,
}: {
  bodies: readonly BodyAssignment[];
  tags: readonly number[];
  onChange: (tags: number[]) => void;
}) {
  return (
    <fieldset className="field">
      <legend>Bodies</legend>
      {bodies.map((body) => (
        <label key={body.tag} className="checkbox">
          <input
            type="checkbox"
            checked={tags.includes(body.tag)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...tags, body.tag].sort((a, b) => a - b)
                  : tags.filter((tag) => tag !== body.tag),
              )
            }
          />
          Body {body.tag}
        </label>
      ))}
    </fieldset>
  );
}

export function LocalSizePanel({
  spec,
  item,
  status,
  selection,
  edgeSelection,
  edgesAvailable,
  onChange,
}: {
  spec: SimulationSpec;
  item: LocalMeshSize;
  status: ItemStatus | undefined;
  /** Faces selected in the viewer. */
  selection: ReadonlySet<number>;
  /** Edges selected in the viewer. */
  edgeSelection: ReadonlySet<number>;
  /** False for a geometry imported before edges could be picked. */
  edgesAvailable: boolean;
  onChange: (spec: SimulationSpec) => void;
}) {
  const set = (changes: Partial<LocalMeshSize>) => onChange(updateLocalSize(spec, { ...item, ...changes }));
  const scope = localScopes[item.scope];
  return (
    <section className="setup-panel" aria-label="Local mesh size">
      <h2 className="pane-title">Local size on {scope.many}</h2>
      <Notes status={status} />
      <TextField label="Name" value={item.name} onChange={(name) => set({ name })} />
      {item.scope === "faces" && <FacesField faces={item.tags} selection={selection} onChange={(tags) => set({ tags })} />}
      {item.scope === "edges" &&
        (edgesAvailable ? (
          <TagsField tags={item.tags} selection={edgeSelection} onChange={(tags) => set({ tags })} noun={scope} />
        ) : (
          <p className="form-problem">
            This geometry was imported before edges could be picked. Upload the STEP file again to size its edges.
          </p>
        ))}
      {item.scope === "bodies" && <BodiesField bodies={spec.bodies} tags={item.tags} onChange={(tags) => set({ tags })} />}
      <QuantityInput
        label="Size"
        kind="length"
        positive
        value={item.size}
        hint={`The element size on the ${scope.many}, no larger than the global size.`}
        onChange={(size) => set({ size })}
      />
      <button type="button" className="setup-remove" onClick={() => onChange(removeItem(spec, item.id))}>
        Delete local size
      </button>
    </section>
  );
}
